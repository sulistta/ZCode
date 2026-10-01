import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { SocialMediaAsset } from "@social-harness/services";
import type { SocialProject, SocialProjectClip } from "@social-harness/shared";
import {
  canMoveSocialProjectClipToTrack,
  getSocialProjectClipMoveSnap,
  getSocialProjectClipTrimPreview,
  getSocialProjectDragStartMs,
} from "./socialProjectTimelineDrag.js";

interface TimelineDrag {
  mode: "move" | "trim-start" | "trim-end";
  clipId: string;
  sourceTrackId: string;
  targetTrackId: string;
  sourceTrackPosition: number;
  targetTrackPosition: number;
  pointerStartX: number;
  initialStartMs: number;
  timelineStartMs: number;
  initialRevision: number;
  initialProject: SocialProject;
  initialClip: SocialProjectClip;
  previewClip: SocialProjectClip;
  frameRate: SocialProject["settings"]["frameRate"];
  maximumSourceEndMs?: number;
  snapPoint: ReturnType<typeof getSocialProjectClipMoveSnap>["snapPoint"];
  moved: boolean;
}

function clipTrimStateChanged(before: SocialProjectClip, after: SocialProjectClip): boolean {
  if (before.kind === "text" || after.kind === "text") {
    return (
      before.kind !== after.kind ||
      before.timelineStartMs !== after.timelineStartMs ||
      (before.kind === "text" && after.kind === "text" && before.durationMs !== after.durationMs)
    );
  }
  return (
    before.timelineStartMs !== after.timelineStartMs ||
    before.sourceStartMs !== after.sourceStartMs ||
    before.sourceEndMs !== after.sourceEndMs
  );
}

function maximumSourceEndMs(
  clip: SocialProjectClip,
  assets: SocialMediaAsset[],
): number | undefined {
  if (clip.kind === "text" || clip.kind === "image") return undefined;
  const sourceDurationSeconds = assets.find(
    (asset) => asset.mediaId === clip.mediaId,
  )?.sourceDurationSeconds;
  if (sourceDurationSeconds == null) return clip.sourceEndMs;
  return Math.max(clip.sourceEndMs, Math.round(sourceDurationSeconds * 1000));
}

export function useSocialProjectTimelineGestures({
  project,
  assets,
  playheadMs,
  pixelsPerSecond,
  canEdit,
  onSeek,
  onMoveClip,
  onTrimClip,
}: {
  project: SocialProject;
  assets: SocialMediaAsset[];
  playheadMs: number;
  pixelsPerSecond: number;
  canEdit: boolean;
  onSeek: (playheadMs: number) => void;
  onMoveClip: (
    clipId: string,
    targetTrackId: string,
    timelineStartMs: number,
    expectedRevision: number,
  ) => Promise<void>;
  onTrimClip: (trackId: string, clip: SocialProjectClip, expectedRevision: number) => Promise<void>;
}) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<TimelineDrag | null>(null);
  const [drag, setDrag] = useState<TimelineDrag | null>(null);
  const frameRate = project.settings.frameRate;

  const getTrackPositionAt = (clientY: number): number | null => {
    const rows = timelineRef.current?.querySelectorAll<HTMLElement>("[data-social-track-id]");
    if (!rows) return null;
    const rowIndex = [...rows].findIndex((row) => {
      const bounds = row.getBoundingClientRect();
      return clientY >= bounds.top && clientY <= bounds.bottom;
    });
    return rowIndex >= 0 && rowIndex < project.tracks.length ? rowIndex : null;
  };

  const beginGesture = (
    event: PointerEvent<HTMLButtonElement>,
    mode: TimelineDrag["mode"],
    trackId: string,
    trackPosition: number,
    clip: SocialProjectClip,
  ) => {
    if (!canEdit) return;
    event.preventDefault();
    event.stopPropagation();
    const maxSourceEndMs = maximumSourceEndMs(clip, assets);
    const nextDrag: TimelineDrag = {
      mode,
      clipId: clip.clipId,
      sourceTrackId: trackId,
      targetTrackId: trackId,
      sourceTrackPosition: trackPosition,
      targetTrackPosition: trackPosition,
      pointerStartX: event.clientX,
      initialStartMs: clip.timelineStartMs,
      timelineStartMs: clip.timelineStartMs,
      initialRevision: project.revision,
      initialProject: project,
      initialClip: clip,
      previewClip: clip,
      frameRate,
      ...(maxSourceEndMs === undefined ? {} : { maximumSourceEndMs: maxSourceEndMs }),
      snapPoint: null,
      moved: false,
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const updateGesture = (event: PointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current) return;
    const deltaX = event.clientX - current.pointerStartX;
    if (current.mode !== "move") {
      const previewClip = getSocialProjectClipTrimPreview({
        clip: current.initialClip,
        edge: current.mode === "trim-start" ? "start" : "end",
        deltaTimelineMs: (deltaX / pixelsPerSecond) * 1000,
        frameRate: current.frameRate,
        maximumSourceEndMs: current.maximumSourceEndMs,
      });
      const nextDrag: TimelineDrag = {
        ...current,
        previewClip,
        timelineStartMs: previewClip.timelineStartMs,
        moved: current.moved || clipTrimStateChanged(current.initialClip, previewClip),
      };
      dragRef.current = nextDrag;
      setDrag(nextDrag);
      return;
    }

    const sourceClip = current.initialClip;
    const rowPosition = getTrackPositionAt(event.clientY);
    const targetTrack = rowPosition == null ? null : current.initialProject.tracks[rowPosition];
    const compatibleTarget =
      targetTrack && canMoveSocialProjectClipToTrack(sourceClip, targetTrack)
        ? { track: targetTrack, position: rowPosition! }
        : null;
    const targetTrackId = compatibleTarget?.track.trackId ?? current.sourceTrackId;
    const unsnappedStartMs = getSocialProjectDragStartMs({
      initialStartMs: current.initialStartMs,
      deltaX,
      pixelsPerSecond,
    });
    const snap = getSocialProjectClipMoveSnap({
      project: current.initialProject,
      movingClip: sourceClip,
      targetStartMs: unsnappedStartMs,
      playheadMs,
      pixelsPerSecond,
    });
    const nextDrag: TimelineDrag = {
      ...current,
      targetTrackId,
      targetTrackPosition: compatibleTarget?.position ?? current.sourceTrackPosition,
      timelineStartMs: snap.snappedTimeMs,
      previewClip: { ...sourceClip, timelineStartMs: snap.snappedTimeMs },
      snapPoint: snap.snapPoint,
      moved: current.moved || Math.abs(deltaX) >= 4 || targetTrackId !== current.sourceTrackId,
    };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  };

  const finishGesture = (event: PointerEvent<HTMLDivElement>) => {
    updateGesture(event);
    const completed = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!completed) return;
    if (completed.mode === "move") {
      if (!completed.moved) {
        onSeek(completed.initialStartMs);
        return;
      }
      if (
        completed.timelineStartMs !== completed.initialStartMs ||
        completed.targetTrackId !== completed.sourceTrackId
      ) {
        void onMoveClip(
          completed.clipId,
          completed.targetTrackId,
          completed.timelineStartMs,
          completed.initialRevision,
        );
      }
      return;
    }
    if (clipTrimStateChanged(completed.initialClip, completed.previewClip)) {
      void onTrimClip(completed.sourceTrackId, completed.previewClip, completed.initialRevision);
    }
  };

  const cancelGesture = () => {
    dragRef.current = null;
    setDrag(null);
  };

  const handleTrimKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    trackId: string,
    clip: SocialProjectClip,
    edge: "start" | "end",
  ) => {
    if (!canEdit || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    event.stopPropagation();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    const previewClip = getSocialProjectClipTrimPreview({
      clip,
      edge,
      deltaTimelineMs: direction * ((1000 * frameRate.denominator) / frameRate.numerator),
      frameRate,
      maximumSourceEndMs: maximumSourceEndMs(clip, assets),
    });
    if (clipTrimStateChanged(clip, previewClip)) {
      void onTrimClip(trackId, previewClip, project.revision);
    }
  };

  const handleClipKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    trackPosition: number,
    clip: SocialProjectClip,
  ) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSeek(clip.timelineStartMs);
      return;
    }
    if (!canEdit || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const timeDelta = event.key === "ArrowLeft" ? -1000 : event.key === "ArrowRight" ? 1000 : 0;
    const trackDelta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
    const targetPosition = Math.max(
      0,
      Math.min(project.tracks.length - 1, trackPosition + trackDelta),
    );
    const targetTrack = project.tracks[targetPosition];
    const sourceTrack = project.tracks[trackPosition];
    if (!targetTrack || !sourceTrack || !canMoveSocialProjectClipToTrack(clip, targetTrack)) {
      return;
    }
    void onMoveClip(
      clip.clipId,
      targetTrack.trackId,
      Math.max(0, clip.timelineStartMs + timeDelta),
      project.revision,
    );
  };

  return {
    drag,
    timelineRef,
    beginGesture,
    updateGesture,
    finishGesture,
    cancelGesture,
    handleClipKeyDown,
    handleTrimKeyDown,
  };
}
