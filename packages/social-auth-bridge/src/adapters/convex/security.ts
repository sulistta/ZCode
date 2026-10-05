import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server.js";
export const TTL = 300_000;
export const MEDIA_TTL = 7_200_000;
export const MAX_FILE = 1_073_741_824;
export function fail(code = "invalid-credential"): never {
  throw new ConvexError({ code });
}
export function nonce(bytes = 32): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}
export async function digest(input: string): Promise<string> {
  return btoa(
    String.fromCharCode(
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input))),
    ),
  )
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}
export function bounded(value: string, min: number, max: number): void {
  if (
    value.length < min ||
    value.length > max ||
    Array.from(value).some((char) => char.charCodeAt(0) < 32)
  )
    fail("invalid-input");
}
export async function installation(ctx: MutationCtx, credential: string) {
  bounded(credential, 43, 128);
  const hash = await digest(credential);
  const row = await ctx.db
    .query("installations")
    .withIndex("by_hash", (q) => q.eq("credentialHash", hash))
    .unique();
  if (!row) fail();
  return row;
}

export async function accountCredential(
  ctx: MutationCtx,
  args: { installationCredential: string; credential: string; accountId: string },
) {
  const owner = await installation(ctx, args.installationCredential);
  bounded(args.accountId, 1, 128);
  bounded(args.credential, 43, 128);
  const hash = await digest(args.credential);
  const key = await ctx.db
    .query("credentials")
    .withIndex("by_hash", (q) => q.eq("credentialHash", hash))
    .unique();
  if (!key || key.installationId !== owner._id || key.accountId !== args.accountId) fail();
  return key;
}
