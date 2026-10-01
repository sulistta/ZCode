import type {
  SocialProject,
  SocialProjectClip,
  SocialProjectCommandRequest,
  SocialProjectKeyframe,
  SocialProjectTrack,
} from "@social-harness/shared";
import { socialProjectSchema } from "@social-harness/shared";
import { SocialProjectInvalidOperationError } from "./errors.js";

type Operation = SocialProjectCommandRequest["operation"];

function fail(message: string): never {
  throw new SocialProjectInvalidOperationError(message);
}

function trackForClip(clip: SocialProjectClip): SocialProjectTrack["type"] {
  if (clip.kind === "audio") return "audio";
  if (clip.kind === "text") return "text";
  return "video";
}

function findTrackIndex(tracks: SocialProjectTrack[], trackId: string): number {
  const index = tracks.findIndex((track) => track.trackId === trackId);
  if (index < 0) fail(`Track does not exist: ${trackId}`);
  return index;
}

function findClipMaybe(tracks: SocialProjectTrack[], clipId: string) {
  for (const [trackIndex, track] of tracks.entries()) {
    const clipIndex = track.clips.findIndex((clip) => clip.clipId === clipId);
    if (clipIndex >= 0) return { trackIndex, clipIndex, track, clip: track.clips[clipIndex]! };
  }
  return null;
}

function findClip(tracks: SocialProjectTrack[], clipId: string) {
  const found = findClipMaybe(tracks, clipId);
  if (found) return found;
  fail(`Clip does not exist: ${clipId}`);
}

function sortClips(clips: SocialProjectClip[]): SocialProjectClip[] {
  return [...clips].sort(
    (left, right) =>
      left.timelineStartMs - right.timelineStartMs || left.clipId.localeCompare(right.clipId),
  );
}

function moveAt<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) fail(`Position is outside the collection: ${to}`);
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

function clipEndMs(clip: SocialProjectClip): number {
  if (clip.kind === "text") return clip.timelineStartMs + clip.durationMs;
  return clip.timelineStartMs + (clip.sourceEndMs - clip.sourceStartMs) / clip.playbackRate;
}

function validateClipTiming(clip: SocialProjectClip): void {
  if (clip.kind !== "text" && clip.sourceEndMs <= clip.sourceStartMs) {
    fail("Clip source end must be after its source start");
  }
  const durationMs = clipEndMs(clip) - clip.timelineStartMs;
  if (clip.keyframes.some((keyframe) => keyframe.timeMs > durationMs)) {
    fail("A keyframe cannot be outside its clip");
  }
  if (
    [clip.transitionIn, clip.transitionOut].some(
      (transition) => transition && transition.durationMs > durationMs,
    )
  ) {
    fail("A transition cannot be longer than its clip");
  }
}

function splitKeyframes(
  keyframes: SocialProjectKeyframe[],
  localSplitMs: number,
): [SocialProjectKeyframe[], SocialProjectKeyframe[]] {
  const left: SocialProjectKeyframe[] = [];
  const right: SocialProjectKeyframe[] = [];
  for (const keyframe of keyframes) {
    if (keyframe.timeMs <= localSplitMs) left.push(keyframe);
    if (keyframe.timeMs >= localSplitMs) {
      right.push({ ...keyframe, timeMs: keyframe.timeMs - localSplitMs });
    }
  }
  return [left, right];
}

function applySplit(
  project: SocialProject,
  operation: Extract<Operation, { type: "split-clip" }>,
): SocialProject {
  const found = findClip(project.tracks, operation.clipId);
  if (
    project.tracks.some((track) => track.clips.some((clip) => clip.clipId === operation.newClipId))
  ) {
    fail(`Clip already exists: ${operation.newClipId}`);
  }
  const { clip } = found;
  const endMs = clipEndMs(clip);
  if (operation.splitAtMs <= clip.timelineStartMs || operation.splitAtMs >= endMs) {
    fail("Split point must be inside the clip");
  }
  const localSplitMs = operation.splitAtMs - clip.timelineStartMs;
  const [leftKeyframes, rightKeyframes] = splitKeyframes(clip.keyframes, localSplitMs);
  let left: SocialProjectClip;
  let right: SocialProjectClip;
  if (clip.kind === "text") {
    left = {
      ...clip,
      durationMs: localSplitMs,
      keyframes: leftKeyframes,
      transitionOut: undefined,
    };
    right = {
      ...clip,
      clipId: operation.newClipId,
      timelineStartMs: operation.splitAtMs,
      durationMs: endMs - operation.splitAtMs,
      keyframes: rightKeyframes,
      transitionIn: undefined,
    };
  } else {
    const sourceSplitMs = Math.round(clip.sourceStartMs + localSplitMs * clip.playbackRate);
    if (sourceSplitMs <= clip.sourceStartMs || sourceSplitMs >= clip.sourceEndMs) {
      fail("Clip is too short to split at the requested frame");
    }
    left = {
      ...clip,
      sourceEndMs: sourceSplitMs,
      keyframes: leftKeyframes,
      transitionOut: undefined,
    };
    right = {
      ...clip,
      clipId: operation.newClipId,
      timelineStartMs: operation.splitAtMs,
      sourceStartMs: sourceSplitMs,
      keyframes: rightKeyframes,
      transitionIn: undefined,
    };
  }
  const track = project.tracks[found.trackIndex]!;
  const clips = [...track.clips];
  clips.splice(found.clipIndex, 1, left, right);
  const tracks = [...project.tracks];
  tracks[found.trackIndex] = { ...track, clips: sortClips(clips) };
  return { ...project, tracks };
}

export function applySocialProjectOperation(
  project: SocialProject,
  operation: Operation,
): SocialProject {
  let next = project;
  switch (operation.type) {
    case "rename-project":
      next = { ...project, displayName: operation.displayName };
      break;
    case "add-track": {
      if (project.tracks.some((track) => track.trackId === operation.trackId)) {
        fail(`Track already exists: ${operation.trackId}`);
      }
      if (operation.position > project.tracks.length) fail("Track position is outside the project");
      const track: SocialProjectTrack = {
        trackId: operation.trackId,
        name: operation.name,
        type: operation.trackType,
        muted: false,
        hidden: false,
        clips: [],
      };
      const tracks = [...project.tracks];
      tracks.splice(operation.position, 0, track);
      next = { ...project, tracks };
      break;
    }
    case "remove-track": {
      const index = findTrackIndex(project.tracks, operation.trackId);
      next = { ...project, tracks: project.tracks.filter((_, trackIndex) => trackIndex !== index) };
      break;
    }
    case "move-track": {
      const index = findTrackIndex(project.tracks, operation.trackId);
      next = { ...project, tracks: moveAt(project.tracks, index, operation.position) };
      break;
    }
    case "put-clip": {
      validateClipTiming(operation.clip);
      const trackIndex = findTrackIndex(project.tracks, operation.trackId);
      const track = project.tracks[trackIndex]!;
      if (track.type !== trackForClip(operation.clip)) {
        fail(`Clip kind ${operation.clip.kind} is incompatible with ${track.type} track`);
      }
      const existing = findClipMaybe(project.tracks, operation.clip.clipId);
      if (existing && existing.trackIndex !== trackIndex) {
        fail("Use move-clip to move an existing clip to another track");
      }
      const clips = existing
        ? track.clips.map((clip) => (clip.clipId === operation.clip.clipId ? operation.clip : clip))
        : [...track.clips, operation.clip];
      const tracks = [...project.tracks];
      tracks[trackIndex] = { ...track, clips: sortClips(clips) };
      next = { ...project, tracks };
      break;
    }
    case "remove-clip": {
      const found = findClip(project.tracks, operation.clipId);
      const tracks = [...project.tracks];
      tracks[found.trackIndex] = {
        ...found.track,
        clips: found.track.clips.filter((clip) => clip.clipId !== operation.clipId),
      };
      next = { ...project, tracks };
      break;
    }
    case "move-clip": {
      const found = findClip(project.tracks, operation.clipId);
      const targetIndex = findTrackIndex(project.tracks, operation.targetTrackId);
      const target = project.tracks[targetIndex]!;
      if (target.type !== trackForClip(found.clip)) {
        fail(`Clip kind ${found.clip.kind} is incompatible with ${target.type} track`);
      }
      const moved = { ...found.clip, timelineStartMs: operation.timelineStartMs };
      const tracks = [...project.tracks];
      if (found.trackIndex === targetIndex) {
        tracks[targetIndex] = {
          ...target,
          clips: sortClips(
            target.clips.map((clip) => (clip.clipId === moved.clipId ? moved : clip)),
          ),
        };
      } else {
        tracks[found.trackIndex] = {
          ...found.track,
          clips: found.track.clips.filter((clip) => clip.clipId !== moved.clipId),
        };
        tracks[targetIndex] = { ...target, clips: sortClips([...target.clips, moved]) };
      }
      next = { ...project, tracks };
      break;
    }
    case "split-clip":
      next = applySplit(project, operation);
      break;
    case "update-settings":
      next = { ...project, settings: operation.settings };
      break;
    case "take-control":
      next = { ...project, editControlOwner: "user" };
      break;
    case "return-to-agent":
      next = { ...project, editControlOwner: "agent" };
      break;
    case "undo":
    case "redo":
      fail(`${operation.type} must be handled by the revision-history owner`);
  }
  return socialProjectSchema.parse(next);
}

export function projectOperationChangesContent(operation: Operation): boolean {
  return !["undo", "redo", "take-control", "return-to-agent"].includes(operation.type);
}

export function projectOperationRequiresUser(operation: Operation): boolean {
  return operation.type === "take-control" || operation.type === "return-to-agent";
}
