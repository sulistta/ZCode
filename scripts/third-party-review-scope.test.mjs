import assert from "node:assert/strict";
import test from "node:test";
import { partitionNpmOverrideReviews } from "./generate-third-party-notices.mjs";

test("keeps unresolved npm notice evidence in the production release review", () => {
  const result = partitionNpmOverrideReviews(
    [{ package: "runtime-gap@1.0.0", evidenceKind: "publisher-license-identifier" }],
    new Set(["runtime-gap@1.0.0"]),
    new Set(["runtime-gap@1.0.0"]),
  );

  assert.deepEqual(
    result.reviewRequired.map(({ id }) => id),
    ["runtime-gap@1.0.0"],
  );
  assert.deepEqual(result.developmentReviewRequired, []);
});

test("retains development-only review evidence outside the production gate", () => {
  const result = partitionNpmOverrideReviews(
    [
      {
        package: "tool-gap@1.0.0",
        evidenceKind: "publisher-license-identifier",
        source: "https://registry.example/tool-gap/1.0.0",
      },
    ],
    new Set(),
    new Set(["tool-gap@1.0.0"]),
  );

  assert.deepEqual(result.reviewRequired, []);
  assert.deepEqual(result.developmentReviewRequired, [
    {
      id: "tool-gap@1.0.0",
      reason: "Original version-specific publisher copyright/license material remains incomplete.",
      evidenceKind: "publisher-license-identifier",
      source: "https://registry.example/tool-gap/1.0.0",
    },
  ]);
});

test("a package in both graphs remains production-scoped and stale overrides fail", () => {
  const result = partitionNpmOverrideReviews(
    [{ package: "shared-gap@1.0.0", acceptedMissingNotice: "reviewed" }],
    new Set(["shared-gap@1.0.0"]),
    new Set(["shared-gap@1.0.0"]),
  );

  assert.deepEqual(
    result.reviewRequired.map(({ id }) => id),
    ["shared-gap@1.0.0"],
  );
  assert.throws(
    () => partitionNpmOverrideReviews([{ package: "stale-gap@1.0.0" }], new Set(), new Set()),
    /Stale npm notice override: stale-gap@1\.0\.0/u,
  );
});
