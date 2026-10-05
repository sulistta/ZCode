import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SocialMediaAsset,
  SocialMediaPreview,
  SocialMediaPreviewService,
  SocialMediaService,
} from "@social-harness/services";
import type { SocialProject, SocialProjectClip } from "@social-harness/shared";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SocialProjectPreviewMediaLayer } from "./SocialProjectPreviewMediaLayer.js";
import { useSocialMediaPreviewProxy } from "@/hooks/useSocialMediaPreviewProxy.js";
import { SocialProjectPreviewControls } from "./SocialProjectPreviewControls.js";
import { SocialMediaJobsList } from "./SocialMediaJobsList.js";
import { getSocialProjectClipColorFilter, transitionOpacity } from "./socialProjectPreviewModel.js";
import {
  getActiveSocialProjectClips,
  getSocialProjectClipTransform,
  getSocialProjectEndMs,
} from "./socialProjectPlayback.js";

type PreviewMediaElement = HTMLVideoElement | HTMLAudioElement;

function transformStyle(clip: SocialProjectClip, playheadMs: number) {
  const transform = getSocialProjectClipTransform(clip, playheadMs);
  return {
    opacity: transform.opacity * transitionOpacity(clip, playheadMs),
    transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) scale(${transform.scaleX}, ${transform.scaleY}) rotate(${transform.rotation}deg)`,
  };
}

export function SocialProjectPreview({
  accountId,
  project,
  assets,
  mediaPreviewService,
  mediaService,
  playheadMs,
  seekRevision,
  onSeek,
  onTimeChange,
}: {
  accountId: string;
  project: SocialProject;
  assets: SocialMediaAsset[];
  mediaPreviewService?: SocialMediaPreviewService;
  mediaService?: SocialMediaService;
  playheadMs: number;
  seekRevision: number;
  onSeek: (playheadMs: number) => void;
  onTimeChange: (playheadMs: number) => void;
}) {
  const { intl, locale } = useZCodeIntl();
  const [isPlaying, setIsPlaying] = useState(false);
  const [sourcesRevision, setSourcesRevision] = useState(0);
  const [previewErrorIds, setPreviewErrorIds] = useState<string[]>([]);
  const [sceneScale, setSceneScale] = useState(1);
  const frameRef = useRef<HTMLDivElement>(null);
  const mediaElementRefs = useRef(new Map<string, PreviewMediaElement>());
  const previewCache = useRef(new Map<string, SocialMediaPreview>());
  const pendingRequests = useRef(new Map<string, number>());
  const requestGeneration = useRef(0);
  const playheadRef = useRef(playheadMs);
  const onTimeChangeRef = useRef(onTimeChange);
  const endMs = getSocialProjectEndMs(project);
  const activeClips = getActiveSocialProjectClips(project, playheadMs);
  const activeMediaKey = [
    ...new Set(activeClips.flatMap(({ clip }) => (clip.kind === "text" ? [] : [clip.mediaId]))),
  ].join(",");
  const activeMediaIds = useMemo(
    () => (activeMediaKey ? activeMediaKey.split(",") : []),
    [activeMediaKey],
  );
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.mediaId, asset])), [assets]);
  const frameWidth = Math.min(
    640,
    Math.max(1, (project.settings.width / project.settings.height) * 400),
  );

  playheadRef.current = playheadMs;
  onTimeChangeRef.current = onTimeChange;

  const registerMediaElement = useCallback(
    (clipId: string, element: PreviewMediaElement | null) => {
      if (element) mediaElementRefs.current.set(clipId, element);
      else mediaElementRefs.current.delete(clipId);
    },
    [],
  );

  const requestPreview = useCallback(
    (mediaId: string, force = false) => {
      const cached = previewCache.current.get(mediaId);
      if (!force && cached && cached.expiresAt > Date.now() + 15_000) return;
      if (!mediaPreviewService || pendingRequests.current.has(mediaId)) return;
      const generation = requestGeneration.current;
      pendingRequests.current.set(mediaId, generation);
      void mediaPreviewService
        .prepare({ accountId, mediaId })
        .then((preview) => {
          if (generation !== requestGeneration.current) return;
          previewCache.current.set(mediaId, preview);
          setPreviewErrorIds((current) => current.filter((id) => id !== mediaId));
          setSourcesRevision((revision) => revision + 1);
        })
        .catch(() => {
          if (generation !== requestGeneration.current) return;
          setPreviewErrorIds((current) =>
            current.includes(mediaId) ? current : [...current, mediaId],
          );
        })
        .finally(() => {
          if (pendingRequests.current.get(mediaId) === generation) {
            pendingRequests.current.delete(mediaId);
          }
        });
    },
    [accountId, mediaPreviewService],
  );

  const proxy = useSocialMediaPreviewProxy({
    accountId,
    previewService: mediaPreviewService,
    mediaService,
    onCompleted(mediaId) {
      requestPreview(mediaId, true);
    },
  });
  const handlePreviewError = useCallback(
    (mediaId: string) => {
      const representation = previewCache.current.get(mediaId)?.representation;
      previewCache.current.delete(mediaId);
      setPreviewErrorIds((current) =>
        current.includes(mediaId) ? current : [...current, mediaId],
      );
      // 原始视频解码失败才请求兼容预览；代理失败不能再次自动转码形成循环。
      if (representation === "original" && assetById.get(mediaId)?.mediaKind === "video")
        proxy.observeDecoderFailure(mediaId);
    },
    [assetById, proxy.observeDecoderFailure],
  );

  useEffect(() => {
    requestGeneration.current += 1;
    previewCache.current.clear();
    pendingRequests.current.clear();
    setPreviewErrorIds([]);
    setSourcesRevision((revision) => revision + 1);
  }, [accountId, mediaPreviewService]);

  useEffect(() => {
    for (const mediaId of activeMediaIds) requestPreview(mediaId);
  }, [activeMediaKey, requestPreview, sourcesRevision]);

  useEffect(() => {
    const nextExpiry = Math.min(
      ...activeMediaIds
        .map((mediaId) => previewCache.current.get(mediaId)?.expiresAt ?? Number.POSITIVE_INFINITY)
        .filter(Number.isFinite),
    );
    if (!Number.isFinite(nextExpiry)) return;
    const refreshDelay = Math.max(0, nextExpiry - Date.now() - 15_000);
    const timer = window.setTimeout(() => {
      for (const mediaId of activeMediaIds) requestPreview(mediaId);
    }, refreshDelay);
    return () => window.clearTimeout(timer);
  }, [activeMediaKey, activeMediaIds, requestPreview, sourcesRevision]);

  useEffect(() => {
    if (!frameRef.current) return;
    const frame = frameRef.current;
    const updateScale = () => {
      const width = frame.getBoundingClientRect().width;
      if (width <= 0) return;
      setSceneScale(width / project.settings.width);
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [project.settings.height, project.settings.width]);

  // 显式 seek 或接受新 revision 会递增 seekRevision；重置时钟起点，避免播放头回跳到旧位置。
  useEffect(() => {
    if (!isPlaying) return;
    let frameId = 0;
    let lastUpdate = 0;
    const startTime = performance.now();
    const startPlayhead = playheadRef.current;
    const tick = (now: number) => {
      const nextPlayhead = Math.min(endMs, startPlayhead + now - startTime);
      if (now - lastUpdate >= 80 || nextPlayhead === endMs) {
        onTimeChangeRef.current(nextPlayhead);
        lastUpdate = now;
      }
      if (nextPlayhead >= endMs) {
        setIsPlaying(false);
        for (const element of mediaElementRefs.current.values()) element.pause();
        return;
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [endMs, isPlaying, seekRevision]);

  const handlePlayToggle = () => {
    if (isPlaying) {
      for (const element of mediaElementRefs.current.values()) element.pause();
      setIsPlaying(false);
      return;
    }
    if (playheadMs >= endMs) {
      playheadRef.current = 0;
      onSeek(0);
    }
    setIsPlaying(true);
    for (const element of mediaElementRefs.current.values()) {
      void element.play().catch(() => setIsPlaying(false));
    }
  };

  const handleSeek = (nextPlayheadMs: number) => {
    for (const element of mediaElementRefs.current.values()) element.pause();
    setIsPlaying(false);
    onSeek(nextPlayheadMs);
  };

  const assetError = activeMediaIds.find((mediaId) => previewErrorIds.includes(mediaId));

  return (
    <section className="grid gap-3 rounded-md border border-border bg-card p-4">
      <div>
        <h2 className="text-ui-base font-semibold">
          {intl.formatMessage({ id: "socialProject.preview.title" })}
        </h2>
        <p className="mt-1 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "socialProject.preview.unavailable" })}
        </p>
        <p className="mt-1 text-ui-sm text-foreground-subtle">
          {intl.formatMessage(
            { id: "socialProject.preview.acceptedRevision" },
            { revision: project.revision },
          )}
        </p>
      </div>

      <div className="grid justify-items-center gap-2">
        <div
          ref={frameRef}
          className="relative max-w-full overflow-hidden rounded-md border border-border"
          style={{
            width: `${frameWidth}px`,
            aspectRatio: `${project.settings.width} / ${project.settings.height}`,
            backgroundColor: project.settings.backgroundColor,
          }}
          aria-label={intl.formatMessage({ id: "socialProject.preview.frameLabel" })}
        >
          <div
            className="absolute left-1/2 top-1/2"
            style={{
              width: project.settings.width,
              height: project.settings.height,
              transform: `translate(-50%, -50%) scale(${sceneScale})`,
              transformOrigin: "center",
              backgroundColor: project.settings.backgroundColor,
            }}
          >
            {activeClips.map(({ clip, track, trackPosition }) => {
              if (clip.kind === "text") {
                const style = transformStyle(clip, playheadMs);
                return (
                  <div
                    key={clip.clipId}
                    className="absolute left-1/2 top-1/2"
                    style={{
                      ...style,
                      // 按整层宽度保留用户换行，避免浏览器按右半区自动折行而与 FFmpeg 不同。
                      width: "max-content",
                      whiteSpace: "pre",
                      zIndex: trackPosition + 1,
                      color: clip.style.color,
                      fontFamily: clip.style.fontFamily,
                      fontSize: clip.style.fontSize,
                      textAlign: clip.style.alignment,
                    }}
                  >
                    {clip.text}
                  </div>
                );
              }
              const asset = assetById.get(clip.mediaId);
              const preview = previewCache.current.get(clip.mediaId);
              if (!asset || !preview) return null;
              const commonStyle = {
                ...transformStyle(clip, playheadMs),
                filter: getSocialProjectClipColorFilter(clip),
                zIndex: trackPosition + 1,
                position: "absolute" as const,
                left: "50%",
                top: "50%",
                width: project.settings.width,
                height: project.settings.height,
                objectFit: "contain" as const,
              };
              if (clip.kind === "image" && asset.mediaKind === "image") {
                return (
                  <img
                    key={clip.clipId}
                    src={preview.url}
                    alt={asset.originalName}
                    draggable={false}
                    style={commonStyle}
                    onError={() => handlePreviewError(clip.mediaId)}
                  />
                );
              }
              if (clip.kind === "video" && asset.mediaKind === "video") {
                return (
                  <SocialProjectPreviewMediaLayer
                    key={clip.clipId}
                    clip={clip}
                    preview={preview}
                    style={commonStyle}
                    trackMuted={track.muted}
                    playheadRef={playheadRef}
                    seekRevision={seekRevision}
                    isPlaying={isPlaying}
                    registerElement={registerMediaElement}
                    onError={handlePreviewError}
                  />
                );
              }
              if (clip.kind === "audio" && asset.mediaKind === "audio") {
                return (
                  <SocialProjectPreviewMediaLayer
                    key={clip.clipId}
                    clip={clip}
                    preview={preview}
                    style={{ display: "none" }}
                    trackMuted={track.muted}
                    playheadRef={playheadRef}
                    seekRevision={seekRevision}
                    isPlaying={isPlaying}
                    registerElement={registerMediaElement}
                    onError={handlePreviewError}
                  />
                );
              }
              return null;
            })}
          </div>
          {activeClips.length === 0 ? (
            <div className="absolute inset-0 grid place-items-center px-4 text-center text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "socialProject.preview.empty" })}
            </div>
          ) : null}
          {activeMediaIds.length > 0 &&
          activeMediaIds.every((mediaId) => !previewCache.current.has(mediaId)) ? (
            <div className="absolute inset-0 grid place-items-center bg-background/75 text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "socialProject.preview.loading" })}
            </div>
          ) : null}
        </div>

        {assetError ? (
          <div className="flex flex-wrap items-center justify-center gap-2" role="alert">
            <span className="text-ui-sm text-destructive">
              {intl.formatMessage({ id: "socialProject.preview.loadFailed" })}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setPreviewErrorIds((current) =>
                  current.filter((mediaId) => mediaId !== assetError),
                );
                requestPreview(assetError, true);
              }}
            >
              {intl.formatMessage({ id: "socialProject.preview.retry" })}
            </Button>
          </div>
        ) : null}
      </div>

      <SocialMediaJobsList
        jobs={proxy.jobs}
        busyJobId={proxy.busyJobId}
        intl={intl}
        locale={locale}
        onCancel={(jobId) => void proxy.changeJob(jobId, "cancel").catch(() => undefined)}
        onRetry={(jobId) => void proxy.changeJob(jobId, "retry").catch(() => undefined)}
      />

      <SocialProjectPreviewControls
        isPlaying={isPlaying}
        playheadMs={playheadMs}
        endMs={endMs}
        onPlayToggle={handlePlayToggle}
        onSeek={handleSeek}
      />
    </section>
  );
}
