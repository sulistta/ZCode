import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
  installations: defineTable({ credentialHash: v.string() }).index("by_hash", ["credentialHash"]),
  flows: defineTable({
    installationId: v.id("installations"),
    accountId: v.string(),
    state: v.string(),
    codeChallenge: v.string(),
    expiresAt: v.number(),
    claimed: v.boolean(),
  })
    .index("by_state", ["state"])
    .index("by_expiry", ["expiresAt"]),
  tickets: defineTable({
    installationId: v.id("installations"),
    accountId: v.string(),
    ticketHash: v.string(),
    codeChallenge: v.string(),
    accessToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    denied: v.optional(v.boolean()),
    expiresAt: v.number(),
  })
    .index("by_hash", ["ticketHash"])
    .index("by_expiry", ["expiresAt"]),
  credentials: defineTable({
    installationId: v.id("installations"),
    accountId: v.string(),
    credentialHash: v.string(),
  })
    .index("by_hash", ["credentialHash"])
    .index("by_account", ["installationId", "accountId"]),
  leases: defineTable({
    installationId: v.id("installations"),
    accountId: v.string(),
    leaseId: v.string(),
    idempotencyKey: v.string(),
    sha256: v.string(),
    size: v.number(),
    expiresAt: v.number(),
    storageId: v.optional(v.id("_storage")),
  })
    .index("by_lease", ["leaseId"])
    .index("by_account", ["installationId", "accountId"])
    .index("by_storage", ["storageId"])
    .index("by_expiry", ["expiresAt"]),
});
