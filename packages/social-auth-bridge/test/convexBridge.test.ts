import { describe, it, expect, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../src/adapters/convex/schema.js";
import { digest } from "../src/adapters/convex/security.js";

const modules = import.meta.glob("../src/adapters/convex/**/*.ts");
const ref = (name: string) => makeFunctionReference<"mutation">(`bridge:${name}`);
const internal = (name: string) => makeFunctionReference<"mutation">(`bridge:${name}`);
const install = "A".repeat(43);
const otherInstall = "B".repeat(43);
const state = "C".repeat(43);
const verifier = "D".repeat(43);
const ticket = "E".repeat(43);
const accountId = "test-account";

async function connected() {
  const t = convexTest(schema, modules);
  await t.mutation(internal("bootstrap"), { credentialHash: await digest(install) });
  await t.mutation(internal("bootstrap"), { credentialHash: await digest(otherInstall) });
  await t.mutation(ref("authorize"), {
    installationCredential: install,
    accountId,
    state,
    codeChallenge: await digest(verifier),
  });
  const flow = await t.mutation(internal("claimCallback"), { state });
  await t.mutation(internal("finishCallback"), {
    flowId: flow.flowId,
    ticketHash: await digest(ticket),
    accessToken: "meta-test-token",
    tokenExpiresAt: Date.now() + 60_000,
  });
  return t;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("user-owned Convex bridge", () => {
  it("consumes a ticket and issues an account credential atomically, once", async () => {
    const t = await connected();
    const args = {
      installationCredential: install,
      handoffTicket: ticket,
      codeVerifier: verifier,
      credentialNonce: "G".repeat(43),
    };
    const results = await Promise.allSettled([
      t.mutation(ref("redeem"), args),
      t.mutation(ref("redeem"), args),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const credentials = await t.run((ctx) => ctx.db.query("credentials").collect());
    expect(credentials).toHaveLength(1);
    expect(JSON.stringify(credentials)).not.toContain("meta-test-token");
  });

  it("rejects wrong installation/verifier and expired/reused tickets", async () => {
    const t = await connected();
    const args = {
      installationCredential: install,
      handoffTicket: ticket,
      codeVerifier: verifier,
      credentialNonce: "G".repeat(43),
    };
    await expect(
      t.mutation(ref("redeem"), { ...args, installationCredential: otherInstall }),
    ).rejects.toThrow();
    await expect(
      t.mutation(ref("redeem"), { ...args, codeVerifier: "F".repeat(43) }),
    ).rejects.toThrow();
    vi.useFakeTimers();
    vi.advanceTimersByTime(300_001);
    await expect(t.mutation(ref("redeem"), args)).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("credentials").collect())).toHaveLength(0);
  });

  it("claims callbacks once before external exchange", async () => {
    const t = await connected();
    await expect(t.mutation(internal("claimCallback"), { state })).rejects.toThrow();
  });

  it("runs system-browser callback, Meta exchange and installation-bound HTTP redemption", async () => {
    vi.stubEnv("META_INSTAGRAM_APP_ID", "123456789");
    vi.stubEnv("META_INSTAGRAM_APP_SECRET", "meta-fixture-secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://fixture-123.convex.site");
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return Response.json(
        calls.length === 1
          ? { access_token: "short-fixture-token" }
          : { access_token: "long-fixture-token", expires_in: 3600 },
      );
    });
    const t = convexTest(schema, modules);
    await t.mutation(internal("bootstrap"), { credentialHash: await digest(install) });
    const authorize = await t.fetch("/v1/instagram/authorize", {
      method: "POST",
      headers: { "x-social-installation": install },
      body: JSON.stringify({ accountId, state, codeChallenge: await digest(verifier) }),
    });
    const authorizeUrl = new URL((await authorize.json()).authorizeUrl);
    expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(
      "https://fixture-123.convex.site/v1/instagram/callback",
    );
    const callback = await t.fetch(`/v1/instagram/callback?state=${state}&code=code-fixture`);
    expect(callback.status).toBe(302);
    const deepLink = new URL(callback.headers.get("location")!);
    expect(deepLink.protocol).toBe("social-harness:");
    expect(deepLink.toString()).not.toContain("fixture-token");
    expect(calls).toHaveLength(2);
    const payload = { handoffTicket: deepLink.searchParams.get("code"), codeVerifier: verifier };
    const wrong = await t.fetch("/v1/instagram/redeem", {
      method: "POST",
      headers: { "x-social-installation": "X".repeat(43) },
      body: JSON.stringify(payload),
    });
    expect(wrong.status).toBe(400);
    const redeem = await t.fetch("/v1/instagram/redeem", {
      method: "POST",
      headers: { "x-social-installation": install },
      body: JSON.stringify(payload),
    });
    expect((await redeem.json()).accessToken).toBe("long-fixture-token");
    expect(
      (
        await t.fetch("/v1/instagram/redeem", {
          method: "POST",
          headers: { "x-social-installation": install },
          body: JSON.stringify(payload),
        })
      ).status,
    ).toBe(400);
  });

  it("invalid Meta credentials return a denial deep-link ticket without leaking the provider body", async () => {
    vi.stubEnv("META_INSTAGRAM_APP_ID", "123456789");
    vi.stubEnv("META_INSTAGRAM_APP_SECRET", "invalid-meta-fixture-secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://fixture-123.convex.site");
    vi.stubGlobal("fetch", async () => new Response("sensitive-provider-body", { status: 401 }));
    const t = convexTest(schema, modules);
    await t.mutation(internal("bootstrap"), { credentialHash: await digest(install) });
    await t.mutation(ref("authorize"), {
      installationCredential: install,
      accountId,
      state,
      codeChallenge: await digest(verifier),
    });
    const callback = await t.fetch(`/v1/instagram/callback?state=${state}&code=code-fixture`);
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).not.toContain("sensitive-provider-body");
    const ticket = new URL(callback.headers.get("location")!).searchParams.get("code");
    const redeem = await t.fetch("/v1/instagram/redeem", {
      method: "POST",
      headers: { "x-social-installation": install },
      body: JSON.stringify({ handoffTicket: ticket, codeVerifier: verifier }),
    });
    expect(await redeem.json()).toEqual({ denied: true });
    expect(await t.run((ctx) => ctx.db.query("credentials").collect())).toHaveLength(0);
  });

  it("consumes a denial ticket once without creating account credentials", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal("bootstrap"), { credentialHash: await digest(install) });
    await t.mutation(ref("authorize"), {
      installationCredential: install,
      accountId,
      state,
      codeChallenge: await digest(verifier),
    });
    const flow = await t.mutation(internal("claimCallback"), { state });
    await t.mutation(internal("finishCallback"), {
      flowId: flow.flowId,
      ticketHash: await digest(ticket),
      denied: true,
    });
    const args = {
      installationCredential: install,
      handoffTicket: ticket,
      codeVerifier: verifier,
      credentialNonce: "G".repeat(43),
    };
    expect(await t.mutation(ref("redeem"), args)).toEqual({ denied: true });
    await expect(t.mutation(ref("redeem"), args)).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("credentials").collect())).toHaveLength(0);
    await t.mutation(ref("authorize"), {
      installationCredential: install,
      accountId,
      state: "Z".repeat(43),
      codeChallenge: await digest(verifier),
    });
  });

  it("isolates media leases and rejects size/hash/type mismatches", async () => {
    const t = await connected();
    const tokens = await t.mutation(ref("redeem"), {
      installationCredential: install,
      handoffTicket: ticket,
      codeVerifier: verifier,
      credentialNonce: "G".repeat(43),
    });
    const auth = {
      installationCredential: install,
      credential: tokens.mediaUploadCredential,
      accountId,
    };
    const bytes = new Blob(["approved video"], { type: "video/mp4" });
    const sha256 = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", await bytes.arrayBuffer())),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const lease = await t.mutation(ref("beginUpload"), {
      ...auth,
      idempotencyKey: "request-1234567890",
      sha256,
      size: bytes.size,
      leaseNonce: "H".repeat(22),
    });
    const storageId = await t.run(async (ctx) => {
      const id = await ctx.storage.store(bytes);
      // convex-test 的 storeBlob 尚未保存 contentType；补齐真实直传接口返回的元数据。
      await ctx.db.patch(id, { contentType: "video/mp4" });
      return id;
    });
    await expect(
      t.mutation(ref("finalizeUpload"), {
        ...auth,
        installationCredential: otherInstall,
        leaseId: lease.leaseId,
        storageId,
      }),
    ).rejects.toThrow();
    await expect(
      t.mutation(ref("finalizeUpload"), {
        ...auth,
        accountId: "foreign-account",
        leaseId: lease.leaseId,
        storageId,
      }),
    ).rejects.toThrow();
    const wrong = await t.run((ctx) =>
      ctx.storage.store(new Blob(["wrong"], { type: "video/mp4" })),
    );
    await expect(
      t.mutation(ref("finalizeUpload"), { ...auth, leaseId: lease.leaseId, storageId: wrong }),
    ).rejects.toThrow();
    await t.run((ctx) => ctx.db.patch(storageId, { contentType: "application/octet-stream" }));
    await expect(
      t.mutation(ref("finalizeUpload"), { ...auth, leaseId: lease.leaseId, storageId }),
    ).rejects.toThrow();
    await t.run((ctx) =>
      ctx.db.patch(storageId, { contentType: "video/mp4", sha256: "invalid-digest" }),
    );
    await expect(
      t.mutation(ref("finalizeUpload"), { ...auth, leaseId: lease.leaseId, storageId }),
    ).rejects.toThrow();
    const digestBase64 = btoa(
      String.fromCharCode(...sha256.match(/../gu)!.map((pair) => parseInt(pair, 16))),
    );
    await t.run((ctx) => ctx.db.patch(storageId, { sha256: digestBase64 }));
    const result = await t.mutation(ref("finalizeUpload"), {
      ...auth,
      leaseId: lease.leaseId,
      storageId,
    });
    expect(result.mediaUrl).toMatch(/^https?:/);
    const foreignHash = await digest(otherInstall);
    await t.run(async (ctx) => {
      const owner = await ctx.db
        .query("installations")
        .withIndex("by_hash", (q) => q.eq("credentialHash", foreignHash))
        .unique();
      await ctx.db.insert("credentials", {
        installationId: owner!._id,
        accountId,
        credentialHash: await digest("I".repeat(43)),
      });
    });
    const foreignAuth = {
      installationCredential: otherInstall,
      credential: "I".repeat(43),
      accountId,
    };
    const foreignLease = await t.mutation(ref("beginUpload"), {
      ...foreignAuth,
      idempotencyKey: "request-1234567890",
      sha256,
      size: bytes.size,
      leaseNonce: "J".repeat(22),
    });
    await expect(
      t.mutation(ref("finalizeUpload"), {
        ...foreignAuth,
        leaseId: foreignLease.leaseId,
        storageId,
      }),
    ).rejects.toThrow();
    expect(await t.run(async (ctx) => Boolean(await ctx.storage.get(storageId)))).toBe(true);
    const repeat = await t.mutation(ref("beginUpload"), {
      ...auth,
      idempotencyKey: "request-1234567890",
      sha256,
      size: bytes.size,
      leaseNonce: "H".repeat(22),
    });
    expect(repeat.mediaUrl).toBe(result.mediaUrl);
    await expect(
      t.mutation(ref("deleteLease"), {
        ...auth,
        installationCredential: otherInstall,
        leaseId: lease.leaseId,
      }),
    ).rejects.toThrow();
    await t.mutation(ref("deleteLease"), { ...auth, leaseId: lease.leaseId });
    expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
  });

  it("preserves the 1 GiB file ceiling and rejects conflicting upload retries", async () => {
    const t = await connected();
    const tokens = await t.mutation(ref("redeem"), {
      installationCredential: install,
      handoffTicket: ticket,
      codeVerifier: verifier,
      credentialNonce: "G".repeat(43),
    });
    const args = {
      installationCredential: install,
      credential: tokens.mediaUploadCredential,
      accountId,
      idempotencyKey: "request-1234567890",
      sha256: "0".repeat(64),
      size: 1_073_741_824,
      leaseNonce: "H".repeat(22),
    };
    await expect(
      t.mutation(ref("beginUpload"), { ...args, size: args.size + 1 }),
    ).rejects.toThrow();
    const lease = await t.mutation(ref("beginUpload"), args);
    expect(lease.uploadUrl).toBeTruthy();
    await expect(t.mutation(ref("beginUpload"), { ...args, size: 10 })).rejects.toThrow();
    await expect(
      t.mutation(ref("beginUpload"), { ...args, idempotencyKey: "request-1234567891" }),
    ).rejects.toThrow();
    await t.mutation(ref("deleteLease"), {
      installationCredential: install,
      credential: tokens.mediaUploadCredential,
      accountId,
      leaseId: lease.leaseId,
    });
  });

  it("expires leases, removes orphan uploads and revokes account media on disconnect", async () => {
    const t = await connected();
    const tokens = await t.mutation(ref("redeem"), {
      installationCredential: install,
      handoffTicket: ticket,
      codeVerifier: verifier,
      credentialNonce: "G".repeat(43),
    });
    const auth = {
      installationCredential: install,
      credential: tokens.mediaUploadCredential,
      accountId,
    };
    await t.mutation(ref("beginUpload"), {
      ...auth,
      idempotencyKey: "request-1234567890",
      sha256: "0".repeat(64),
      size: 10,
      leaseNonce: "H".repeat(22),
    });
    const orphan = await t.run((ctx) => ctx.storage.store(new Blob(["orphan"])));
    vi.useFakeTimers();
    vi.advanceTimersByTime(7_200_001);
    await t.mutation(internal("sweep"), {});
    expect(await t.run((ctx) => ctx.db.query("leases").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.storage.get(orphan))).toBeNull();
    await t.mutation(ref("revoke"), { ...auth, all: true });
    await expect(
      t.mutation(ref("beginUpload"), {
        ...auth,
        idempotencyKey: "request-1234567891",
        sha256: "0".repeat(64),
        size: 10,
        leaseNonce: "H".repeat(22),
      }),
    ).rejects.toThrow();
  });
});
