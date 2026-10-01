import { useCallback, useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { SocialMediaPreview } from "@social-harness/services";
import type { SocialProjectClip } from "@social-harness/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  getSocialProjectClipVolume,
  getSocialProjectSourceTimeMs,
} from "./socialProjectPlayback.js";
import { transitionOpacity } from "./socialProjectPreviewModel.js";

type PreviewMediaElement = HTMLVideoElement | HTMLAudioElement;

export function SocialProjectPreviewMediaLayer({
  clip,
  preview,
  style,
  trackMuted,
  playheadRef,
  seekRevision,
  isPlaying,
  registerElement,
  onError,
}: {
  clip: Exclude<SocialProjectClip, { kind: "text" }>;
  preview: SocialMediaPreview;
  style: CSSProperties;
  trackMuted: boolean;
  playheadRef: { current: number };
  seekRevision: number;
  isPlaying: boolean;
  registerElement: (clipId: string, element: PreviewMediaElement | null) => void;
  onError: (mediaId: string) => void;
}) {
  const { intl } = useZCodeIntl();
  const elementRef = useRef<PreviewMediaElement | null>(null);
  const setElementRef = useCallback(
    (element: PreviewMediaElement | null) => {
      elementRef.current = element;
      registerElement(clip.clipId, element);
    },
    [clip.clipId, registerElement],
  );

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const seekToCurrentProjectTime = () => {
      const sourceTimeMs = getSocialProjectSourceTimeMs(clip, playheadRef.current);
      if (!Number.isFinite(sourceTimeMs)) return;
      try {
        element.currentTime = sourceTimeMs / 1000;
      } catch {
        return;
      }
    };
    if (element.readyState >= HTMLMediaElement.HAVE_METADATA) seekToCurrentProjectTime();
    else element.addEventListener("loadedmetadata", seekToCurrentProjectTime, { once: true });
    return () => element.removeEventListener("loadedmetadata", seekToCurrentProjectTime);
  }, [clip, playheadRef, preview.url, seekRevision]);

  const volume = Math.min(1, Math.max(0, getSocialProjectClipVolume(clip, playheadRef.current)));
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    element.playbackRate = clip.playbackRate;
    element.volume = trackMuted ? 0 : volume * transitionOpacity(clip, playheadRef.current);
  }, [clip, playheadRef, trackMuted, volume, isPlaying]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    if (isPlaying) void element.play().catch(() => element.pause());
    else element.pause();
  }, [isPlaying, preview.url]);

  if (clip.kind === "video") {
    return (
      <video
        ref={setElementRef}
        src={preview.url}
        playsInline
        preload="auto"
        muted={trackMuted || volume === 0}
        aria-label={intl.formatMessage({ id: "socialProject.preview.mediaLabel" })}
        style={style}
        onError={() => onError(clip.mediaId)}
      />
    );
  }
  if (clip.kind === "audio") {
    return (
      <audio
        ref={setElementRef}
        src={preview.url}
        preload="auto"
        style={style}
        onError={() => onError(clip.mediaId)}
      />
    );
  }
  return null;
}
