import { z } from "zod";
import type { InstagramGraphTokenSet } from "../contract.js";

const shortTokenResponseSchema = z.object({
  access_token: z.string().min(1),
});

const longTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

export interface MetaInstagramOAuthClient {
  exchangeAuthorizationCode(code: string, redirectUri: string): Promise<InstagramGraphTokenSet>;
}

export function createMetaInstagramOAuthClient(options: {
  appId: string;
  appSecret: string;
  fetcher?: typeof fetch;
  now?: () => number;
}): MetaInstagramOAuthClient {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;

  return {
    async exchangeAuthorizationCode(code, redirectUri) {
      const form = new URLSearchParams({
        client_id: options.appId,
        client_secret: options.appSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      });
      const shortResponse = await fetcher("https://api.instagram.com/oauth/access_token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!shortResponse.ok) throw new Error("Instagram authorization code exchange failed");
      const shortToken = shortTokenResponseSchema.parse(await shortResponse.json());

      const longTokenUrl = new URL("https://graph.instagram.com/access_token");
      longTokenUrl.searchParams.set("grant_type", "ig_exchange_token");
      longTokenUrl.searchParams.set("client_secret", options.appSecret);
      longTokenUrl.searchParams.set("access_token", shortToken.access_token);
      const longResponse = await fetcher(longTokenUrl, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
      });
      if (!longResponse.ok) throw new Error("Instagram long-lived token exchange failed");
      const longToken = longTokenResponseSchema.parse(await longResponse.json());
      return {
        accessToken: longToken.access_token,
        expiresAt: Math.max(0, Math.trunc(now() + longToken.expires_in * 1_000)),
      };
    },
  };
}
