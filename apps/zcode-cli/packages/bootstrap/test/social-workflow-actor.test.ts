import assert from "node:assert/strict";
import test from "node:test";
import { createInMemorySessionEventStore } from "@social-harness/adapters/storage";
import {
  AgentRuntime,
  PermissionService,
  defaultPermissionConfig,
  type AgentRuntimeConfig,
} from "@social-harness/core";
import type {
  AgentExecutionTelemetryPort,
  PermissionBrokerPort,
  PermissionBrokerRequest,
  SocialAgentPort,
  SocialProjectPort,
  TraceContext,
} from "@social-harness/contracts";
import {
  createScriptWorkflowAgentRuntime,
  type ScriptWorkflowAgentRuntimeDeps,
} from "../src/app/script-workflow-child-runtime.js";

function actorFixture(identity = "social-account:fixture-account", changedMode?: "plan" | "yolo") {
  const requests: PermissionBrokerRequest[] = [];
  const permissionBroker: PermissionBrokerPort = {
    async requestPermission(request) {
      requests.push(request);
      return { decision: "deny" };
    },
  };
  const runtimeConfig = {
    workspaceIdentity: identity,
    workingDirectory: "/isolated-account",
    mode: "build",
    dynamicWorkflowEnabled: false,
  } as AgentRuntimeConfig;
  const parent = new AgentRuntime("parent" as never, runtimeConfig, {
    permissionBroker,
    eventStore: createInMemorySessionEventStore(),
  });
  if (changedMode) parent.updateConfig({ mode: changedMode });
  const parentInternal = parent as unknown as {
    agentTelemetry: { port: AgentExecutionTelemetryPort };
  };
  const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() {
      return logger;
    },
  };
  let reads = 0;
  let observedTrace: TraceContext | undefined;
  const socialProjectPort = {
    async list(options?: { traceContext?: TraceContext }) {
      reads++;
      observedTrace = options?.traceContext;
      return [];
    },
    async executeCommand() {
      assert.fail("A denied actor command cannot reach the Host");
    },
  } as unknown as SocialProjectPort;
  const socialAgentPort = {} as SocialAgentPort;
  const ports = {
    executionPort: {},
    fileSystemPort: {},
    contextSourcePort: {},
    httpClientPort: {},
    socialAgentPort,
    socialProjectPort,
  };
  const deps = {
    appOptions: ports,
    agentTelemetry: parentInternal.agentTelemetry.port,
    appVersion: "fixture",
    configResult: { config: { network: {}, features: { skill: false } } },
    fileSystemPort: {},
    imageProcessorPort: {},
    logger,
    modelFactory: () => {
      assert.fail("Constructing an actor must not contact a model");
    },
    permissionService: new PermissionService(defaultPermissionConfig),
    runtime: parent,
    runtimeConfig,
    sessionId: "parent",
    sessionStore: undefined,
    storageRoot: "/isolated-fixture",
    workingDirectory: "/isolated-account",
  } as unknown as ScriptWorkflowAgentRuntimeDeps;
  const actor = createScriptWorkflowAgentRuntime({
    childSessionId: "child" as never,
    deps,
    request: { opts: {} } as never,
    configOverrides: {
      mode: "yolo",
      taskType: "subagent_child",
      workspaceIdentity: "other-account" as never,
      workingDirectory: "/other-account",
    },
    traceContext: { traceId: "fixture-trace" as never },
    workflowSubmitPort: {} as never,
    workflowEscalatePort: {} as never,
  });
  const internal = actor as unknown as {
    config: AgentRuntimeConfig;
    registry: { list(): string[] };
    executor: { execute(input: unknown): Promise<{ success: boolean }> };
    permissionBroker: PermissionBrokerPort;
  };
  return { actor, parent, internal, requests, readCount: () => reads, trace: () => observedTrace };
}

test("account actor inherits trusted identity, directory and mode despite persona overrides", () => {
  const f = actorFixture();
  try {
    assert.equal(f.actor.getMode(), "build");
    assert.equal(f.internal.config.workspaceIdentity, "social-account:fixture-account");
    assert.equal(f.internal.config.workingDirectory, "/isolated-account");
    assert.equal(f.internal.config.taskType, "workflow_child");
    const tools = f.internal.registry.list();
    for (const name of ["SocialProjectList", "SocialAgentGetContext", "submit_result", "escalate"])
      assert.ok(tools.includes(name), name);
    for (const name of ["Bash", "Read", "WebFetch", "CreateWorkflow", "SaveWorkflow"])
      assert.equal(tools.includes(name), false, name);
  } finally {
    f.actor.beginShutdown();
    f.parent.beginShutdown();
  }
});

test("account actor tools use the parent's injected social ports and preserve trace", async () => {
  const f = actorFixture();
  try {
    const result = await f.internal.executor.execute({
      id: "read",
      name: "SocialProjectList",
      input: {},
    });
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(f.readCount(), 1);
    assert.equal(f.trace()?.traceId, "fixture-trace");
    assert.equal(f.requests.length, 0);
  } finally {
    f.actor.beginShutdown();
    f.parent.beginShutdown();
  }
});

test("denied account actor edits ask through the parent and never reach the Host", async () => {
  const f = actorFixture();
  try {
    const result = await f.internal.executor.execute({
      id: "edit",
      name: "SocialProjectCommand",
      input: {
        projectId: "fixture-project",
        expectedRevision: 0,
        operation: { type: "rename-project", displayName: "Denied edit" },
      },
    });
    assert.equal(result.success, false);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0]?.sessionId, "parent");
    assert.equal(f.requests[0]?.origin?.childSessionId, "child");
  } finally {
    f.actor.beginShutdown();
    f.parent.beginShutdown();
  }
});

test("actor admission uses the parent's current mode after an in-session change", () => {
  const f = actorFixture("social-account:fixture-account", "plan");
  try {
    assert.equal(f.actor.getMode(), f.parent.getMode());
    assert.equal(f.actor.getPlanEnabled(), f.parent.getPlanEnabled());
  } finally {
    f.actor.beginShutdown();
    f.parent.beginShutdown();
  }
});

test("actor permission requests route through the existing parent client port with child origin", async () => {
  const f = actorFixture();
  try {
    const response = await f.internal.permissionBroker.requestPermission({
      sessionId: "child",
      turnId: "child-turn",
      toolName: "SocialProjectCommand",
      traceId: "fixture-trace",
    } as PermissionBrokerRequest);
    assert.equal(response.decision, "deny");
    assert.equal(f.requests[0]?.sessionId, "parent");
    assert.equal(f.requests[0]?.origin?.childSessionId, "child");
  } finally {
    f.actor.beginShutdown();
    f.parent.beginShutdown();
  }
});

test("ordinary workflow actors retain their existing configuration behavior", () => {
  const f = actorFixture("ordinary-workspace");
  try {
    assert.equal(f.actor.getMode(), "yolo");
    assert.equal(f.internal.config.workspaceIdentity, "other-account");
  } finally {
    f.actor.beginShutdown();
    f.parent.beginShutdown();
  }
});
