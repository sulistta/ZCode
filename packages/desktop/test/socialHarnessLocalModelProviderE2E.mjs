import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import {
  ApiKeyAccessConfig,
  ModelConfig,
  ProviderApiConfig,
  ProviderConfig,
} from "@social-harness/provider";
import { NodePersonalProviderConfigRepository } from "@social-harness/provider-node";

function parseToolContent(content) {
  if (typeof content === "string") {
    try {
      return JSON.parse(content);
    } catch {
      return content;
    }
  }
  if (Array.isArray(content)) {
    const text = content.find((item) => item && typeof item.text === "string")?.text;
    return text === undefined ? content : parseToolContent(text);
  }
  if (content && typeof content === "object" && typeof content.text === "string") {
    return parseToolContent(content.text);
  }
  return content;
}

function collectToolResults(messages) {
  const toolNamesById = new Map();
  for (const message of messages ?? []) {
    for (const toolCall of message.tool_calls ?? []) {
      if (toolCall.id && toolCall.function?.name) {
        toolNamesById.set(toolCall.id, toolCall.function.name);
      }
    }
  }
  return (messages ?? [])
    .filter((message) => message.role === "tool")
    .map((message) => ({
      name: message.name ?? toolNamesById.get(message.tool_call_id),
      content: parseToolContent(message.content),
    }));
}

function planProjectEditResponse(body, projectEdit, projectEditToolCalls) {
  const messages = body.messages ?? [];
  const requestStart = messages.findLastIndex(
    (message) => message.role === "user" && JSON.stringify(message).includes(projectEdit.marker),
  );
  assert.notEqual(
    requestStart,
    -1,
    `Expected current user message to include ${projectEdit.marker}`,
  );
  const results = collectToolResults(messages.slice(requestStart));
  const hasResult = (name) => results.some((result) => result.name === name);
  const getResult = (name) => results.findLast((result) => result.name === name)?.content;
  const callTool = (name, args) => {
    const tool = body.tools?.find((candidate) => candidate.function?.name === name);
    assert.ok(tool, `The account conversation must offer ${name} to the model`);
    projectEditToolCalls.push({ marker: projectEdit.marker, name, arguments: args });
    return {
      id: `call_social_harness_e2e_${projectEditToolCalls.length}`,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    };
  };

  if (!hasResult("SocialAgentGetContext")) {
    return { toolCalls: [callTool("SocialAgentGetContext", {})] };
  }
  if (!hasResult("SocialProjectList")) {
    return { toolCalls: [callTool("SocialProjectList", {})] };
  }

  const listResult = getResult("SocialProjectList");
  const targetProject = listResult?.projects?.find(
    (project) => project.displayName === projectEdit.projectName,
  );
  assert.ok(
    targetProject?.projectId,
    `Expected project ${projectEdit.projectName} in the account list`,
  );
  if (!hasResult("SocialProjectRead")) {
    return {
      toolCalls: [callTool("SocialProjectRead", { projectId: targetProject.projectId })],
    };
  }

  const readResult = getResult("SocialProjectRead");
  const project = readResult?.project?.project;
  assert.equal(
    project?.projectId,
    targetProject.projectId,
    "The model must read the listed project",
  );
  const textTrack = project.tracks.find((track) => track.type === "text");
  const textClip = textTrack?.clips.find((clip) => clip.kind === "text");
  assert.ok(textTrack && textClip, `Expected a text clip in ${projectEdit.projectName}`);
  if (!hasResult("SocialProjectCommand")) {
    return {
      toolCalls: [
        callTool("SocialProjectCommand", {
          projectId: project.projectId,
          expectedRevision: project.revision,
          operation: {
            type: "put-clip",
            trackId: textTrack.trackId,
            clip: { ...textClip, text: projectEdit.captionText },
          },
        }),
      ],
    };
  }

  const commandResult = getResult("SocialProjectCommand");
  if (projectEdit.expectedCommandError) {
    assert.ok(
      JSON.stringify(commandResult).includes(projectEdit.expectedCommandError),
      `Expected the SocialProjectCommand result to include ${projectEdit.expectedCommandError}`,
    );
    return { content: projectEdit.finalResponseText };
  }

  const updatedProject = commandResult?.result?.project;
  assert.equal(
    updatedProject?.revision,
    project.revision + 1,
    "The Host must accept the SocialProjectCommand and advance the project revision",
  );
  assert.equal(
    updatedProject.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.clipId === textClip.clipId)?.text,
    projectEdit.captionText,
    "The accepted Host result must contain the edited caption",
  );

  return { content: projectEdit.finalResponseText };
}

export function createSocialProjectEditScenario(runId, projectName) {
  const scenario = {
    marker: `SOCIAL_HARNESS_PROJECT_EDIT_${runId}`,
    blockedMarker: `SOCIAL_HARNESS_PROJECT_EDIT_BLOCKED_${runId}`,
    resumeMarker: `SOCIAL_HARNESS_PROJECT_EDIT_RESUMED_${runId}`,
    projectName,
    captionText: `Agent caption ${runId.slice(-6)}`,
    manualCaptionText: `Manual caption ${runId.slice(-6)}`,
    blockedCaptionText: `Blocked caption ${runId.slice(-6)}`,
    finalResponseText: "E2E Social Agent project edit completed.",
    blockedResponseText: "The project stayed unchanged while you had control.",
    resumeResponseText: "The agent resumed editing after control was returned.",
  };
  return {
    ...scenario,
    projectEdits: [
      {
        marker: scenario.marker,
        projectName,
        captionText: scenario.captionText,
        finalResponseText: scenario.finalResponseText,
      },
      {
        marker: scenario.blockedMarker,
        projectName,
        captionText: scenario.blockedCaptionText,
        finalResponseText: scenario.blockedResponseText,
        expectedCommandError: "The user currently controls this project.",
      },
      {
        marker: scenario.resumeMarker,
        projectName,
        captionText: scenario.captionText,
        finalResponseText: scenario.resumeResponseText,
      },
    ],
  };
}

export async function startLocalOpenAiMock(options = {}) {
  const projectEdits = options.projectEdits ?? (options.projectEdit ? [options.projectEdit] : []);
  const requests = [];
  const projectEditToolCalls = [];
  let requestId = 0;
  const server = createServer((request, response) => {
    if (
      request.method !== "POST" ||
      !new URL(request.url ?? "/", "http://127.0.0.1").pathname.endsWith("/chat/completions")
    ) {
      response.writeHead(404).end();
      return;
    }

    let rawBody = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      rawBody += chunk;
    });
    request.on("end", () => {
      let body;
      try {
        body = JSON.parse(rawBody);
      } catch {
        response.writeHead(400).end();
        return;
      }
      // O harness guarda somente o corpo necessário às asserções; cabeçalhos como Authorization nunca são capturados.
      requests.push(body);
      let answer = { content: "E2E scheduled draft ready." };
      try {
        const markedUserMessage = [...(body.messages ?? [])]
          .reverse()
          .find(
            (message) =>
              message.role === "user" &&
              projectEdits.some((candidate) => JSON.stringify(message).includes(candidate.marker)),
          );
        const serializedMarkedMessage = markedUserMessage ? JSON.stringify(markedUserMessage) : "";
        const projectEdit = projectEdits.find((candidate) =>
          serializedMarkedMessage.includes(candidate.marker),
        );
        if (projectEdit) {
          answer = planProjectEditResponse(body, projectEdit, projectEditToolCalls);
        }
      } catch (error) {
        response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        response.end(
          JSON.stringify({
            error: { message: error instanceof Error ? error.message : String(error) },
          }),
        );
        return;
      }

      const created = Math.floor(Date.now() / 1_000);
      const currentRequestId = ++requestId;
      const completionId = `chatcmpl-social-harness-e2e-${currentRequestId}`;
      const finishReason = answer.toolCalls ? "tool_calls" : "stop";
      const completion = {
        id: completionId,
        object: "chat.completion",
        created,
        model: body.model ?? "mock-chat",
        choices: [
          {
            index: 0,
            message: answer.toolCalls
              ? { role: "assistant", content: null, tool_calls: answer.toolCalls }
              : { role: "assistant", content: answer.content },
            finish_reason: finishReason,
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 5, total_tokens: 6 },
      };

      if (body.stream === true) {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "close",
        });
        const writeChunk = (choices) =>
          response.write(
            `data: ${JSON.stringify({
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model: completion.model,
              choices,
            })}\n\n`,
          );
        writeChunk([{ index: 0, delta: { role: "assistant" }, finish_reason: null }]);
        if (answer.toolCalls) {
          writeChunk([
            {
              index: 0,
              delta: {
                tool_calls: answer.toolCalls.map((toolCall, index) => ({
                  index,
                  ...toolCall,
                })),
              },
              finish_reason: null,
            },
          ]);
        } else {
          writeChunk([{ index: 0, delta: { content: answer.content }, finish_reason: null }]);
        }
        writeChunk([{ index: 0, delta: {}, finish_reason: finishReason }]);
        response.end("data: [DONE]\n\n");
        return;
      }

      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(completion));
    });
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    projectEditToolCalls,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}

export async function configureLocalMockProvider(settingsDir, baseUrl) {
  const providerId = "social-harness-e2e-local";
  const modelId = "mock-chat";
  const modelConfig = ModelConfig.fromData({
    enabled: true,
    properties: {
      requiresMfjsToolSchema: false,
      contextWindow: 32_768,
      inputFormat: {
        supportsText: true,
        supportsImage: false,
        supportsVideo: false,
        supportsAudio: false,
        supportsPdf: false,
      },
      outputFormat: { supportsText: true },
      supportsToolCall: true,
      supportsJsonSchemaOutput: false,
      supportsNativeWebSearch: false,
      supportsMidConversationSystem: true,
    },
    optionSpecs: {
      reasoningLevel: { values: ["low"], map: '{"reasoning_effort": reasoningLevel}' },
      maxOutputTokens: { max: 4_096, map: '{"max_tokens": maxOutputTokens}' },
    },
  });
  const localProvider = new NodePersonalProviderConfigRepository({
    filePath: join(settingsDir, "provider_config.json"),
    pollingIntervalMs: false,
  });
  try {
    await localProvider.update((current) => ({
      providers: current.providers.setRule({
        providerId,
        providerName: "Local E2E model",
        enabled: true,
        config: new ProviderConfig({
          group: "standard-personal",
          access: new ApiKeyAccessConfig({ apiKey: "social-harness-e2e-only" }),
          api: new ProviderApiConfig({ type: "openai-chat-completions", baseUrl }),
          personalModelIds: [modelId],
          modelOrder: [modelId],
        }),
      }),
      models: current.models.setExact(providerId, modelId, modelConfig),
      providerOrder: [
        ...(current.providerOrder ?? []).filter((id) => id !== providerId),
        providerId,
      ],
      defaultModelSelection: {
        providerId,
        modelId,
        options: { reasoningLevel: "low" },
      },
    }));
  } finally {
    localProvider.dispose();
  }
}
