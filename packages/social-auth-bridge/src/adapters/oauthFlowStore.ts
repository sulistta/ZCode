import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { InstagramGraphTokenSet } from "../contract.js";

const FLOW_TTL_MS = 5 * 60 * 1_000;

type TicketPayload =
  | { kind: "tokens"; accountId: string; tokens: InstagramGraphTokenSet }
  | { kind: "denied" };

interface PendingOAuthFlow {
  accountId: string;
  codeChallenge: string;
  expiresAt: number;
}

interface PendingHandoff {
  codeChallenge: string;
  expiresAt: number;
  payload: TicketPayload;
}

export class OAuthFlowStore {
  private readonly flows = new Map<string, PendingOAuthFlow>();
  private readonly handoffs = new Map<string, PendingHandoff>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly createTicket: () => string = () => randomBytes(32).toString("base64url"),
    private readonly maxPendingEntries = 2_000,
  ) {}

  begin(state: string, codeChallenge: string, accountId: string): void {
    this.removeExpired();
    if (this.flows.has(state) || this.flows.size >= this.maxPendingEntries) {
      throw new Error("OAuth flow capacity reached");
    }
    this.flows.set(state, { accountId, codeChallenge, expiresAt: this.now() + FLOW_TTL_MS });
  }

  consumeState(state: string): PendingOAuthFlow | null {
    this.removeExpired();
    const flow = this.flows.get(state);
    if (!flow) return null;
    this.flows.delete(state);
    return flow.expiresAt > this.now() ? flow : null;
  }

  issueTicket(codeChallenge: string, payload: TicketPayload): string {
    this.removeExpired();
    if (this.handoffs.size >= this.maxPendingEntries) {
      throw new Error("OAuth handoff capacity reached");
    }
    const ticket = this.createTicket();
    this.handoffs.set(ticket, {
      codeChallenge,
      expiresAt: this.now() + FLOW_TTL_MS,
      payload,
    });
    return ticket;
  }

  redeemTicket(ticket: string, codeVerifier: string): TicketPayload | null {
    this.removeExpired();
    const handoff = this.handoffs.get(ticket);
    if (!handoff || handoff.expiresAt <= this.now()) return null;
    const actualChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const expected = Buffer.from(handoff.codeChallenge);
    const actual = Buffer.from(actualChallenge);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    this.handoffs.delete(ticket);
    return handoff.payload;
  }

  private removeExpired(): void {
    const now = this.now();
    for (const [state, flow] of this.flows) {
      if (flow.expiresAt <= now) this.flows.delete(state);
    }
    for (const [ticket, handoff] of this.handoffs) {
      if (handoff.expiresAt <= now) this.handoffs.delete(ticket);
    }
  }
}
