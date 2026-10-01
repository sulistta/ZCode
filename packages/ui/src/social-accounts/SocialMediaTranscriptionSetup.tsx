import { Download, RefreshCw, X } from "lucide-react";
import type { SocialMediaService } from "@social-harness/services";
import { Button } from "@/components/ui/button.js";
import { Progress } from "@/components/ui/progress.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { useSocialMediaTranscriptionSetup } from "@/hooks/useSocialMediaTranscriptionSetup.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

function formatBytes(bytes: number, locale: string): string {
  return `${new Intl.NumberFormat(locale).format(bytes)} bytes`;
}

export function SocialMediaTranscriptionSetup({ service }: { service: SocialMediaService }) {
  const { intl, locale } = useZCodeIntl();
  const modelSetup = useSocialMediaTranscriptionSetup(service);
  const setup = modelSetup.setup;
  const selectedModel = setup?.models.find((model) => model.modelId === setup.selectedModelId);
  const downloadingModel = setup?.models.find((model) => model.downloading);
  const downloadProgress = downloadingModel
    ? Math.min(
        100,
        Math.floor((downloadingModel.downloadedBytes / downloadingModel.sizeBytes) * 100),
      )
    : null;

  return (
    <section className="mb-6 rounded-xl border border-card-border bg-card p-4 sm:p-5">
      <h2 className="text-ui-lg font-semibold">
        {intl.formatMessage({ id: "socialMedia.transcription.title" })}
      </h2>
      <p className="mt-1 text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "socialMedia.transcription.description" })}
      </p>

      {setup ? (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label
              className="mb-1 block text-ui-sm font-medium"
              htmlFor="social-transcription-model"
            >
              {intl.formatMessage({ id: "socialMedia.transcription.modelLabel" })}
            </label>
            <Select
              value={setup.selectedModelId}
              disabled={modelSetup.isBusy}
              onValueChange={(value) => {
                const model = setup.models.find((candidate) => candidate.modelId === value);
                if (model) void modelSetup.selectModel(model.modelId);
              }}
            >
              <SelectTrigger id="social-transcription-model" className="w-full max-w-md">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {setup.models.map((model) => (
                  <SelectItem key={model.modelId} value={model.modelId}>
                    {intl.formatMessage(
                      { id: "socialMedia.transcription.modelOption" },
                      { model: model.modelId, bytes: formatBytes(model.sizeBytes, locale) },
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedModel?.installed ? (
            <span className="pb-2 text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "socialMedia.transcription.modelInstalled" })}
            </span>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={
                modelSetup.isBusy ||
                modelSetup.hasActiveDownload ||
                !selectedModel ||
                modelSetup.isLoading
              }
              onClick={() => selectedModel && void modelSetup.downloadModel(selectedModel.modelId)}
            >
              {modelSetup.isBusy ? (
                <RefreshCw className="animate-spin" aria-hidden="true" />
              ) : (
                <Download aria-hidden="true" />
              )}
              {intl.formatMessage({ id: "socialMedia.transcription.installModel" })}
            </Button>
          )}
        </div>
      ) : modelSetup.isLoading ? (
        <p className="mt-3 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "socialMedia.transcription.loading" })}
        </p>
      ) : null}

      {selectedModel?.errorCode ? (
        <p className="mt-3 text-ui-sm text-destructive" role="status">
          {intl.formatMessage({
            id: `socialMedia.transcription.modelError.${selectedModel.errorCode}`,
          })}
        </p>
      ) : null}

      {downloadingModel && downloadProgress !== null ? (
        <div className="mt-4 space-y-2" role="status" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2 text-ui-sm">
            <span>
              {intl.formatMessage(
                { id: "socialMedia.transcription.installing" },
                { model: downloadingModel.modelId },
              )}
            </span>
            <span className="text-foreground-subtle">
              {formatBytes(downloadingModel.downloadedBytes, locale)} /{" "}
              {formatBytes(downloadingModel.sizeBytes, locale)}
            </span>
          </div>
          <Progress
            value={downloadProgress}
            aria-label={intl.formatMessage({ id: "socialMedia.transcription.downloadProgress" })}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={modelSetup.isBusy}
            onClick={() => void modelSetup.cancelDownload(downloadingModel.modelId)}
          >
            <X aria-hidden="true" />
            {intl.formatMessage({ id: "socialMedia.transcription.cancelInstall" })}
          </Button>
        </div>
      ) : null}

      {modelSetup.loadFailed || modelSetup.actionFailed ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-ui-sm text-destructive">
          <span>
            {intl.formatMessage({
              id: modelSetup.loadFailed
                ? "socialMedia.transcription.loadFailed"
                : "socialMedia.transcription.actionFailed",
            })}
          </span>
          {modelSetup.loadFailed ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void modelSetup.refresh()}
            >
              {intl.formatMessage({ id: "socialMedia.retry" })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
