import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

function formatTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function SocialProjectPreviewControls({
  isPlaying,
  playheadMs,
  endMs,
  onPlayToggle,
  onSeek,
}: {
  isPlaying: boolean;
  playheadMs: number;
  endMs: number;
  onPlayToggle(): void;
  onSeek(value: number): void;
}) {
  const { intl } = useZCodeIntl();
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
      <Button type="button" size="sm" variant="outline" onClick={onPlayToggle}>
        {intl.formatMessage({
          id: isPlaying ? "socialProject.preview.pause" : "socialProject.preview.play",
        })}
      </Button>
      <input
        type="range"
        min={0}
        max={endMs}
        step={50}
        value={Math.min(playheadMs, endMs)}
        onChange={(event) => onSeek(Number(event.currentTarget.value))}
        aria-label={intl.formatMessage({ id: "socialProject.preview.scrubber" })}
        className="w-full accent-foreground"
      />
      <span className="whitespace-nowrap text-ui-xs tabular-nums text-foreground-subtle">
        {formatTime(playheadMs)} / {formatTime(endMs)}
      </span>
    </div>
  );
}
