import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

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

export function planClipCandidateHandoffResponse(body, handoff, handoffToolCalls, handoffResults) {
  const messages = body.messages ?? [];
  const requestStart = messages.findLastIndex(
    (message) => message.role === "user" && JSON.stringify(message).includes(handoff.marker),
  );
  assert.notEqual(requestStart, -1, `Expected current user message to include ${handoff.marker}`);
  const results = collectToolResults(messages.slice(requestStart));
  const hasResult = (name) => results.some((result) => result.name === name);
  const getResult = (name) => results.findLast((result) => result.name === name)?.content;
  const callTool = (name, args) => {
    const tool = body.tools?.find((candidate) => candidate.function?.name === name);
    assert.ok(tool, `The account conversation must offer ${name} to the model`);
    handoffToolCalls.push({ marker: handoff.marker, name, arguments: args });
    return {
      id: `call_social_harness_e2e_${handoffToolCalls.length}`,
      type: "function",
      function: { name, arguments: JSON.stringify(args) },
    };
  };

  if (!hasResult("SocialAgentGetContext")) {
    return { toolCalls: [callTool("SocialAgentGetContext", {})] };
  }
  if (!hasResult("SocialMediaList")) {
    return { toolCalls: [callTool("SocialMediaList", {})] };
  }

  const media = getResult("SocialMediaList")?.assets?.find(
    (asset) => asset.originalName === handoff.mediaName,
  );
  assert.ok(media?.mediaId, `Expected account media ${handoff.mediaName}`);
  if (!hasResult("SocialClipCandidates")) {
    return {
      toolCalls: [callTool("SocialClipCandidates", { mediaId: media.mediaId, mode: handoff.mode })],
    };
  }

  const candidateResult = getResult("SocialClipCandidates")?.result;
  assert.equal(candidateResult?.mediaId, media.mediaId);
  assert.equal(candidateResult?.mode, handoff.mode);
  const candidate = candidateResult?.candidates?.find((item) => {
    if (handoff.mode === "podcast") {
      return item.evidence.some(
        (evidence) => evidence.kind === "speech" && evidence.completePhrase,
      );
    }
    return (
      item.evidence.some((evidence) => evidence.kind === "audio") &&
      !item.evidence.some((evidence) => evidence.kind === "speech")
    );
  });
  assert.ok(
    candidate,
    `Expected measured ${handoff.mode} candidate evidence for ${handoff.mediaName}`,
  );
  assert.ok(candidate.startSeconds >= 0 && candidate.endSeconds > candidate.startSeconds);
  assert.ok(candidate.endSeconds - candidate.startSeconds >= 15);
  assert.ok(candidate.endSeconds - candidate.startSeconds <= 60);

  if (!hasResult("SocialProjectList")) {
    return { toolCalls: [callTool("SocialProjectList", {})] };
  }
  const targetProject = getResult("SocialProjectList")?.projects?.find(
    (project) => project.displayName === handoff.projectName,
  );
  assert.ok(
    targetProject?.projectId,
    `Expected project ${handoff.projectName} in the account list`,
  );
  if (!hasResult("SocialProjectRead")) {
    return { toolCalls: [callTool("SocialProjectRead", { projectId: targetProject.projectId })] };
  }

  const project = getResult("SocialProjectRead")?.project?.project;
  assert.equal(
    project?.projectId,
    targetProject.projectId,
    "The model must read the listed project",
  );
  const videoTrack = project.tracks.find((track) => track.type === "video");
  assert.ok(videoTrack, `Expected a video track in ${handoff.projectName}`);
  const sourceStartMs = Math.round(candidate.startSeconds * 1_000);
  const sourceEndMs = Math.round(candidate.endSeconds * 1_000);
  if (!hasResult("SocialProjectCommand")) {
    return {
      toolCalls: [
        callTool("SocialProjectCommand", {
          projectId: project.projectId,
          expectedRevision: project.revision,
          operation: {
            type: "put-clip",
            trackId: videoTrack.trackId,
            clip: {
              clipId: randomUUID(),
              kind: "video",
              mediaId: media.mediaId,
              timelineStartMs: 0,
              sourceStartMs,
              sourceEndMs,
              playbackRate: 1,
              volume: 1,
              keyframes: [],
            },
          },
        }),
      ],
    };
  }

  const commandResult = getResult("SocialProjectCommand")?.result;
  const updatedProject = commandResult?.project;
  assert.equal(updatedProject?.revision, project.revision + 1);
  const acceptedClip = updatedProject.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.mediaId === media.mediaId);
  assert.equal(acceptedClip?.sourceStartMs, sourceStartMs);
  assert.equal(acceptedClip?.sourceEndMs, sourceEndMs);
  handoffResults.push({
    marker: handoff.marker,
    mediaId: media.mediaId,
    candidate,
    sourceStartMs,
    sourceEndMs,
    projectId: project.projectId,
    revision: updatedProject.revision,
  });
  return { content: handoff.finalResponseText };
}

export function createSocialProjectCandidateHandoffScenarios(runId) {
  return [
    {
      marker: `SOCIAL_HARNESS_CANDIDATE_HANDOFF_PODCAST_${runId}`,
      projectName: `Podcast candidate ${runId}`,
      mediaName: "Podcast transcript candidate fixture.mp4",
      mode: "podcast",
      finalResponseText: "E2E podcast candidate was placed at its measured source timestamps.",
    },
    {
      marker: `SOCIAL_HARNESS_CANDIDATE_HANDOFF_MUSIC_${runId}`,
      projectName: `Music candidate ${runId}`,
      mediaName: "Synthetic music candidate fixture.mp4",
      mode: "music",
      finalResponseText: "E2E music candidate was placed at its measured source timestamps.",
    },
  ];
}
