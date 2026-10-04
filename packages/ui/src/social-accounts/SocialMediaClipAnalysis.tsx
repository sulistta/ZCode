import { useCallback, useRef, useState } from "react";
import { Music2, Podcast, RefreshCw, WandSparkles } from "lucide-react";
import type {
  SocialMediaAsset,
  SocialMediaClipCandidateEvidence,
  SocialMediaClipCandidateMode,
  SocialMediaClipCandidateResult,
  SocialMediaService,
} from "@social-harness/services";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

function formatTimestamp(seconds: number): string {
  const wholeSeconds = Math.floor(seconds);
  const hours = Math.floor(wholeSeconds / 3_600);
  const minutes = Math.floor((wholeSeconds % 3_600) / 60);
  const remainder = wholeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function EvidenceText({
  evidence,
  intl,
}: {
  evidence: SocialMediaClipCandidateEvidence;
  intl: ReturnType<typeof useZCodeIntl>["intl"];
}) {
  switch (evidence.kind) {
    case "speech":
      return (
        <div>
          <p>
            {intl.formatMessage({
              id: evidence.completePhrase
                ? "socialMedia.clips.evidence.completePhrase"
                : "socialMedia.clips.evidence.transcript",
            })}
          </p>
          <p className="mt-1 line-clamp-3 text-foreground-subtle">{evidence.excerpt}</p>
        </div>
      );
    case "pause":
      return (
        <p>
          {intl.formatMessage(
            { id: "socialMedia.clips.evidence.pauses" },
            {
              before: evidence.beforeSeconds.toFixed(1),
              after: evidence.afterSeconds.toFixed(1),
            },
          )}
        </p>
      );
    case "heatmap":
      return (
        <p>
          {intl.formatMessage(
            { id: "socialMedia.clips.evidence.heatmap" },
            {
              mean: Math.round(evidence.meanIntensity * 100),
              peak: Math.round(evidence.peakIntensity * 100),
            },
          )}
        </p>
      );
    case "audio":
      return (
        <p>
          {intl.formatMessage(
            { id: "socialMedia.clips.evidence.audio" },
            {
              energy: Math.round(evidence.meanEnergy * 100),
              variation: Math.round(evidence.energyVariation * 100),
              rhythm: Math.round(evidence.onsetRate * 100),
            },
          )}
        </p>
      );
    case "rhythm":
      return (
        <p>
          {intl.formatMessage(
            { id: "socialMedia.clips.evidence.rhythm" },
            { bpm: evidence.bpm, confidence: Math.round(evidence.confidence * 100) },
          )}
        </p>
      );
    case "visual-change":
      return (
        <p>
          {intl.formatMessage(
            { id: "socialMedia.clips.evidence.visual" },
            {
              times: evidence.sampleTimesSeconds.map(formatTimestamp).join(", "),
              change: Math.round(evidence.maxChangeScore * 100),
            },
          )}
        </p>
      );
  }
}

export function SocialMediaClipAnalysis({
  accountId,
  asset,
  service,
}: {
  accountId: string;
  asset: SocialMediaAsset;
  service: SocialMediaService;
}) {
  const { intl } = useZCodeIntl();
  const [mode, setMode] = useState<SocialMediaClipCandidateMode>("podcast");
  const [result, setResult] = useState<SocialMediaClipCandidateResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [failed, setFailed] = useState(false);
  const analyzingRef = useRef(false);

  const analyze = useCallback(async () => {
    if (analyzingRef.current) return;
    analyzingRef.current = true;
    setIsAnalyzing(true);
    setFailed(false);
    setResult(null);
    try {
      setResult(await service.suggestClipCandidates({ accountId, mediaId: asset.mediaId, mode }));
    } catch {
      setFailed(true);
    } finally {
      analyzingRef.current = false;
      setIsAnalyzing(false);
    }
  }, [accountId, asset.mediaId, mode, service]);

  const chooseMode = (nextMode: SocialMediaClipCandidateMode) => {
    setMode(nextMode);
    setResult(null);
    setFailed(false);
  };

  return (
    <section
      className="mt-4 border-t border-border pt-3"
      aria-label={intl.formatMessage({ id: "socialMedia.clips.title" })}
    >
      <h3 className="text-ui-sm font-medium">
        {intl.formatMessage({ id: "socialMedia.clips.title" })}
      </h3>
      <p className="mb-3 mt-1 text-ui-xs text-foreground-subtle">
        {intl.formatMessage({ id: "socialMedia.clips.description" })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === "podcast" ? "secondary" : "outline"}
          aria-pressed={mode === "podcast"}
          disabled={isAnalyzing}
          onClick={() => chooseMode("podcast")}
        >
          <Podcast aria-hidden="true" />
          {intl.formatMessage({ id: "socialMedia.clips.podcast" })}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "music" ? "secondary" : "outline"}
          aria-pressed={mode === "music"}
          disabled={isAnalyzing}
          onClick={() => chooseMode("music")}
        >
          <Music2 aria-hidden="true" />
          {intl.formatMessage({ id: "socialMedia.clips.music" })}
        </Button>
        <Button type="button" size="sm" onClick={() => void analyze()} disabled={isAnalyzing}>
          {isAnalyzing ? (
            <RefreshCw className="animate-spin" aria-hidden="true" />
          ) : (
            <WandSparkles aria-hidden="true" />
          )}
          {intl.formatMessage({
            id: isAnalyzing ? "socialMedia.clips.analyzing" : "socialMedia.clips.find",
          })}
        </Button>
      </div>

      {failed ? (
        <p className="mt-3 text-ui-sm text-destructive" role="alert">
          {intl.formatMessage({ id: "socialMedia.clips.failed" })}
        </p>
      ) : null}
      {isAnalyzing ? (
        <p className="mt-3 text-ui-sm text-foreground-subtle" role="status">
          {intl.formatMessage({ id: "socialMedia.clips.analyzingStatus" })}
        </p>
      ) : null}
      {result?.unavailableReason ? (
        <p className="mt-3 text-ui-sm text-foreground-subtle" role="status">
          {intl.formatMessage({
            id: `socialMedia.clips.unavailable.${result.unavailableReason}`,
          })}
        </p>
      ) : null}
      {result && result.candidates.length > 0 ? (
        <ol
          className="mt-3 space-y-2"
          aria-label={intl.formatMessage({ id: "socialMedia.clips.results" })}
        >
          {result.candidates.map((candidate, index) => (
            <li
              key={`${candidate.startSeconds}:${candidate.endSeconds}`}
              className="rounded-md bg-background px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-2 text-ui-sm font-medium">
                <span>
                  {index + 1}. {formatTimestamp(candidate.startSeconds)}–
                  {formatTimestamp(candidate.endSeconds)}
                </span>
                <span className="shrink-0 text-foreground-subtle">
                  {intl.formatMessage(
                    { id: "socialMedia.clips.score" },
                    { score: candidate.score },
                  )}
                </span>
              </div>
              <ul className="mt-1 space-y-1 text-ui-xs text-foreground-subtle">
                {candidate.evidence.map((evidence, evidenceIndex) => (
                  <li key={`${evidence.kind}:${evidenceIndex}`}>
                    <EvidenceText evidence={evidence} intl={intl} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
