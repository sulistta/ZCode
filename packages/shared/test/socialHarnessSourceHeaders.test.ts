import assert from "node:assert/strict";
import test from "node:test";
import { buildZCodeSourceHeadersFromContext } from "../src/zcode-source-headers.js";

test("source headers use Social Harness identity without a default referer", () => {
  const headers = buildZCodeSourceHeadersFromContext({
    appVersion: "3.14.0",
    sourceTitle: "desktop",
  });

  assert.equal(headers["User-Agent"], "Social Harness/3.14.0");
  assert.equal(headers["X-Title"], "Social Harness@desktop");
  assert.equal(headers["X-Social-Harness-App-Version"], "3.14.0");
  assert.equal(headers["HTTP-Referer"], undefined);
  assert.equal(headers["X-ZCode-App-Version"], undefined);
});

test("source headers include a referer only when one is provided", () => {
  const headers = buildZCodeSourceHeadersFromContext({
    endpointOrigin: "https://social.example.test",
  });

  assert.equal(headers["HTTP-Referer"], "https://social.example.test");
});
