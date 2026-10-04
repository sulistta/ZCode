import assert from "node:assert/strict";
import test from "node:test";
import { createCliOAuthClient } from "../src/auth/cli-oauth.js";

test("CLI OAuth client fails locally without an explicit service origin", () => {
  let requestCount = 0;
  const httpClient = {
    request: async () => {
      requestCount += 1;
      return { body: new Uint8Array(), headers: {}, status: 200, statusText: "OK" };
    },
  };

  assert.throws(
    () =>
      createCliOAuthClient({
        baseUrl: "",
        httpClient: httpClient as never,
        providerId: "zai",
      }),
    /OAuth service base URL is not configured/u,
  );
  assert.equal(requestCount, 0);
});
