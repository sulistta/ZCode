import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  partitionCopiedComponentReviews,
  partitionNpmOverrideReviews,
} from "./generate-third-party-notices.mjs";

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

test("an unresolved copied application component remains in the production review", () => {
  const result = partitionCopiedComponentReviews([
    { id: "application-copy", roots: ["packages/ui/src/copied"], reviewRequired: "missing notice" },
  ]);

  assert.deepEqual(result, {
    reviewRequired: [{ id: "application-copy", reason: "missing notice" }],
    developmentReviewRequired: [],
  });
});

test("development-only agent skill reviews stay outside the application release gate", () => {
  const result = partitionCopiedComponentReviews([
    {
      id: "agent-skill",
      roots: [".agents/skills/example"],
      distributionScope: "development-only",
      reviewRequired: "missing notice",
    },
  ]);

  assert.deepEqual(result, {
    reviewRequired: [],
    developmentReviewRequired: [{ id: "agent-skill", reason: "missing notice" }],
  });
  assert.throws(
    () =>
      partitionCopiedComponentReviews([
        {
          id: "misclassified-runtime-copy",
          roots: ["packages/ui/src/copied"],
          distributionScope: "development-only",
          reviewRequired: "missing notice",
        },
      ]),
    /must stay under \.agents\/skills\//u,
  );
});

test("the local diagnostic viewer stays outside the application production dependency graph", async () => {
  const [debugManifestContents, inventoryContents] = await Promise.all([
    readFile(new URL("../apps/zcode-cli/packages/debug/package.json", import.meta.url), "utf8"),
    readFile(new URL("../third-party/inventory.json", import.meta.url), "utf8"),
  ]);
  const debugManifest = JSON.parse(debugManifestContents);
  const inventory = JSON.parse(inventoryContents);

  assert.equal(debugManifest.private, true);
  assert.deepEqual(debugManifest.dependencies ?? {}, {});
  assert.ok(debugManifest.devDependencies["http-mitm-proxy"]);
  assert.ok(!inventory.reviewRequired.some(({ id }) => id === "semaphore@1.1.0"));
  assert.ok(inventory.developmentReviewRequired.some(({ id }) => id === "semaphore@1.1.0"));
});

test("payment processor SDKs stay out of the Social Harness production dependency graph", async () => {
  const [uiManifestContents, inventoryContents] = await Promise.all([
    readFile(new URL("../packages/ui/package.json", import.meta.url), "utf8"),
    readFile(new URL("../third-party/inventory.json", import.meta.url), "utf8"),
  ]);
  const uiManifest = JSON.parse(uiManifestContents);
  const inventory = JSON.parse(inventoryContents);

  assert.ok(
    !Object.keys(uiManifest.dependencies ?? {}).some((name) => name.startsWith("@stripe/")),
  );
  assert.ok(!inventory.packages.some(({ name }) => name.startsWith("@stripe/")));
});

test("unused generic UI libraries stay out of the Social Harness production manifest", async () => {
  const [uiManifestContents, inventoryContents] = await Promise.all([
    readFile(new URL("../packages/ui/package.json", import.meta.url), "utf8"),
    readFile(new URL("../third-party/inventory.json", import.meta.url), "utf8"),
  ]);
  const uiManifest = JSON.parse(uiManifestContents);
  const inventory = JSON.parse(inventoryContents);
  const unusedProductionDependencies = [
    "@dnd-kit/dom",
    "@dnd-kit/helpers",
    "@dnd-kit/react",
    "@radix-ui/react-radio-group",
    "@rive-app/react-webgl2",
    "@xyflow/react",
    "embla-carousel-react",
    "highlight.js",
    "marked",
    "media-chrome",
    "qrcode",
    "react-jsx-parser",
    "use-stick-to-bottom",
  ];

  for (const name of unusedProductionDependencies) {
    assert.ok(!(name in (uiManifest.dependencies ?? {})), `${name} is not used by the active UI`);
  }
  const packagesRemovedFromProductionGraph = unusedProductionDependencies.filter(
    (name) => !["@radix-ui/react-radio-group", "marked"].includes(name),
  );
  for (const name of packagesRemovedFromProductionGraph) {
    assert.ok(
      !inventory.packages.some((item) => item.name === name),
      `${name} is not in the active production dependency graph`,
    );
  }
  for (const name of ["@rive-app/react-webgl2", "@xyflow/react", "use-stick-to-bottom"]) {
    assert.ok(
      name in (uiManifest.devDependencies ?? {}),
      `${name} remains available for typechecking`,
    );
  }
});
