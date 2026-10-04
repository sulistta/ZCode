import assert from "node:assert/strict";
import test from "node:test";
import type {
  ExecutionPort,
  FileSystemPort,
  ToolArtifactStorePort,
} from "@social-harness/contracts";
import { WorkflowError, type WorldReadOp } from "@social-harness/dynamic-workflow";
import { executeWorldRead, type WorldReadDeps } from "../src/app/workflow-world-read.js";
import { executeArtifactPublish } from "../src/app/workflow-artifact-publish.js";

function forbiddenPort<T>(): T {
  return new Proxy(
    {},
    {
      get() {
        assert.fail("Account scripts must reject before touching native ports");
      },
    },
  ) as T;
}

function accountDeps() {
  return {
    capabilityScope: "social-account" as const,
    cwd: "/isolated-account",
    executionPort: forbiddenPort<ExecutionPort>(),
    fileSystemPort: forbiddenPort<FileSystemPort>(),
    declaredRunCommands: new Set(["approved-command"]),
  };
}

const worldRequests: [WorldReadOp, unknown[]][] = [
  ["glob", ["**/*"]],
  ["read", ["editorial-profile.json"]],
  ["grep", ["anything"]],
  ["git-changed-files", []],
  ["git-diff", []],
  ["git-status", []],
  ["git-log", []],
  ["run", ["approved-command"]],
];

for (const [op, args] of worldRequests) {
  test(`account workflow rejects ${op} before native IO even after script approval`, async () => {
    await assert.rejects(executeWorldRead(accountDeps() as WorldReadDeps, op, args), (error) => {
      assert.ok(error instanceof WorkflowError);
      assert.equal(error.code, "DriverError");
      assert.match(error.message, /account.*capabilit/iu);
      return true;
    });
  });
}

test("account workflow rejects file artifacts before source lookup or artifact writes", async () => {
  await assert.rejects(
    executeArtifactPublish(
      {
        ...accountDeps(),
        artifactStore: forbiddenPort<ToolArtifactStorePort>(),
        parentSessionId: "parent" as never,
      },
      {
        runId: "run",
        siteId: "file",
        ordinal: 0,
        op: "file",
        id: "video",
        version: 1,
        path: "media.mp4",
      },
    ),
    WorkflowError,
  );
});

test("account markdown artifacts retain the existing parent-session owner without filesystem access", async () => {
  const writes: unknown[] = [];
  const artifactStore = {
    async writeToolResultArtifact(request: unknown) {
      writes.push(request);
      return {
        id: "summary",
        uri: "zcode-artifact://parent/summary",
        bytes: 7,
        contentType: "text/markdown",
        createdAt: new Date(),
      };
    },
  } as ToolArtifactStorePort;
  const result = await executeArtifactPublish(
    { ...accountDeps(), artifactStore, parentSessionId: "parent" as never },
    {
      runId: "run",
      siteId: "markdown",
      ordinal: 0,
      op: "markdown",
      id: "summary",
      version: 1,
      content: "# Ready",
    },
  );
  assert.equal(result.uri, "zcode-artifact://parent/summary");
  assert.equal(result.kind, "markdown");
  assert.equal(writes.length, 1);
  assert.equal((writes[0] as { sessionId: string }).sessionId, "parent");
});

test("ordinary workflow reads still use the supplied filesystem capability", async () => {
  const fileSystemPort = {
    async readTextFile() {
      return { content: "ordinary source" };
    },
  } as unknown as FileSystemPort;
  const result = await executeWorldRead(
    { cwd: "/project", fileSystemPort, executionPort: forbiddenPort<ExecutionPort>() },
    "read",
    ["source.txt"],
  );
  assert.equal(result, "ordinary source");
});
