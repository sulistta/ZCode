import { useEffect, useState } from "react";
import {
  SOCIAL_PROJECT_DEFAULT_COLOR_ADJUSTMENTS,
  type SocialProjectClip,
  type SocialProjectColorAdjustments,
  type SocialProjectTrack,
} from "@social-harness/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SocialProjectClipEffectsForm } from "./SocialProjectClipEffectsForm.js";

function clipDurationMs(clip: SocialProjectClip): number {
  if (clip.kind === "text") return clip.durationMs;
  return (clip.sourceEndMs - clip.sourceStartMs) / clip.playbackRate;
}

function clipColorAdjustments(clip: SocialProjectClip): SocialProjectColorAdjustments {
  return clip.kind === "video" || clip.kind === "image"
    ? (clip.colorAdjustments ?? SOCIAL_PROJECT_DEFAULT_COLOR_ADJUSTMENTS)
    : SOCIAL_PROJECT_DEFAULT_COLOR_ADJUSTMENTS;
}

export function SocialProjectClipActions({
  trackId,
  clip,
  tracks,
  disabled,
  onUpdate,
  onMove,
  onSplit,
  onRemove,
}: {
  trackId: string;
  clip: SocialProjectClip;
  tracks: SocialProjectTrack[];
  disabled: boolean;
  onUpdate: (trackId: string, clip: SocialProjectClip) => Promise<void>;
  onMove: (clipId: string, targetTrackId: string, timelineStartMs: number) => Promise<void>;
  onSplit: (clipId: string, splitAtMs: number, newClipId: string) => Promise<void>;
  onRemove: (clipId: string) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const [timelineStart, setTimelineStart] = useState(String(clip.timelineStartMs / 1000));
  const [splitAt, setSplitAt] = useState(
    String((clip.timelineStartMs + clipDurationMs(clip) / 2) / 1000),
  );
  const [targetTrackId, setTargetTrackId] = useState(trackId);
  const [sourceStart, setSourceStart] = useState(
    clip.kind === "text" ? "" : String(clip.sourceStartMs / 1000),
  );
  const [sourceEnd, setSourceEnd] = useState(
    clip.kind === "text" ? "" : String(clip.sourceEndMs / 1000),
  );
  const [duration, setDuration] = useState(
    clip.kind === "text" ? String(clip.durationMs / 1000) : "",
  );
  const [playbackRate, setPlaybackRate] = useState(
    clip.kind === "text" ? "1" : String(clip.playbackRate),
  );
  const [volume, setVolume] = useState(String(clip.kind === "text" ? 1 : clip.volume));
  const [text, setText] = useState(clip.kind === "text" ? clip.text : "");
  const [brightness, setBrightness] = useState(String(clipColorAdjustments(clip).brightness));
  const [contrast, setContrast] = useState(String(clipColorAdjustments(clip).contrast));
  const [saturation, setSaturation] = useState(String(clipColorAdjustments(clip).saturation));
  const [hue, setHue] = useState(String(clipColorAdjustments(clip).hue));
  const [validationError, setValidationError] = useState<string | null>(null);
  const compatibleTracks = tracks.filter(
    (track) =>
      track.type === (clip.kind === "audio" ? "audio" : clip.kind === "text" ? "text" : "video"),
  );

  useEffect(() => {
    setTimelineStart(String(clip.timelineStartMs / 1000));
    setSplitAt(String((clip.timelineStartMs + clipDurationMs(clip) / 2) / 1000));
    setTargetTrackId(trackId);
    setSourceStart(clip.kind === "text" ? "" : String(clip.sourceStartMs / 1000));
    setSourceEnd(clip.kind === "text" ? "" : String(clip.sourceEndMs / 1000));
    setDuration(clip.kind === "text" ? String(clip.durationMs / 1000) : "");
    setPlaybackRate(clip.kind === "text" ? "1" : String(clip.playbackRate));
    setVolume(String(clip.kind === "text" ? 1 : clip.volume));
    setText(clip.kind === "text" ? clip.text : "");
    const colorAdjustments = clipColorAdjustments(clip);
    setBrightness(String(colorAdjustments.brightness));
    setContrast(String(colorAdjustments.contrast));
    setSaturation(String(colorAdjustments.saturation));
    setHue(String(colorAdjustments.hue));
  }, [clip, trackId]);

  const saveClip = () => {
    setValidationError(null);
    const nextVolume = Number(volume);
    if (clip.kind === "text") {
      const durationMs = Math.round(Number(duration) * 1000);
      if (!text.trim()) {
        setValidationError(intl.formatMessage({ id: "socialProject.clip.textRequired" }));
        return;
      }
      if (!Number.isFinite(durationMs) || durationMs < 100) {
        setValidationError(intl.formatMessage({ id: "socialProject.clip.invalidRange" }));
        return;
      }
      void onUpdate(trackId, { ...clip, text: text.trim(), durationMs });
      return;
    }
    const sourceStartMs = Math.round(Number(sourceStart) * 1000);
    const sourceEndMs = Math.round(Number(sourceEnd) * 1000);
    const nextPlaybackRate = Number(playbackRate);
    const nextColorAdjustments = {
      brightness: Number(brightness),
      contrast: Number(contrast),
      saturation: Number(saturation),
      hue: Number(hue),
    };
    const hasInvalidColorAdjustments =
      !Number.isFinite(nextColorAdjustments.brightness) ||
      nextColorAdjustments.brightness < -1 ||
      nextColorAdjustments.brightness > 1 ||
      !Number.isFinite(nextColorAdjustments.contrast) ||
      nextColorAdjustments.contrast < 0 ||
      nextColorAdjustments.contrast > 2 ||
      !Number.isFinite(nextColorAdjustments.saturation) ||
      nextColorAdjustments.saturation < 0 ||
      nextColorAdjustments.saturation > 2 ||
      !Number.isFinite(nextColorAdjustments.hue) ||
      nextColorAdjustments.hue < -180 ||
      nextColorAdjustments.hue > 180;
    const hasVisualAdjustments = clip.kind === "video" || clip.kind === "image";
    if (
      !Number.isFinite(sourceStartMs) ||
      !Number.isFinite(sourceEndMs) ||
      sourceEndMs <= sourceStartMs ||
      !Number.isFinite(nextVolume) ||
      nextVolume < 0 ||
      nextVolume > 4 ||
      !Number.isFinite(nextPlaybackRate) ||
      nextPlaybackRate < 0.25 ||
      nextPlaybackRate > 4 ||
      (hasVisualAdjustments && hasInvalidColorAdjustments)
    ) {
      setValidationError(intl.formatMessage({ id: "socialProject.clip.invalidRange" }));
      return;
    }
    if (hasVisualAdjustments) {
      void onUpdate(trackId, {
        ...clip,
        sourceStartMs,
        sourceEndMs,
        playbackRate: nextPlaybackRate,
        volume: nextVolume,
        colorAdjustments: nextColorAdjustments,
      });
    } else {
      void onUpdate(trackId, {
        ...clip,
        sourceStartMs,
        sourceEndMs,
        playbackRate: nextPlaybackRate,
        volume: nextVolume,
      });
    }
  };

  return (
    <div
      data-testid={`social-project-clip-actions-${clip.clipId}`}
      className="grid gap-2 rounded-md border border-border bg-card p-3"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="rounded bg-accent px-1.5 py-0.5 text-ui-xs uppercase">{clip.kind}</span>
        <span className="truncate text-ui-sm text-foreground-subtle">{clip.clipId}</span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-ui-xs">
          {intl.formatMessage({ id: "socialProject.clip.moveTo" })}
          <Input
            type="number"
            min="0"
            step="0.1"
            className="w-28"
            value={timelineStart}
            onChange={(event) => setTimelineStart(event.currentTarget.value)}
            disabled={disabled}
          />
        </label>
        <label className="grid gap-1 text-ui-xs">
          {intl.formatMessage({ id: "socialProject.clip.targetTrack" })}
          <select
            className="h-7 min-w-32 rounded-md border border-input-border bg-input px-2 text-ui-sm"
            value={targetTrackId}
            onChange={(event) => setTargetTrackId(event.currentTarget.value)}
            disabled={disabled}
          >
            {compatibleTracks.map((track) => (
              <option key={track.trackId} value={track.trackId}>
                {track.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={
            disabled || !Number.isFinite(Number(timelineStart)) || Number(timelineStart) < 0
          }
          onClick={() =>
            void onMove(clip.clipId, targetTrackId, Math.round(Number(timelineStart) * 1000))
          }
        >
          {intl.formatMessage({ id: "socialProject.clip.move" })}
        </Button>
        <label className="grid gap-1 text-ui-xs">
          {intl.formatMessage({ id: "socialProject.clip.splitAt" })}
          <Input
            type="number"
            min="0"
            step="0.1"
            className="w-28"
            value={splitAt}
            onChange={(event) => setSplitAt(event.currentTarget.value)}
            disabled={disabled}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !Number.isFinite(Number(splitAt)) || Number(splitAt) < 0}
          onClick={() =>
            void onSplit(clip.clipId, Math.round(Number(splitAt) * 1000), crypto.randomUUID())
          }
        >
          {intl.formatMessage({ id: "socialProject.clip.split" })}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => void onRemove(clip.clipId)}
        >
          {intl.formatMessage({ id: "socialProject.clip.remove" })}
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {clip.kind === "text" ? (
          <>
            <label className="grid min-w-52 flex-1 gap-1 text-ui-xs">
              {intl.formatMessage({ id: "socialProject.clip.text" })}
              <Textarea
                className="min-h-12"
                value={text}
                maxLength={10_000}
                onChange={(event) => setText(event.currentTarget.value)}
                disabled={disabled}
              />
            </label>
            <label className="grid gap-1 text-ui-xs">
              {intl.formatMessage({ id: "socialProject.clip.duration" })}
              <Input
                className="w-28"
                type="number"
                min="0.1"
                step="0.1"
                value={duration}
                onChange={(event) => setDuration(event.currentTarget.value)}
                disabled={disabled}
              />
            </label>
          </>
        ) : (
          <>
            <label className="grid gap-1 text-ui-xs">
              {intl.formatMessage({ id: "socialProject.clip.sourceStart" })}
              <Input
                className="w-28"
                type="number"
                min="0"
                step="0.1"
                value={sourceStart}
                onChange={(event) => setSourceStart(event.currentTarget.value)}
                disabled={disabled}
              />
            </label>
            <label className="grid gap-1 text-ui-xs">
              {intl.formatMessage({ id: "socialProject.clip.sourceEnd" })}
              <Input
                className="w-28"
                type="number"
                min="0.1"
                step="0.1"
                value={sourceEnd}
                onChange={(event) => setSourceEnd(event.currentTarget.value)}
                disabled={disabled}
              />
            </label>
            <label className="grid gap-1 text-ui-xs">
              {intl.formatMessage({ id: "socialProject.clip.playbackRate" })}
              <Input
                className="w-24"
                type="number"
                min="0.25"
                max="4"
                step="0.05"
                value={playbackRate}
                onChange={(event) => setPlaybackRate(event.currentTarget.value)}
                disabled={disabled}
              />
            </label>
          </>
        )}
        {clip.kind !== "text" ? (
          <label className="grid gap-1 text-ui-xs">
            {intl.formatMessage({ id: "socialProject.clip.volume" })}
            <Input
              className="w-24"
              type="number"
              min="0"
              max="4"
              step="0.05"
              value={volume}
              onChange={(event) => setVolume(event.currentTarget.value)}
              disabled={disabled}
            />
          </label>
        ) : null}
        {clip.kind === "video" || clip.kind === "image" ? (
          <>
            <label className="grid gap-1 text-ui-xs">
              {intl.formatMessage({ id: "socialProject.clip.brightness" })}
              <Input
                className="w-24"
                type="number"
                min="-1"
                max="1"
                step="0.05"
                value={brightness}
                onChange={(event) => setBrightness(event.currentTarget.value)}
                disabled={disabled}
              />
            </label>
            <label className="grid gap-1 text-ui-xs">
              {intl.formatMessage({ id: "socialProject.clip.contrast" })}
              <Input
                className="w-24"
                type="number"
                min="0"
                max="2"
                step="0.05"
                value={contrast}
                onChange={(event) => setContrast(event.currentTarget.value)}
                disabled={disabled}
              />
            </label>
            <label className="grid gap-1 text-ui-xs">
              {intl.formatMessage({ id: "socialProject.clip.saturation" })}
              <Input
                className="w-24"
                type="number"
                min="0"
                max="2"
                step="0.05"
                value={saturation}
                onChange={(event) => setSaturation(event.currentTarget.value)}
                disabled={disabled}
              />
            </label>
            <label className="grid gap-1 text-ui-xs">
              {intl.formatMessage({ id: "socialProject.clip.hue" })}
              <Input
                className="w-24"
                type="number"
                min="-180"
                max="180"
                step="1"
                value={hue}
                onChange={(event) => setHue(event.currentTarget.value)}
                disabled={disabled}
              />
            </label>
          </>
        ) : null}
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={saveClip}>
          {intl.formatMessage({ id: "socialProject.clip.save" })}
        </Button>
      </div>
      {validationError ? (
        <p className="text-ui-sm text-destructive" role="alert">
          {validationError}
        </p>
      ) : null}
      <SocialProjectClipEffectsForm
        trackId={trackId}
        clip={clip}
        disabled={disabled}
        onUpdate={onUpdate}
      />
    </div>
  );
}
