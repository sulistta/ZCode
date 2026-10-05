import { v } from "convex/values";
import { mutation, internalMutation } from "./_generated/server.js";
import type { MutationCtx } from "./_generated/server.js";
import { internal } from "./_generated/api.js";
import { accountCredential, fail, bounded, MEDIA_TTL, MAX_FILE } from "./security.js";
const authArgs = {
  installationCredential: v.string(),
  credential: v.string(),
  accountId: v.string(),
};
async function leaseFor(
  ctx: MutationCtx,
  args: { installationCredential: string; credential: string; accountId: string; leaseId: string },
) {
  const key = await accountCredential(ctx, args);
  const lease = await ctx.db
    .query("leases")
    .withIndex("by_lease", (q) => q.eq("leaseId", args.leaseId))
    .unique();
  if (!lease || lease.installationId !== key.installationId || lease.accountId !== key.accountId)
    fail("invalid-lease");
  return lease;
}
export const beginUpload = mutation({
  args: {
    ...authArgs,
    idempotencyKey: v.string(),
    sha256: v.string(),
    size: v.number(),
    leaseNonce: v.string(),
  },
  handler: async (ctx, args) => {
    const key = await accountCredential(ctx, args);
    bounded(args.idempotencyKey, 16, 128);
    if (
      !/^[a-f0-9]{64}$/u.test(args.sha256) ||
      !/^[A-Za-z0-9_-]{22}$/u.test(args.leaseNonce) ||
      !Number.isSafeInteger(args.size) ||
      args.size <= 0 ||
      args.size > MAX_FILE
    )
      fail("unsupported-video");
    const leases = await ctx.db
      .query("leases")
      .withIndex("by_account", (q) =>
        q.eq("installationId", key.installationId).eq("accountId", args.accountId),
      )
      .take(32);
    const existing = leases.find(
      (lease) => lease.idempotencyKey === args.idempotencyKey && lease.expiresAt > Date.now(),
    );
    if (existing) {
      if (existing.sha256 !== args.sha256 || existing.size !== args.size) fail("request-conflict");
      return {
        leaseId: existing.leaseId,
        expiresAt: existing.expiresAt,
        ...(existing.storageId
          ? { mediaUrl: await ctx.storage.getUrl(existing.storageId) }
          : { uploadUrl: await ctx.storage.generateUploadUrl() }),
      };
    }
    if (leases.some((lease) => lease.expiresAt > Date.now())) fail("upload-in-progress");
    const expiresAt = Date.now() + MEDIA_TTL;
    const id = await ctx.db.insert("leases", {
      installationId: key.installationId,
      accountId: args.accountId,
      leaseId: args.leaseNonce,
      idempotencyKey: args.idempotencyKey,
      sha256: args.sha256,
      size: args.size,
      expiresAt,
    });
    await ctx.scheduler.runAt(expiresAt, internal.bridge.expireLease, {
      leaseId: id,
      force: false,
    });
    return {
      leaseId: args.leaseNonce,
      expiresAt,
      uploadUrl: await ctx.storage.generateUploadUrl(),
    };
  },
});
export const finalizeUpload = mutation({
  args: { ...authArgs, leaseId: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const lease = await leaseFor(ctx, args);
    if (lease.expiresAt <= Date.now()) fail("expired-lease");
    if (lease.storageId && lease.storageId !== args.storageId) fail("request-conflict");
    const other = await ctx.db
      .query("leases")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();
    if (other && other._id !== lease._id) fail("foreign-storage");
    const metadata = await ctx.db.system.get(args.storageId);
    const expectedHash = btoa(
      String.fromCharCode(...lease.sha256.match(/../gu)!.map((pair) => parseInt(pair, 16))),
    );
    if (
      !metadata ||
      metadata.size !== lease.size ||
      metadata.contentType !== "video/mp4" ||
      metadata.sha256 !== expectedHash ||
      metadata._creationTime < lease._creationTime
    )
      fail("invalid-media");
    await ctx.db.patch(lease._id, { storageId: args.storageId });
    const mediaUrl = await ctx.storage.getUrl(args.storageId);
    if (!mediaUrl) fail("invalid-media");
    return { leaseId: lease.leaseId, mediaUrl, expiresAt: lease.expiresAt };
  },
});
export const deleteLease = mutation({
  args: { ...authArgs, leaseId: v.string() },
  handler: async (ctx, args) => {
    const lease = await leaseFor(ctx, args);
    if (lease.storageId) await ctx.storage.delete(lease.storageId);
    await ctx.db.delete(lease._id);
    return null;
  },
});
export const expireLease = internalMutation({
  args: { leaseId: v.id("leases"), force: v.boolean() },
  handler: async (ctx, args) => {
    const lease = await ctx.db.get(args.leaseId);
    if (!lease || (!args.force && lease.expiresAt > Date.now())) return null;
    if (lease.storageId) await ctx.storage.delete(lease.storageId);
    await ctx.db.delete(lease._id);
    return null;
  },
});
export const sweep = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    for (const lease of await ctx.db
      .query("leases")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", Date.now()))
      .take(100)) {
      if (lease.storageId) await ctx.storage.delete(lease.storageId);
      await ctx.db.delete(lease._id);
    }
    for (const flow of await ctx.db
      .query("flows")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", Date.now()))
      .take(100))
      await ctx.db.delete(flow._id);
    for (const ticket of await ctx.db
      .query("tickets")
      .withIndex("by_expiry", (q) => q.lte("expiresAt", Date.now()))
      .take(100))
      await ctx.db.delete(ticket._id);
    const files = await ctx.db.system
      .query("_storage")
      .order("asc")
      .paginate({ numItems: 100, cursor: args.cursor ?? null });
    for (const file of files.page) {
      if (file._creationTime > Date.now() - 3_900_000) continue;
      const owner = await ctx.db
        .query("leases")
        .withIndex("by_storage", (q) => q.eq("storageId", file._id))
        .first();
      if (!owner) await ctx.storage.delete(file._id);
    }
    if (!files.isDone)
      await ctx.scheduler.runAfter(0, internal.bridge.sweep, { cursor: files.continueCursor });
    return null;
  },
});
