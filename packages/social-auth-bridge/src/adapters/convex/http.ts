import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server.js";
import { makeFunctionReference } from "convex/server";
import { internal } from "./_generated/api.js";
import { digest, nonce } from "./security.js";
const http = httpRouter();
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const route = (path: string, name: string, method: "POST" | "DELETE" = "POST") =>
  http.route({
    path,
    method,
    handler: httpAction(async (ctx, request) => {
      try {
        if (Number(request.headers.get("content-length") ?? 0) > 16_384)
          return json({ code: "invalid-input" }, 400);
        const raw = await request.json();
        const input = raw as Record<string, unknown>;
        if (!input || typeof input !== "object" || Array.isArray(input))
          return json({ code: "invalid-input" }, 400);
        const installationCredential = request.headers.get("x-social-installation") ?? "";
        const credential = request.headers.get("authorization")?.replace(/^Bearer /u, "") ?? "";
        const extra =
          name === "redeem"
            ? { credentialNonce: nonce() }
            : name === "beginUpload"
              ? { leaseNonce: nonce(16) }
              : {};
        const result = await ctx.runMutation(
          makeFunctionReference<"mutation", Record<string, unknown>, unknown>(`bridge:${name}`),
          {
            ...input,
            ...extra,
            installationCredential,
            ...(["beginUpload", "finalizeUpload", "deleteLease", "revoke"].includes(name)
              ? { credential }
              : {}),
          },
        );
        if (name === "authorize") {
          const appId = process.env.META_INSTAGRAM_APP_ID;
          if (!appId || !process.env.META_INSTAGRAM_APP_SECRET)
            return json({ code: "meta-not-configured" }, 409);
          const url = new URL("https://www.instagram.com/oauth/authorize");
          url.search = new URLSearchParams({
            client_id: appId,
            redirect_uri: `${process.env.CONVEX_SITE_URL}/v1/instagram/callback`,
            response_type: "code",
            scope: "instagram_business_basic,instagram_business_content_publish",
            state: String(input.state),
            enable_fb_login: "0",
            force_authentication: "1",
          }).toString();
          return json({ authorizeUrl: url.toString() });
        }
        return json(result);
      } catch {
        return json({ code: "bridge-request-rejected" }, 400);
      }
    }),
  });
route("/v1/setup/status", "status");
route("/v1/instagram/authorize", "authorize");
route("/v1/instagram/redeem", "redeem");
route("/v1/media/reserve", "beginUpload");
route("/v1/media/finalize", "finalizeUpload");
route("/v1/media/delete", "deleteLease");
route("/v1/media/credential", "revoke", "DELETE");
route("/v1/media/credentials", "revoke", "DELETE");
http.route({
  path: "/v1/instagram/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    try {
      const url = new URL(request.url);
      const state = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (!state || state.length > 128 || (code && code.length > 2048))
        return json({ code: "oauth-failed" }, 400);
      const flow = await ctx.runMutation(internal.bridge.claimCallback, { state });
      const ticket = nonce();
      try {
        const appId = process.env.META_INSTAGRAM_APP_ID;
        const appSecret = process.env.META_INSTAGRAM_APP_SECRET;
        if (!appId || !appSecret || !code || url.searchParams.has("error"))
          throw new Error("oauth-failed");
        const short = await fetch("https://api.instagram.com/oauth/access_token", {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: appId,
            client_secret: appSecret,
            grant_type: "authorization_code",
            redirect_uri: `${process.env.CONVEX_SITE_URL}/v1/instagram/callback`,
            code,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!short.ok) throw new Error("oauth-failed");
        const shortBody = (await short.json()) as { access_token?: unknown };
        if (typeof shortBody.access_token !== "string" || !shortBody.access_token)
          throw new Error("oauth-failed");
        const exchange = new URL("https://graph.instagram.com/access_token");
        exchange.search = new URLSearchParams({
          grant_type: "ig_exchange_token",
          client_secret: appSecret,
          access_token: shortBody.access_token,
        }).toString();
        const long = await fetch(exchange, {
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
        if (!long.ok) throw new Error("oauth-failed");
        const token = (await long.json()) as { access_token?: unknown; expires_in?: unknown };
        if (
          typeof token.access_token !== "string" ||
          !token.access_token ||
          typeof token.expires_in !== "number" ||
          !Number.isSafeInteger(token.expires_in) ||
          token.expires_in <= 0
        )
          throw new Error("oauth-failed");
        await ctx.runMutation(internal.bridge.finishCallback, {
          flowId: flow.flowId,
          ticketHash: await digest(ticket),
          accessToken: token.access_token,
          tokenExpiresAt: Date.now() + token.expires_in * 1000,
        });
      } catch {
        // Meta 拒绝或凭据错误也返回安装绑定票据，Host 消费后清除 pending，允许立即重试。
        await ctx.runMutation(internal.bridge.finishCallback, {
          flowId: flow.flowId,
          ticketHash: await digest(ticket),
          denied: true,
        });
      }
      const callback = new URL("social-harness://oauth/callback");
      callback.search = new URLSearchParams({
        state,
        code: ticket,
        _oauth_provider: "instagram",
      }).toString();
      return new Response(null, {
        status: 302,
        headers: {
          location: callback.toString(),
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      });
    } catch {
      return json({ code: "oauth-failed" }, 400);
    }
  }),
});
export default http;
