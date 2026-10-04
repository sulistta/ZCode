import { z } from "zod";
import { createHash } from "node:crypto";
import { convexDeploymentUrlSchema } from "@social-harness/shared";
import type {
  InstagramAuthBridge,
  InstagramAuthTokenSet,
} from "../app/ports/instagramAuthBridge.js";
import { convexSiteUrl } from "../app/instagramConvexSetup.js";
import { SocialPublishingError } from "../app/socialPublishingError.js";
const leaseSchema = z
  .object({
    leaseId: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
    expiresAt: z.number().int().positive(),
    mediaUrl: z.string().url(),
  })
  .strict();
const reserveSchema = z
  .object({
    leaseId: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
    expiresAt: z.number().int().positive(),
    uploadUrl: z.string().url().optional(),
    mediaUrl: z.string().url().optional(),
  })
  .strict();
const tokensSchema = z
  .object({
    accessToken: z.string().min(1).max(8192),
    expiresAt: z.number().int().positive(),
    mediaUploadCredential: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u),
  })
  .strict();
export function createInstagramConvexBridgeHttpClient(options: {
  deploymentUrl: string;
  installationCredential: string;
  fetcher?: typeof fetch;
}): InstagramAuthBridge & {
  status(): Promise<{ version: number; metaConfigured: boolean }>;
} {
  const deploymentUrl = convexDeploymentUrlSchema.parse(options.deploymentUrl);
  const origin = new URL(deploymentUrl).origin;
  const site = convexSiteUrl(deploymentUrl);
  const fetcher = options.fetcher ?? fetch;
  function safeStorageUrl(value: string): string {
    const url = new URL(value);
    if (
      url.origin !== origin ||
      !url.pathname.startsWith("/api/storage/") ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error("Unsafe Convex storage URL");
    return url.toString();
  }
  async function request(url: string, init: RequestInit, timeout = 15_000): Promise<Response> {
    let response: Response;
    try {
      response = await fetcher(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new SocialPublishingError(
        "authorization-unavailable",
        "Convex could not be reached. Retry when the connection is available.",
      );
    }
    if (!response.ok) {
      const body = (await response.text()).slice(0, 2048);
      if (
        [402, 429, 507].includes(response.status) ||
        /quota|usage[ _-]?limit|capacity|(?:resource|storage|bandwidth|function).*limit|deployment.*disabled/iu.test(
          body,
        )
      ) {
        throw new SocialPublishingError(
          "capacity-unavailable",
          "Convex capacity is unavailable. Check your team's Usage panel and retry after capacity is available.",
        );
      }
      throw new SocialPublishingError(
        "authorization-invalid",
        "Convex rejected this request. Check project setup and reconnect.",
      );
    }
    return response;
  }
  async function post(
    path: string,
    body: unknown,
    credential?: string,
    method = "POST",
  ): Promise<unknown> {
    const response = await request(`${site}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-social-installation": options.installationCredential,
        ...(credential ? { authorization: `Bearer ${credential}` } : {}),
      },
      body: JSON.stringify(body),
    });
    try {
      return await response.json();
    } catch {
      throw new Error("Convex returned an invalid response");
    }
  }
  const client = {
    async status() {
      return z
        .object({ version: z.number().int(), metaConfigured: z.boolean() })
        .strict()
        .parse(await post("/v1/setup/status", {}));
    },
    async createAuthorization(input: { accountId: string; state: string; codeChallenge: string }) {
      return z
        .object({ authorizeUrl: z.string().url() })
        .strict()
        .parse(await post("/v1/instagram/authorize", input)).authorizeUrl;
    },
    async redeemHandoff(input: {
      handoffTicket: string;
      codeVerifier: string;
    }): Promise<InstagramAuthTokenSet> {
      const response = await post("/v1/instagram/redeem", input);
      const parsed = tokensSchema.safeParse(response);
      if (!parsed.success) {
        const key = z
          .object({ mediaUploadCredential: tokensSchema.shape.mediaUploadCredential })
          .safeParse(response);
        if (key.success) {
          try {
            await client.revokeMediaUploadCredential(key.data.mediaUploadCredential);
          } catch {
            /* 无法回收时保留统一错误，不泄露响应。 */
          }
        }
        throw new Error("Convex returned an invalid handoff response");
      }
      return {
        ...parsed.data,
        bridgeOrigin: site,
        bridgeInstallationHash: createHash("sha256")
          .update(options.installationCredential)
          .digest("base64url"),
      };
    },
    async revokeMediaUploadCredential(credential: string) {
      await post("/v1/media/credential", { all: false }, credential, "DELETE");
    },
    async revokeAllMediaUploadCredentials(credential: string) {
      await post("/v1/media/credentials", { all: true }, credential, "DELETE");
    },
    async deleteTemporaryMedia(input: { accountId: string; credential: string; leaseId: string }) {
      await post(
        "/v1/media/delete",
        { accountId: input.accountId, leaseId: input.leaseId },
        input.credential,
      );
    },
    async uploadTemporaryMedia(input: {
      accountId: string;
      credential: string;
      file: Blob;
      idempotencyKey: string;
      sha256: string;
    }) {
      const reserve = reserveSchema.parse(
        await post(
          "/v1/media/reserve",
          {
            accountId: input.accountId,
            size: input.file.size,
            sha256: input.sha256,
            idempotencyKey: input.idempotencyKey,
          },
          input.credential,
        ),
      );
      if (reserve.expiresAt <= Date.now()) throw new Error("Convex media lease expired");
      if (reserve.mediaUrl)
        return {
          leaseId: reserve.leaseId,
          expiresAt: reserve.expiresAt,
          mediaUrl: safeStorageUrl(reserve.mediaUrl),
        };
      if (!reserve.uploadUrl) throw new Error("Convex did not authorize an upload");
      const uploadUrl = safeStorageUrl(reserve.uploadUrl);
      try {
        const upload = await request(
          uploadUrl,
          {
            method: "POST",
            headers: {
              "content-type": "video/mp4",
              digest: `sha-256=${Buffer.from(input.sha256, "hex").toString("base64")}`,
            },
            body: input.file,
          },
          120_000,
        );
        const { storageId } = z
          .object({ storageId: z.string().min(1).max(200) })
          .parse(await upload.json());
        const lease = leaseSchema.parse(
          await post(
            "/v1/media/finalize",
            { accountId: input.accountId, leaseId: reserve.leaseId, storageId },
            input.credential,
          ),
        );
        if (lease.leaseId !== reserve.leaseId || lease.expiresAt <= Date.now())
          throw new Error("Convex returned an invalid media lease");
        return { ...lease, mediaUrl: safeStorageUrl(lease.mediaUrl) };
      } catch (error) {
        try {
          await client.deleteTemporaryMedia({
            accountId: input.accountId,
            credential: input.credential,
            leaseId: reserve.leaseId,
          });
        } catch {
          /* 清理失败由部署的过期任务和 orphan sweep 重试。 */
        }
        throw error;
      }
    },
  };
  return client;
}
