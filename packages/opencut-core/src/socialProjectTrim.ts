// Single-clip Social Project adaptation of OpenCut Classic's frame-clamped
// group-resize calculation at cf5e79e919144200294fb9fed22a222592a0aeea.
// The pinned source is retained under ../upstream/opencut-classic.
import type { SocialProjectClip } from "@social-harness/shared";
import type { TimelineFrameRate } from "./timelineRuler.js";
import { getSocialProjectClipDurationMs } from "./socialProjectScene.js";

export type SocialProjectResizeSide = "left" | "right";

export interface SocialProjectClipResizeResult {
  clip: SocialProjectClip;
  deltaTimelineMs: number;
}

function getFrameDurationMs(frameRate: TimelineFrameRate): number {
  if (
    !Number.isFinite(frameRate.numerator) ||
    !Number.isFinite(frameRate.denominator) ||
    frameRate.numerator <= 0 ||
    frameRate.denominator <= 0
  ) {
    return 1000 / 30;
  }
  return (1000 * frameRate.denominator) / frameRate.numerator;
}

function snapDeltaToFrame(deltaMs: number, frameDurationMs: number): number {
  return Math.round(deltaMs / frameDurationMs) * frameDurationMs;
}

function clamp(value: number, minimum: number, maximum: number | null): number {
  return Math.max(minimum, maximum === null ? value : Math.min(maximum, value));
}

function clampResizeDelta({
  deltaMs,
  minimumDeltaMs,
  maximumDeltaMs,
  frameDurationMs,
}: {
  deltaMs: number;
  minimumDeltaMs: number;
  maximumDeltaMs: number | null;
  frameDurationMs: number;
}): number {
  const boundedDeltaMs = clamp(deltaMs, minimumDeltaMs, maximumDeltaMs);
  // 与 OpenCut 的 resize 核心一致：整次拖动只吸附一次，再尊重素材边界复核。
  return clamp(snapDeltaToFrame(boundedDeltaMs, frameDurationMs), minimumDeltaMs, maximumDeltaMs);
}

function resizeTextClip({
  clip,
  side,
  deltaMs,
  minimumDeltaMs,
  maximumDeltaMs,
}: {
  clip: Extract<SocialProjectClip, { kind: "text" }>;
  side: SocialProjectResizeSide;
  deltaMs: number;
  minimumDeltaMs: number;
  maximumDeltaMs: number | null;
}): SocialProjectClipResizeResult {
  const appliedDeltaMs = clamp(deltaMs, minimumDeltaMs, maximumDeltaMs);
  if (appliedDeltaMs === 0) return { clip, deltaTimelineMs: 0 };
  if (side === "left") {
    const timelineStartMs = Math.max(0, Math.round(clip.timelineStartMs + appliedDeltaMs));
    const actualDeltaMs = timelineStartMs - clip.timelineStartMs;
    return {
      clip: {
        ...clip,
        timelineStartMs,
        durationMs: clip.durationMs - actualDeltaMs,
      },
      deltaTimelineMs: actualDeltaMs,
    };
  }
  const durationMs = Math.round(clip.durationMs + appliedDeltaMs);
  return {
    clip: { ...clip, durationMs },
    deltaTimelineMs: durationMs - clip.durationMs,
  };
}

export function computeSocialProjectClipResize(input: {
  clip: SocialProjectClip;
  side: SocialProjectResizeSide;
  deltaTimelineMs: number;
  frameRate: TimelineFrameRate;
  maximumSourceEndMs?: number;
}): SocialProjectClipResizeResult {
  const { clip, side } = input;
  if (!Number.isFinite(input.deltaTimelineMs)) return { clip, deltaTimelineMs: 0 };

  const frameDurationMs = getFrameDurationMs(input.frameRate);
  const durationMs = getSocialProjectClipDurationMs(clip);
  const minimumTextDurationMs = Math.max(100, Math.ceil(frameDurationMs));
  if (clip.kind === "text") {
    const minimumDeltaMs =
      side === "left"
        ? Math.max(-clip.timelineStartMs, clip.durationMs - 600_000)
        : minimumTextDurationMs - clip.durationMs;
    const maximumDeltaMs =
      side === "left" ? clip.durationMs - minimumTextDurationMs : 600_000 - clip.durationMs;
    const snappedDeltaMs = snapDeltaToFrame(input.deltaTimelineMs, frameDurationMs);
    return resizeTextClip({
      clip,
      side,
      deltaMs: snappedDeltaMs,
      minimumDeltaMs,
      maximumDeltaMs,
    });
  }

  const sourceSpanMs = clip.sourceEndMs - clip.sourceStartMs;
  const minimumSourceSpanMs = Math.ceil(frameDurationMs * clip.playbackRate);
  if (sourceSpanMs <= minimumSourceSpanMs) return { clip, deltaTimelineMs: 0 };
  const knownSourceEndMs =
    typeof input.maximumSourceEndMs === "number" && Number.isFinite(input.maximumSourceEndMs)
      ? Math.max(clip.sourceEndMs, input.maximumSourceEndMs)
      : undefined;

  const minimumDeltaMs =
    side === "left"
      ? Math.max(-clip.timelineStartMs, -clip.sourceStartMs / clip.playbackRate)
      : minimumSourceSpanMs / clip.playbackRate - durationMs;
  const maximumDeltaMs =
    side === "left"
      ? durationMs - minimumSourceSpanMs / clip.playbackRate
      : knownSourceEndMs === undefined
        ? null
        : (knownSourceEndMs - clip.sourceEndMs) / clip.playbackRate;
  const deltaTimelineMs = clampResizeDelta({
    deltaMs: input.deltaTimelineMs,
    minimumDeltaMs,
    maximumDeltaMs,
    frameDurationMs,
  });
  const sourceDeltaMs = Math.round(deltaTimelineMs * clip.playbackRate);
  if (sourceDeltaMs === 0) return { clip, deltaTimelineMs: 0 };

  if (side === "left") {
    const sourceStartMs = Math.max(
      0,
      Math.min(clip.sourceEndMs - minimumSourceSpanMs, clip.sourceStartMs + sourceDeltaMs),
    );
    const actualSourceDeltaMs = sourceStartMs - clip.sourceStartMs;
    const appliedDeltaTimelineMs = actualSourceDeltaMs / clip.playbackRate;
    const timelineStartMs = Math.max(0, Math.round(clip.timelineStartMs + appliedDeltaTimelineMs));
    const actualTimelineMoveMs = timelineStartMs - clip.timelineStartMs;
    return {
      clip: { ...clip, sourceStartMs, timelineStartMs },
      deltaTimelineMs: actualTimelineMoveMs,
    };
  }

  const maximumSourceEndMs = knownSourceEndMs ?? Number.MAX_SAFE_INTEGER;
  const sourceEndMs = Math.max(
    clip.sourceStartMs + minimumSourceSpanMs,
    Math.min(maximumSourceEndMs, clip.sourceEndMs + sourceDeltaMs),
  );
  const nextClip = { ...clip, sourceEndMs };
  return {
    clip: nextClip,
    deltaTimelineMs: getSocialProjectClipDurationMs(nextClip) - durationMs,
  };
}
