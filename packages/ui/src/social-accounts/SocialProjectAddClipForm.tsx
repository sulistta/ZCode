import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { SocialMediaAsset } from "@social-harness/services";
import type { SocialProject, SocialProjectClip } from "@social-harness/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Textarea } from "@/components/ui/textarea.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

function secondsToMs(value: string): number | null {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : null;
}

export function SocialProjectAddClipForm({
  project,
  assets,
  canEdit,
  onAdd,
}: {
  project: SocialProject;
  assets: SocialMediaAsset[];
  canEdit: boolean;
  onAdd: (trackId: string, clip: SocialProjectClip) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const [assetId, setAssetId] = useState("");
  const [trackId, setTrackId] = useState("");
  const [timelineStart, setTimelineStart] = useState("0");
  const [sourceStart, setSourceStart] = useState("0");
  const [sourceEnd, setSourceEnd] = useState("");
  const [clipText, setClipText] = useState("");
  const [textDuration, setTextDuration] = useState("5");
  const [isWorking, setIsWorking] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const selectedAsset = assets.find((asset) => asset.mediaId === assetId) ?? null;
  const expectedTrackType = selectedAsset?.mediaKind === "audio" ? "audio" : "video";
  const compatibleTracks = useMemo(
    () =>
      project.tracks.filter((track) =>
        selectedAsset ? track.type === expectedTrackType : track.type === "text",
      ),
    [expectedTrackType, project.tracks, selectedAsset],
  );

  useEffect(() => {
    if (selectedAsset) {
      const defaultEnd =
        selectedAsset.mediaKind === "image" ? 5 : selectedAsset.sourceDurationSeconds;
      setSourceEnd(defaultEnd == null ? "" : String(defaultEnd));
      const nextTrack = project.tracks.find((track) => track.type === expectedTrackType);
      setTrackId(nextTrack?.trackId ?? "");
    } else {
      setTrackId(project.tracks.find((track) => track.type === "text")?.trackId ?? "");
    }
  }, [expectedTrackType, project.tracks, selectedAsset]);

  const addMediaClip = async () => {
    if (!selectedAsset) return;
    const timelineStartMs = secondsToMs(timelineStart);
    const sourceStartMs = secondsToMs(sourceStart);
    const sourceEndMs = secondsToMs(sourceEnd);
    if (
      !trackId ||
      timelineStartMs == null ||
      sourceStartMs == null ||
      sourceEndMs == null ||
      sourceEndMs <= sourceStartMs
    ) {
      setFormError(intl.formatMessage({ id: "socialProject.clip.invalidRange" }));
      return;
    }
    const clip: SocialProjectClip = {
      clipId: crypto.randomUUID(),
      kind: selectedAsset.mediaKind,
      mediaId: selectedAsset.mediaId,
      timelineStartMs,
      sourceStartMs,
      sourceEndMs,
      playbackRate: 1,
      volume: 1,
      keyframes: [],
    };
    await onAdd(trackId, clip);
    setFormError(null);
  };

  const addTextClip = async () => {
    const timelineStartMs = secondsToMs(timelineStart);
    const durationMs = secondsToMs(textDuration);
    if (!trackId || timelineStartMs == null || durationMs == null || durationMs < 100) {
      setFormError(intl.formatMessage({ id: "socialProject.clip.invalidRange" }));
      return;
    }
    if (!clipText.trim()) {
      setFormError(intl.formatMessage({ id: "socialProject.clip.textRequired" }));
      return;
    }
    const clip: SocialProjectClip = {
      clipId: crypto.randomUUID(),
      kind: "text",
      timelineStartMs,
      durationMs,
      text: clipText.trim(),
      style: { fontFamily: "sans-serif", fontSize: 32, color: "#FFFFFF", alignment: "center" },
      keyframes: [],
    };
    await onAdd(trackId, clip);
    setClipText("");
    setFormError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || isWorking) return;
    setIsWorking(true);
    try {
      if (selectedAsset) await addMediaClip();
      else await addTextClip();
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <form className="grid gap-3 rounded-md border border-border bg-card p-4" onSubmit={submit}>
      <div>
        <h3 className="text-ui-base font-semibold">
          {intl.formatMessage({ id: "socialProject.clip.addTitle" })}
        </h3>
        <p className="mt-1 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "socialProject.clip.addDescription" })}
        </p>
      </div>
      <label className="grid gap-1 text-ui-sm">
        {intl.formatMessage({ id: "socialProject.clip.asset" })}
        <select
          className="h-8 rounded-md border border-input-border bg-input px-2 text-ui-base"
          value={assetId}
          onChange={(event) => setAssetId(event.currentTarget.value)}
          disabled={!canEdit || isWorking}
        >
          <option value="">{intl.formatMessage({ id: "socialProject.clip.textOnly" })}</option>
          {assets.map((asset) => (
            <option key={asset.mediaId} value={asset.mediaId}>
              {asset.originalName} · {asset.mediaKind}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-ui-sm">
        {intl.formatMessage({ id: "socialProject.clip.track" })}
        <select
          className="h-8 rounded-md border border-input-border bg-input px-2 text-ui-base"
          value={trackId}
          onChange={(event) => setTrackId(event.currentTarget.value)}
          disabled={!canEdit || isWorking || compatibleTracks.length === 0}
          required
        >
          <option value="">{intl.formatMessage({ id: "socialProject.clip.chooseTrack" })}</option>
          {compatibleTracks.map((track) => (
            <option key={track.trackId} value={track.trackId}>
              {track.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-ui-sm">
          {intl.formatMessage({ id: "socialProject.clip.timelineStart" })}
          <Input
            type="number"
            min="0"
            step="0.1"
            value={timelineStart}
            onChange={(event) => setTimelineStart(event.currentTarget.value)}
            disabled={!canEdit || isWorking}
          />
        </label>
        {selectedAsset ? (
          <>
            <label className="grid gap-1 text-ui-sm">
              {intl.formatMessage({ id: "socialProject.clip.sourceStart" })}
              <Input
                type="number"
                min="0"
                step="0.1"
                value={sourceStart}
                onChange={(event) => setSourceStart(event.currentTarget.value)}
                disabled={!canEdit || isWorking}
              />
            </label>
            <label className="grid gap-1 text-ui-sm">
              {intl.formatMessage({ id: "socialProject.clip.sourceEnd" })}
              <Input
                type="number"
                min="0.1"
                step="0.1"
                value={sourceEnd}
                onChange={(event) => setSourceEnd(event.currentTarget.value)}
                disabled={!canEdit || isWorking}
              />
            </label>
          </>
        ) : (
          <label className="grid gap-1 text-ui-sm">
            {intl.formatMessage({ id: "socialProject.clip.duration" })}
            <Input
              type="number"
              min="0.1"
              step="0.1"
              value={textDuration}
              onChange={(event) => setTextDuration(event.currentTarget.value)}
              disabled={!canEdit || isWorking}
            />
          </label>
        )}
      </div>
      {!selectedAsset ? (
        <label className="grid gap-1 text-ui-sm">
          {intl.formatMessage({ id: "socialProject.clip.text" })}
          <Textarea
            value={clipText}
            onChange={(event) => setClipText(event.currentTarget.value)}
            disabled={!canEdit || isWorking}
            maxLength={10_000}
          />
        </label>
      ) : null}
      {compatibleTracks.length === 0 ? (
        <p className="text-ui-sm text-foreground-subtle" role="status">
          {intl.formatMessage({ id: "socialProject.clip.noTrack" })}
        </p>
      ) : null}
      {formError ? (
        <p className="text-ui-sm text-destructive" role="alert">
          {formError}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="sm" disabled={!canEdit || isWorking || !trackId}>
          {intl.formatMessage({ id: "socialProject.clip.add" })}
        </Button>
      </div>
    </form>
  );
}
