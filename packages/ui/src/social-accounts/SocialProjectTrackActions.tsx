import type { SocialProjectTrack } from "@social-harness/shared";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function SocialProjectTrackActions({
  tracks,
  track,
  position,
  disabled,
  onMove,
  onRemove,
}: {
  tracks: SocialProjectTrack[];
  track: SocialProjectTrack;
  position: number;
  disabled: boolean;
  onMove: (trackId: string, position: number) => Promise<void>;
  onRemove: (trackId: string) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate text-ui-sm font-medium">{track.name}</span>
        <span className="text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "socialProject.track.count" }, { count: track.clips.length })}
        </span>
      </div>
      <div className="flex gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || position === 0}
          onClick={() => void onMove(track.trackId, position - 1)}
        >
          {intl.formatMessage({ id: "socialProject.track.up" })}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || position === tracks.length - 1}
          onClick={() => void onMove(track.trackId, position + 1)}
        >
          {intl.formatMessage({ id: "socialProject.track.down" })}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || track.clips.length > 0 || tracks.length <= 1}
          title={
            track.clips.length > 0
              ? intl.formatMessage({ id: "socialProject.track.removeRequiresEmpty" })
              : undefined
          }
          onClick={() => void onRemove(track.trackId)}
        >
          {intl.formatMessage({ id: "socialProject.track.remove" })}
        </Button>
      </div>
    </div>
  );
}
