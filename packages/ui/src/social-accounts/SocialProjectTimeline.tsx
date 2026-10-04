import { useLayoutEffect, useState } from "react";
import type { PointerEvent } from "react";
import {
  getRulerConfig,
  getTimelinePaddingPx,
  getTimelinePixelsPerSecond,
  getTimelineZoomMin,
  pixelsToTimelineTimeMs,
  sliderToZoom,
  timelineTimeMsToPixels,
  timelineTimeMsToSnappedPixels,
  zoomToSlider,
} from "@social-harness/opencut-core";
import type { SocialMediaAsset } from "@social-harness/services";
import type { SocialProject, SocialProjectClip } from "@social-harness/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { getSocialProjectClipDurationMs, getSocialProjectEndMs } from "./socialProjectPlayback.js";
import { SocialProjectRulerMarks } from "./SocialProjectRulerMarks.js";
import { useSocialProjectTimelineGestures } from "./useSocialProjectTimelineGestures.js";

const TIMELINE_ZOOM_MAX = 8;
const TIMELINE_TRACK_LABEL_WIDTH_PX = 88;

function clipLabel(clip: SocialProjectClip, assets: SocialMediaAsset[]): string {
  if (clip.kind === "text") return clip.text;
  return (
    assets.find((asset) => asset.mediaId === clip.mediaId)?.originalName ??
    `${clip.kind} ${clip.mediaId.slice(0, 8)}`
  );
}

export function SocialProjectTimeline({
  project,
  assets,
  playheadMs,
  canEdit,
  onSeek,
  onMoveClip,
  onTrimClip,
}: {
  project: SocialProject;
  assets: SocialMediaAsset[];
  playheadMs: number;
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
  const { intl } = useZCodeIntl();
  const endMs = getSocialProjectEndMs(project);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [viewport, setViewport] = useState({ scrollLeftPx: 0, widthPx: 0 });
  const durationSeconds = Math.ceil(endMs / 1000);
  const basePixelsPerSecond = Math.min(24, Math.max(0.5, 2400 / durationSeconds));
  const scrollableViewportWidthPx = Math.max(0, viewport.widthPx - TIMELINE_TRACK_LABEL_WIDTH_PX);
  const minZoom = getTimelineZoomMin({
    durationMs: durationSeconds * 1000,
    containerWidth: scrollableViewportWidthPx > 0 ? scrollableViewportWidthPx : undefined,
    basePixelsPerSecond,
    maxZoom: TIMELINE_ZOOM_MAX,
  });
  const effectiveZoomLevel = Math.max(zoomLevel, minZoom);
  const pixelsPerSecond = getTimelinePixelsPerSecond({
    zoomLevel: effectiveZoomLevel,
    basePixelsPerSecond,
  });
  const trailingPaddingPx = getTimelinePaddingPx({
    containerWidth: scrollableViewportWidthPx,
    zoomLevel: effectiveZoomLevel,
    minZoom,
    maxZoom: TIMELINE_ZOOM_MAX,
  });
  const devicePixelRatio = typeof window === "undefined" ? undefined : window.devicePixelRatio;
  const fps = project.settings.frameRate;
  const {
    drag,
    timelineRef,
    beginGesture,
    updateGesture,
    finishGesture,
    cancelGesture,
    handleClipKeyDown,
    handleTrimKeyDown,
  } = useSocialProjectTimelineGestures({
    project,
    assets,
    playheadMs,
    pixelsPerSecond,
    canEdit,
    onSeek,
    onMoveClip,
    onTrimClip,
  });
  const ruler = getRulerConfig({ zoomLevel: effectiveZoomLevel, fps, basePixelsPerSecond });

  useLayoutEffect(() => {
    if (zoomLevel < minZoom) setZoomLevel(minZoom);
  }, [minZoom, zoomLevel]);

  useLayoutEffect(() => {
    const element = timelineRef.current;
    if (!element) return;
    let frameId: number | null = null;
    const readViewport = () => {
      const next = { scrollLeftPx: element.scrollLeft, widthPx: element.clientWidth };
      setViewport((current) =>
        current.scrollLeftPx === next.scrollLeftPx && current.widthPx === next.widthPx
          ? current
          : next,
      );
    };
    const scheduleViewportRead = () => {
      if (frameId !== null) return;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        readViewport();
      });
    };
    readViewport();
    element.addEventListener("scroll", scheduleViewportRead, { passive: true });
    const resizeObserver = new ResizeObserver(scheduleViewportRead);
    resizeObserver.observe(element);
    return () => {
      element.removeEventListener("scroll", scheduleViewportRead);
      resizeObserver.disconnect();
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [timelineRef]);
  const seekAtPointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    onSeek(Math.min(endMs, Math.round(pixelsToTimelineTimeMs({ pixel: x, pixelsPerSecond }))));
  };

  return (
    <div
      ref={timelineRef}
      data-testid="social-project-timeline-viewport"
      data-social-timeline-min-zoom={minZoom}
      data-social-timeline-padding-px={trailingPaddingPx}
      data-social-timeline-pixels-per-second={pixelsPerSecond}
      className="overflow-x-auto rounded-md border border-border bg-background"
      onPointerMove={updateGesture}
      onPointerUp={finishGesture}
      onPointerCancel={cancelGesture}
    >
      <div className="flex items-center gap-3 border-b border-border px-3 py-2">
        <label htmlFor="social-project-timeline-zoom" className="text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "socialProject.timeline.zoom" })}
        </label>
        <input
          id="social-project-timeline-zoom"
          type="range"
          min={0}
          max={100}
          value={
            zoomToSlider({
              zoomLevel: effectiveZoomLevel,
              minZoom,
              maxZoom: TIMELINE_ZOOM_MAX,
            }) * 100
          }
          aria-valuetext={`${effectiveZoomLevel.toFixed(1)}×`}
          aria-label={intl.formatMessage({ id: "socialProject.timeline.zoom" })}
          disabled={Boolean(drag)}
          className="w-36 accent-primary"
          onChange={(event) =>
            setZoomLevel(
              sliderToZoom({
                sliderPosition: Number(event.currentTarget.value) / 100,
                minZoom,
                maxZoom: TIMELINE_ZOOM_MAX,
              }),
            )
          }
        />
        <span className="min-w-12 text-ui-xs text-foreground-subtle" aria-hidden="true">
          {effectiveZoomLevel.toFixed(1)}×
        </span>
      </div>
      <div
        style={{
          minWidth: `${
            durationSeconds * pixelsPerSecond + trailingPaddingPx + TIMELINE_TRACK_LABEL_WIDTH_PX
          }px`,
        }}
      >
        <div className="grid grid-cols-[88px_minmax(0,1fr)] border-b border-border">
          <div className="sticky left-0 z-20 border-r border-border bg-background px-3 py-2 text-ui-xs text-foreground-subtle">
            {intl.formatMessage({ id: "socialProject.timeline.ruler" })}
          </div>
          <div className="relative h-8" onPointerDown={seekAtPointer}>
            <SocialProjectRulerMarks
              durationSeconds={durationSeconds}
              frameRateNumerator={fps.numerator}
              frameRateDenominator={fps.denominator}
              pixelsPerSecond={pixelsPerSecond}
              devicePixelRatio={devicePixelRatio}
              tickIntervalSeconds={ruler.tickIntervalSeconds}
              labelIntervalSeconds={ruler.labelIntervalSeconds}
              scrollLeftPx={viewport.scrollLeftPx}
              viewportWidthPx={viewport.widthPx}
              rulerOriginOffsetPx={TIMELINE_TRACK_LABEL_WIDTH_PX}
            />
            <span
              className="absolute bottom-0 top-0 z-10 w-px bg-primary"
              style={{
                left: `${timelineTimeMsToSnappedPixels({
                  timeMs: playheadMs,
                  pixelsPerSecond,
                  devicePixelRatio,
                })}px`,
              }}
              aria-hidden="true"
            />
          </div>
        </div>
        {project.tracks.map((track, trackIndex) => (
          <div
            key={track.trackId}
            className="grid grid-cols-[88px_minmax(0,1fr)] border-b border-border last:border-b-0"
          >
            <div
              data-testid="social-project-track-label"
              className="sticky left-0 z-20 flex items-center truncate border-r border-border bg-background px-3 text-ui-sm"
              title={track.name}
            >
              {track.name}
            </div>
            <div
              data-social-track-id={track.trackId}
              className="relative h-16 border-l border-border bg-card/40"
              onPointerDown={seekAtPointer}
            >
              {drag?.targetTrackId === track.trackId && drag.snapPoint ? (
                <span
                  className="pointer-events-none absolute bottom-0 top-0 z-15 border-l-2 border-primary"
                  style={{
                    left: `${timelineTimeMsToSnappedPixels({
                      timeMs: drag.snapPoint.timeMs,
                      pixelsPerSecond,
                      devicePixelRatio,
                    })}px`,
                  }}
                  aria-hidden="true"
                />
              ) : null}
              {track.clips.map((clip) => {
                const activeDrag = drag?.clipId === clip.clipId ? drag : null;
                const visibleClip = activeDrag?.previewClip ?? clip;
                const width = Math.max(
                  Math.min(32, pixelsPerSecond * 1.5),
                  timelineTimeMsToPixels({
                    timeMs: getSocialProjectClipDurationMs(visibleClip),
                    pixelsPerSecond,
                  }),
                );
                const clipName = clipLabel(clip, assets);
                return (
                  <div
                    key={clip.clipId}
                    data-social-timeline-clip={clip.clipId}
                    className="group/clip absolute h-12"
                    style={{
                      left: `${timelineTimeMsToSnappedPixels({
                        timeMs: visibleClip.timelineStartMs,
                        pixelsPerSecond,
                        devicePixelRatio,
                      })}px`,
                      top: `${8 + ((activeDrag?.targetTrackPosition ?? trackIndex) - trackIndex) * 65}px`,
                      width: `${width}px`,
                      opacity: activeDrag ? 0.85 : 1,
                    }}
                  >
                    <button
                      type="button"
                      aria-label={clipName}
                      aria-grabbed={Boolean(activeDrag)}
                      className="absolute inset-0 z-20 flex touch-none items-center overflow-hidden rounded-md border border-border bg-accent px-2 text-left text-ui-xs text-foreground enabled:cursor-grab enabled:active:cursor-grabbing"
                      title={`${clip.kind}: ${clipName}`}
                      onPointerDown={(event) =>
                        beginGesture(event, "move", track.trackId, trackIndex, clip)
                      }
                      onKeyDown={(event) => handleClipKeyDown(event, trackIndex, clip)}
                    >
                      <span className="truncate">{clipName}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={intl.formatMessage(
                        { id: "socialProject.clip.trimStart" },
                        { clip: clipName },
                      )}
                      title={intl.formatMessage(
                        { id: "socialProject.clip.trimStart" },
                        { clip: clipName },
                      )}
                      disabled={!canEdit}
                      className="absolute inset-y-1 left-0 z-30 w-2 touch-none cursor-ew-resize rounded-l-md bg-primary opacity-45 transition-opacity hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-20 group-hover/clip:opacity-100 group-focus-within/clip:opacity-100"
                      onPointerDown={(event) =>
                        beginGesture(event, "trim-start", track.trackId, trackIndex, clip)
                      }
                      onKeyDown={(event) => handleTrimKeyDown(event, track.trackId, clip, "start")}
                    >
                      <span className="sr-only">
                        {intl.formatMessage(
                          { id: "socialProject.clip.trimStart" },
                          { clip: clipName },
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={intl.formatMessage(
                        { id: "socialProject.clip.trimEnd" },
                        { clip: clipName },
                      )}
                      title={intl.formatMessage(
                        { id: "socialProject.clip.trimEnd" },
                        { clip: clipName },
                      )}
                      disabled={!canEdit}
                      className="absolute inset-y-1 right-0 z-30 w-2 touch-none cursor-ew-resize rounded-r-md bg-primary opacity-45 transition-opacity hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-20 group-hover/clip:opacity-100 group-focus-within/clip:opacity-100"
                      onPointerDown={(event) =>
                        beginGesture(event, "trim-end", track.trackId, trackIndex, clip)
                      }
                      onKeyDown={(event) => handleTrimKeyDown(event, track.trackId, clip, "end")}
                    >
                      <span className="sr-only">
                        {intl.formatMessage(
                          { id: "socialProject.clip.trimEnd" },
                          { clip: clipName },
                        )}
                      </span>
                    </button>
                  </div>
                );
              })}
              <span
                className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-primary"
                style={{
                  left: `${timelineTimeMsToSnappedPixels({
                    timeMs: playheadMs,
                    pixelsPerSecond,
                    devicePixelRatio,
                  })}px`,
                }}
                aria-hidden="true"
              />
            </div>
          </div>
        ))}
        {project.tracks.length === 0 ? (
          <p className="px-4 py-5 text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "socialProject.timeline.noTracks" })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
