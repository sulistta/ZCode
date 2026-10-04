import {
  computeSocialProjectClipResize,
  getTimelineSnapThresholdMs,
  resolveTimelineMoveSnap,
} from "@social-harness/opencut-core";
import type { SnapResult } from "@social-harness/opencut-core";
import type { SocialProjectClip, SocialProjectTrack } from "@social-harness/shared";
import type { SocialProject } from "@social-harness/shared";
import { getSocialProjectClipDurationMs } from "./socialProjectPlayback.js";

export function getSocialProjectDragStartMs(input: {
  initialStartMs: number;
  deltaX: number;
  pixelsPerSecond: number;
}): number {
  if (!Number.isFinite(input.pixelsPerSecond) || input.pixelsPerSecond <= 0) {
    return input.initialStartMs;
  }
  const unsnappedMs = Math.max(
    0,
    input.initialStartMs + (input.deltaX / input.pixelsPerSecond) * 1000,
  );
  return Math.round(unsnappedMs);
}

export function getSocialProjectClipTrimPreview(input: {
  clip: SocialProjectClip;
  edge: "start" | "end";
  deltaTimelineMs: number;
  frameRate: { numerator: number; denominator: number };
  maximumSourceEndMs?: number;
}): SocialProjectClip {
  return computeSocialProjectClipResize({
    clip: input.clip,
    side: input.edge === "start" ? "left" : "right",
    deltaTimelineMs: input.deltaTimelineMs,
    frameRate: input.frameRate,
    ...(input.maximumSourceEndMs === undefined
      ? {}
      : { maximumSourceEndMs: input.maximumSourceEndMs }),
  }).clip;
}

export function canMoveSocialProjectClipToTrack(
  clip: SocialProjectClip,
  track: SocialProjectTrack,
): boolean {
  const expectedType = clip.kind === "audio" ? "audio" : clip.kind === "text" ? "text" : "video";
  return track.type === expectedType;
}

export function getSocialProjectClipMoveSnap(input: {
  project: SocialProject;
  movingClip: SocialProjectClip;
  targetStartMs: number;
  playheadMs: number;
  pixelsPerSecond: number;
}): SnapResult {
  const snapPoints = [
    { timeMs: input.playheadMs, type: "playhead" as const },
    ...input.project.tracks.flatMap((track) =>
      track.clips.flatMap((clip) => [
        {
          timeMs: clip.timelineStartMs,
          type: "clip-start" as const,
          clipId: clip.clipId,
          trackId: track.trackId,
        },
        {
          timeMs: clip.timelineStartMs + getSocialProjectClipDurationMs(clip),
          type: "clip-end" as const,
          clipId: clip.clipId,
          trackId: track.trackId,
        },
        ...clip.keyframes.map((keyframe) => ({
          timeMs: clip.timelineStartMs + keyframe.timeMs,
          type: "keyframe" as const,
          clipId: clip.clipId,
          trackId: track.trackId,
        })),
      ]),
    ),
  ];
  return resolveTimelineMoveSnap({
    targetStartMs: input.targetStartMs,
    clipDurationMs: getSocialProjectClipDurationMs(input.movingClip),
    movingClipId: input.movingClip.clipId,
    snapPoints,
    maxSnapDistanceMs: getTimelineSnapThresholdMs({
      pixelsPerSecond: input.pixelsPerSecond,
    }),
  });
}
