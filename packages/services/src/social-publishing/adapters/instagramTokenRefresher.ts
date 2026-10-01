import { z } from "zod";
import type { InstagramTokenRefresher } from "../app/ports/instagramTokenRefresher.js";

const tokenResponseSchema = z.object({
  access_token: z.string().trim().min(1),
  expires_in: z.number().int().positive(),
});

export function createInstagramTokenRefresher(options?: {
  fetcher?: typeof fetch;
  now?: () => number;
}): InstagramTokenRefresher {
  const fetcher = options?.fetcher ?? fetch;
  const now = options?.now ?? Date.now;

  return {
    async refresh(accessToken) {
      const url = new URL("https://graph.instagram.com/refresh_access_token");
      url.searchParams.set("grant_type", "ig_refresh_token");
      url.searchParams.set("access_token", accessToken);
      let response: Response;
      try {
        response = await fetcher(url, {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new Error("Instagram token refresh is unavailable");
      }
      if (!response.ok) throw new Error("Instagram token refresh was rejected");
      try {
        const result = tokenResponseSchema.parse(await response.json());
        return {
          accessToken: result.access_token,
          expiresAt: Math.max(0, Math.trunc(now() + result.expires_in * 1_000)),
        };
      } catch {
        throw new Error("Instagram token refresh returned an invalid response");
      }
    },
  };
}
