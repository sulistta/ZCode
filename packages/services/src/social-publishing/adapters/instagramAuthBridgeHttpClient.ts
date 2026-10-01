import { z } from "zod";
import type {
  InstagramAuthBridge,
  InstagramAuthTokenSet,
} from "../app/ports/instagramAuthBridge.js";

const authorizationResponseSchema = z.object({ authorizeUrl: z.string().url() });
const mediaUploadCredentialSchema = z.string().regex(/^[A-Za-z0-9_-]{43,128}$/u);
const tokenSetSchema = z
  .object({
    accessToken: z.string().min(1),
    expiresAt: z.number().int().nonnegative(),
    mediaUploadCredential: mediaUploadCredentialSchema.optional(),
  })
  .strict();
const temporaryMediaResponseSchema = z
  .object({
    leaseId: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
    mediaUrl: z.string().url(),
    expiresAt: z.number().int().positive(),
  })
  .strict();

export function createInstagramAuthBridgeHttpClient(options: {
  baseUrl: string;
  fetcher?: typeof fetch;
}): InstagramAuthBridge {
  const baseUrl = new URL(options.baseUrl);
  if (
    baseUrl.protocol !== "https:" ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.pathname !== "/" ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error("Instagram auth bridge must use a public HTTPS URL");
  }
  const endpoint = baseUrl.toString().replace(/\/$/u, "");
  const fetcher = options.fetcher ?? fetch;

  async function request(path: string, init: RequestInit): Promise<Response> {
    try {
      const response = await fetcher(`${endpoint}${path}`, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("Instagram auth bridge rejected the request");
      return response;
    } catch {
      throw new Error("Instagram auth bridge is unavailable");
    }
  }

  async function postJson(path: string, body: unknown): Promise<unknown> {
    const response = await request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    try {
      return await response.json();
    } catch {
      throw new Error("Instagram auth bridge returned an invalid response");
    }
  }

  async function revokeMediaCredential(credential: string): Promise<void> {
    await request("/v1/media/credential", {
      method: "DELETE",
      headers: { authorization: `Bearer ${credential}` },
    });
  }

  return {
    async createAuthorization(input) {
      const response = await postJson("/v1/instagram/authorize", input);
      return authorizationResponseSchema.parse(response).authorizeUrl;
    },
    async redeemHandoff(input): Promise<InstagramAuthTokenSet> {
      const response = await postJson("/v1/instagram/redeem", input);
      try {
        return tokenSetSchema.parse(response);
      } catch {
        const mediaUploadCredential =
          typeof response === "object" && response !== null && !Array.isArray(response)
            ? mediaUploadCredentialSchema.safeParse(
                (response as Record<string, unknown>).mediaUploadCredential,
              )
            : null;
        if (mediaUploadCredential?.success) {
          // 兑换已消费票据且可能已创建凭据；响应字段校验失败时回收仍可识别的 key。
          try {
            await revokeMediaCredential(mediaUploadCredential.data);
          } catch {
            // 返回统一错误，不泄露 bridge 响应或凭据；下次连接会轮换该账户的旧 key。
          }
        }
        throw new Error("Instagram auth bridge returned an invalid handoff response");
      }
    },
    async revokeMediaUploadCredential(credential) {
      await revokeMediaCredential(credential);
    },
    async revokeAllMediaUploadCredentials(credential) {
      await request("/v1/media/credentials", {
        method: "DELETE",
        headers: { authorization: `Bearer ${credential}` },
      });
    },
    async uploadTemporaryMedia(input) {
      if (!/^[A-Za-z0-9_-]{43,128}$/u.test(input.credential)) {
        throw new Error("Instagram media upload credential is invalid");
      }
      if (!/^[a-f0-9]{64}$/u.test(input.sha256)) {
        throw new Error("Instagram media digest is invalid");
      }
      if (!/^[A-Za-z0-9_-]{16,128}$/u.test(input.idempotencyKey)) {
        throw new Error("Instagram media idempotency key is invalid");
      }
      const response = await request("/v1/media/upload", {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.credential}`,
          "idempotency-key": input.idempotencyKey,
          "x-social-account-id": input.accountId,
          "x-content-sha256": input.sha256,
          "content-type": "video/mp4",
        },
        body: input.file,
      });
      let parsed: z.infer<typeof temporaryMediaResponseSchema>;
      try {
        parsed = temporaryMediaResponseSchema.parse(await response.json());
      } catch {
        throw new Error("Instagram auth bridge returned an invalid media response");
      }
      const mediaUrl = new URL(parsed.mediaUrl);
      if (
        mediaUrl.origin !== baseUrl.origin ||
        !/^\/v1\/media\/[A-Za-z0-9_-]{43,128}$/u.test(mediaUrl.pathname) ||
        mediaUrl.search ||
        mediaUrl.hash
      ) {
        throw new Error("Instagram auth bridge returned an unsafe media URL");
      }
      return { ...parsed, mediaUrl: mediaUrl.toString() };
    },
    async deleteTemporaryMedia(input) {
      if (!/^[A-Za-z0-9_-]{43,128}$/u.test(input.credential)) {
        throw new Error("Instagram media upload credential is invalid");
      }
      if (!/^[A-Za-z0-9_-]{22}$/u.test(input.leaseId)) {
        throw new Error("Instagram media lease is invalid");
      }
      await request(`/v1/media/${input.leaseId}`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${input.credential}`,
          "x-social-account-id": input.accountId,
        },
      });
    },
  };
}
