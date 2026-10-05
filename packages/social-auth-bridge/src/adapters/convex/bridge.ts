import { v } from "convex/values";
import { mutation, internalMutation } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { bounded, digest, fail, installation, accountCredential, TTL } from "./security.js";
export { beginUpload, finalizeUpload, deleteLease, expireLease, sweep } from "./media.js";

export const bootstrap = internalMutation({
  args: { credentialHash: v.string(), previousHash: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(args.credentialHash)) fail("invalid-input");
    // 同一部署更新时沿用安装身份，日常凭据不由管理 key 充当。
    const old = args.previousHash
      ? await ctx.db
          .query("installations")
          .withIndex("by_hash", (q) => q.eq("credentialHash", args.previousHash!))
          .unique()
      : null;
    if (old) {
      await ctx.db.patch(old._id, { credentialHash: args.credentialHash });
      return null;
    }
    const duplicate = await ctx.db
      .query("installations")
      .withIndex("by_hash", (q) => q.eq("credentialHash", args.credentialHash))
      .unique();
    if (!duplicate) await ctx.db.insert("installations", { credentialHash: args.credentialHash });
    return null;
  },
});
export const status = mutation({
  args: { installationCredential: v.string() },
  handler: async (ctx, args) => {
    await installation(ctx, args.installationCredential);
    return {
      version: 1,
      metaConfigured: Boolean(
        process.env.META_INSTAGRAM_APP_ID && process.env.META_INSTAGRAM_APP_SECRET,
      ),
    };
  },
});
export const authorize = mutation({
  args: {
    installationCredential: v.string(),
    accountId: v.string(),
    state: v.string(),
    codeChallenge: v.string(),
  },
  handler: async (ctx, args) => {
    const owner = await installation(ctx, args.installationCredential);
    bounded(args.accountId, 1, 128);
    if (
      !/^[A-Za-z0-9_-]{43,128}$/u.test(args.state) ||
      !/^[A-Za-z0-9_-]{43}$/u.test(args.codeChallenge)
    )
      fail("invalid-input");
    if (
      await ctx.db
        .query("flows")
        .withIndex("by_state", (q) => q.eq("state", args.state))
        .first()
    )
      fail("state-used");
    const expiresAt = Date.now() + TTL;
    await ctx.db.insert("flows", {
      installationId: owner._id,
      accountId: args.accountId,
      state: args.state,
      codeChallenge: args.codeChallenge,
      expiresAt,
      claimed: false,
    });
    return { expiresAt };
  },
});
export const claimCallback = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const flow = await ctx.db
      .query("flows")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!flow || flow.claimed || flow.expiresAt <= Date.now()) fail("invalid-state");
    await ctx.db.patch(flow._id, { claimed: true });
    return { flowId: flow._id };
  },
});
export const finishCallback = internalMutation({
  args: {
    flowId: v.id("flows"),
    ticketHash: v.string(),
    accessToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    denied: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const flow = await ctx.db.get(args.flowId);
    if (!flow || !flow.claimed || flow.expiresAt <= Date.now()) fail("invalid-state");
    if (
      !args.denied &&
      (!args.accessToken || !args.tokenExpiresAt || args.tokenExpiresAt <= Date.now())
    )
      fail("invalid-token");
    await ctx.db.insert("tickets", {
      installationId: flow.installationId,
      accountId: flow.accountId,
      codeChallenge: flow.codeChallenge,
      ticketHash: args.ticketHash,
      accessToken: args.accessToken,
      tokenExpiresAt: args.tokenExpiresAt,
      denied: args.denied ?? false,
      expiresAt: Date.now() + TTL,
    });
    await ctx.db.delete(flow._id);
    return null;
  },
});
export const redeem = mutation({
  args: {
    installationCredential: v.string(),
    handoffTicket: v.string(),
    codeVerifier: v.string(),
    credentialNonce: v.string(),
  },
  handler: async (ctx, args) => {
    const owner = await installation(ctx, args.installationCredential);
    bounded(args.handoffTicket, 43, 128);
    bounded(args.codeVerifier, 43, 128);
    bounded(args.credentialNonce, 43, 128);
    const hash = await digest(args.handoffTicket);
    const ticket = await ctx.db
      .query("tickets")
      .withIndex("by_hash", (q) => q.eq("ticketHash", hash))
      .unique();
    if (
      !ticket ||
      ticket.expiresAt <= Date.now() ||
      ticket.installationId !== owner._id ||
      ticket.codeChallenge !== (await digest(args.codeVerifier))
    )
      fail("invalid-ticket");
    if (ticket.denied) {
      await ctx.db.delete(ticket._id);
      return { denied: true };
    }
    const keys = await ctx.db
      .query("credentials")
      .withIndex("by_account", (q) =>
        q.eq("installationId", owner._id).eq("accountId", ticket.accountId),
      )
      .take(4);
    if (keys.length >= 4) fail("credential-capacity");
    const credentialHash = await digest(args.credentialNonce);
    if (
      await ctx.db
        .query("credentials")
        .withIndex("by_hash", (q) => q.eq("credentialHash", credentialHash))
        .first()
    )
      fail("credential-used");
    await ctx.db.insert("credentials", {
      installationId: owner._id,
      accountId: ticket.accountId,
      credentialHash,
    });
    await ctx.db.delete(ticket._id);
    return {
      accessToken: ticket.accessToken,
      expiresAt: ticket.tokenExpiresAt,
      mediaUploadCredential: args.credentialNonce,
    };
  },
});
export const revoke = mutation({
  args: {
    installationCredential: v.string(),
    credential: v.string(),
    accountId: v.optional(v.string()),
    all: v.boolean(),
  },
  handler: async (ctx, args) => {
    const owner = await installation(ctx, args.installationCredential);
    const hash = await digest(args.credential);
    const key = await ctx.db
      .query("credentials")
      .withIndex("by_hash", (q) => q.eq("credentialHash", hash))
      .unique();
    if (
      !key ||
      key.installationId !== owner._id ||
      (args.accountId && key.accountId !== args.accountId)
    )
      fail();
    await accountCredential(ctx, { ...args, accountId: key.accountId });
    const keys = await ctx.db
      .query("credentials")
      .withIndex("by_account", (q) =>
        q.eq("installationId", owner._id).eq("accountId", key.accountId),
      )
      .take(4);
    for (const item of args.all ? keys : [key]) await ctx.db.delete(item._id);
    if (args.all || keys.length === 1) {
      const leases = await ctx.db
        .query("leases")
        .withIndex("by_account", (q) =>
          q.eq("installationId", owner._id).eq("accountId", key.accountId),
        )
        .take(32);
      for (const lease of leases)
        await ctx.scheduler.runAfter(0, internal.bridge.expireLease, {
          leaseId: lease._id,
          force: true,
        });
    }
    return null;
  },
});
