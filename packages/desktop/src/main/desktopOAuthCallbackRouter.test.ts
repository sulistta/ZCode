import assert from "node:assert/strict";
import test from "node:test";
import { createOAuthCallbackRouter } from "./desktopOAuthCallbackRouter.js";

test("callback state routes to its registered WebContents and is consumed after delivery", () => {
  const router = createOAuthCallbackRouter();
  const state = "account-flow-state";
  const callbackUrl = `social-harness://oauth/callback?state=${state}&code=opaque-ticket&_oauth_provider=zai`;
  router.register(41, { provider: "instagram", state });

  const route = router.resolve(state, callbackUrl, true);
  assert.ok(route);
  assert.equal(route.webContentsId, 41);
  const routedUrl = new URL(route.url);
  assert.equal(routedUrl.searchParams.get("_oauth_provider"), "instagram");
  assert.equal(routedUrl.searchParams.get("code"), "opaque-ticket");
  router.acknowledgeDelivery(route);

  assert.equal(router.resolve(state, callbackUrl, true), null);
});

test("unknown and expired callback state is not queued for another WebContents", () => {
  const router = createOAuthCallbackRouter();
  const url = "social-harness://oauth/callback?state=unknown&code=opaque-ticket";

  assert.equal(router.resolve("unknown", url, true), null);
  router.register(41, { state: "expired" });
  router.expire("expired", 41);
  assert.equal(router.resolve("expired", url, true), null);
  assert.deepEqual(router.pendingForWebContents(41), []);
  assert.deepEqual(router.pendingForWebContents(99), []);
});

test("a callback waiting for its renderer cannot be delivered to a different WebContents", () => {
  const router = createOAuthCallbackRouter();
  const state = "waiting-renderer-state";
  const url = `social-harness://oauth/callback?state=${state}&code=opaque-ticket`;
  router.register(41, { state });
  const route = router.resolve(state, url, true);

  assert.ok(route);
  assert.equal(router.queue(route), true);
  assert.equal(router.resolve(state, url, true), null);
  assert.deepEqual(router.pendingForWebContents(99), []);
  assert.deepEqual(router.pendingForWebContents(41), [route]);
  router.acknowledgeDelivery(route);
  assert.deepEqual(router.pendingForWebContents(41), []);
  assert.equal(router.resolve(state, url, true), null);
});

test("expiring or clearing a WebContents removes only its queued callback state", () => {
  const router = createOAuthCallbackRouter();
  const stateA = "state-a";
  const stateB = "state-b";
  router.register(41, { state: stateA });
  router.register(42, { state: stateB });
  const routeA = router.resolve(
    stateA,
    `social-harness://oauth/callback?state=${stateA}&code=ticket-a`,
    true,
  );
  const routeB = router.resolve(
    stateB,
    `social-harness://oauth/callback?state=${stateB}&code=ticket-b`,
    true,
  );
  assert.ok(routeA);
  assert.ok(routeB);
  assert.equal(router.queue(routeA), true);
  assert.equal(router.queue(routeB), true);

  router.expire(stateA, 41);
  assert.deepEqual(router.pendingForWebContents(41), []);
  assert.deepEqual(router.pendingForWebContents(42), [routeB]);
  router.clearWebContents(42);
  assert.deepEqual(router.pendingForWebContents(42), []);
  assert.equal(router.resolve(stateB, routeB.url, true), null);
});
