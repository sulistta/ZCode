import { useCallback, useEffect, useRef, useState } from "react";
import type {
  SocialMediaAsset,
  SocialMediaService,
  SocialMediaPreviewService,
  SocialProjectReadModel,
  SocialProjectService,
  SocialPublishingService,
} from "@social-harness/services";
import type {
  SocialProjectCommandRequest,
  SocialProjectSettings,
  SocialProjectTrack,
} from "@social-harness/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SocialProjectAddClipForm } from "./SocialProjectAddClipForm.js";
import { SocialProjectClipActions } from "./SocialProjectClipActions.js";
import { SocialProjectEditorHeader } from "./SocialProjectEditorHeader.js";
import { SocialProjectExportPanel } from "./SocialProjectExportPanel.js";
import { SocialProjectHistory } from "./SocialProjectHistory.js";
import { SocialProjectSettingsForm } from "./SocialProjectSettingsForm.js";
import { SocialProjectTimeline } from "./SocialProjectTimeline.js";
import { SocialProjectTrackActions } from "./SocialProjectTrackActions.js";
import { getSocialProjectEndMs } from "./socialProjectPlayback.js";
import { SocialProjectPreview } from "./SocialProjectPreview.js";

type Operation = SocialProjectCommandRequest["operation"];

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

export function SocialProjectEditor({
  accountId,
  projectId,
  service,
  mediaService,
  mediaPreviewService,
  publishingService,
  instagramConnected,
}: {
  accountId: string;
  projectId: string;
  service: SocialProjectService;
  mediaService?: SocialMediaService;
  mediaPreviewService?: SocialMediaPreviewService;
  publishingService?: SocialPublishingService;
  instagramConnected: boolean;
}) {
  const { intl } = useZCodeIntl();
  const [readModel, setReadModel] = useState<SocialProjectReadModel | null>(null);
  const [assets, setAssets] = useState<SocialMediaAsset[]>([]);
  const [projectName, setProjectName] = useState("");
  const [trackName, setTrackName] = useState("");
  const [trackType, setTrackType] = useState<SocialProjectTrack["type"]>("video");
  const [playheadMs, setPlayheadMs] = useState(0);
  const [seekRevision, setSeekRevision] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const hasLoaded = useRef(false);
  const loadGeneration = useRef(0);

  const loadProject = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setIsLoading(!hasLoaded.current);
    setLoadFailed(false);
    try {
      const result = await service.get(accountId, projectId);
      if (generation !== loadGeneration.current) return;
      if (!result) throw new Error("Social project no longer exists");
      setReadModel(result);
      setProjectName(result.project.displayName);
      hasLoaded.current = true;
    } catch {
      if (generation === loadGeneration.current) setLoadFailed(true);
    } finally {
      if (generation === loadGeneration.current) setIsLoading(false);
    }
  }, [accountId, projectId, service]);

  const seekTo = useCallback((nextPlayheadMs: number) => {
    setPlayheadMs(Math.max(0, nextPlayheadMs));
    setSeekRevision((revision) => revision + 1);
  }, []);

  useEffect(() => {
    if (!readModel) return;
    const endMs = getSocialProjectEndMs(readModel.project);
    setPlayheadMs((current) => Math.min(current, endMs));
    setSeekRevision((revision) => revision + 1);
  }, [readModel]);

  useEffect(() => {
    const subscription = service.onChanged((change) => {
      if (change.accountId === accountId && change.projectId === projectId) {
        void loadProject();
      }
    });
    void loadProject();
    return () => {
      loadGeneration.current += 1;
      subscription.dispose();
    };
  }, [accountId, loadProject, projectId, service]);

  useEffect(() => {
    if (!mediaService) {
      setAssets([]);
      return;
    }
    let active = true;
    void mediaService.list(accountId).then(
      (nextAssets) => {
        if (active) setAssets(nextAssets);
      },
      () => {
        if (active) setAssets([]);
      },
    );
    return () => {
      active = false;
    };
  }, [accountId, mediaService]);

  const execute = useCallback(
    async (operation: Operation, expectedRevision?: number): Promise<void> => {
      if (!readModel || isWorking) return;
      if (
        readModel.project.editControlOwner !== "user" &&
        operation.type !== "take-control" &&
        operation.type !== "return-to-agent"
      ) {
        setError(intl.formatMessage({ id: "socialProject.control.takeFirst" }));
        return;
      }
      setIsWorking(true);
      setError(null);
      setNotice(null);
      try {
        const result = await service.executeCommand({
          accountId,
          projectId,
          commandId: crypto.randomUUID(),
          expectedRevision: expectedRevision ?? readModel.project.revision,
          author: "user",
          operation,
        });
        setReadModel(result);
        setProjectName(result.project.displayName);
        setNotice(intl.formatMessage({ id: "socialProject.status.saved" }));
      } catch (caught) {
        if (
          errorName(caught) === "SocialProjectRevisionConflictError" ||
          errorName(caught) === "SocialProjectNotFoundError"
        ) {
          setError(intl.formatMessage({ id: "socialProject.status.stale" }));
          void loadProject();
        } else {
          setError(intl.formatMessage({ id: "socialProject.status.commandFailed" }));
        }
      } finally {
        setIsWorking(false);
      }
    },
    [accountId, intl, isWorking, loadProject, projectId, readModel, service],
  );

  const addTrack = async () => {
    if (!readModel) return;
    const name = trackName.trim();
    if (!name) return;
    await execute({
      type: "add-track",
      trackId: crypto.randomUUID(),
      name,
      trackType,
      position: readModel.project.tracks.length,
    });
    setTrackName("");
  };

  const rename = async () => {
    const name = projectName.trim();
    if (!name) return;
    await execute({ type: "rename-project", displayName: name });
  };

  if (isLoading && !readModel) {
    return (
      <div
        className="rounded-md border border-border bg-card px-4 py-6 text-ui-sm text-foreground-subtle"
        role="status"
      >
        {intl.formatMessage({ id: "socialProject.status.loading" })}
      </div>
    );
  }
  if (loadFailed && !readModel) {
    return (
      <div
        className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-card p-4"
        role="alert"
      >
        <span className="text-ui-sm text-destructive">
          {intl.formatMessage({ id: "socialProject.status.loadFailed" })}
        </span>
        <Button type="button" variant="outline" size="sm" onClick={() => void loadProject()}>
          {intl.formatMessage({ id: "socialAccounts.retry" })}
        </Button>
      </div>
    );
  }
  if (!readModel) return null;

  const { project, history } = readModel;
  const canEdit = project.editControlOwner === "user";

  return (
    <div
      data-testid="social-project-editor"
      data-project-revision={project.revision}
      className="grid gap-4"
    >
      <SocialProjectEditorHeader
        readModel={readModel}
        projectName={projectName}
        onProjectNameChange={setProjectName}
        canEdit={canEdit}
        isWorking={isWorking}
        error={error}
        notice={notice}
        onExecute={execute}
        onSaveName={() => void rename()}
      />

      <SocialProjectExportPanel
        accountId={accountId}
        project={project}
        service={service}
        publishingService={publishingService}
        instagramConnected={instagramConnected}
      />

      <SocialProjectPreview
        accountId={accountId}
        project={project}
        assets={assets}
        mediaPreviewService={mediaPreviewService}
        mediaService={mediaService}
        playheadMs={playheadMs}
        seekRevision={seekRevision}
        onSeek={seekTo}
        onTimeChange={setPlayheadMs}
      />

      <section className="grid gap-3">
        <div>
          <h2 className="text-ui-base font-semibold">
            {intl.formatMessage({ id: "socialProject.timeline.title" })}
          </h2>
          <p className="mt-1 text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "socialProject.timeline.description" })}
          </p>
        </div>
        <SocialProjectTimeline
          project={project}
          assets={assets}
          playheadMs={playheadMs}
          canEdit={canEdit && !isWorking}
          onSeek={seekTo}
          onMoveClip={(clipId, targetTrackId, timelineStartMs, expectedRevision) =>
            execute({ type: "move-clip", clipId, targetTrackId, timelineStartMs }, expectedRevision)
          }
          onTrimClip={(trackId, clip, expectedRevision) =>
            execute({ type: "put-clip", trackId, clip }, expectedRevision)
          }
        />
        <div className="grid gap-2">
          {project.tracks.map((track, position) => (
            <SocialProjectTrackActions
              key={track.trackId}
              tracks={project.tracks}
              track={track}
              position={position}
              disabled={!canEdit || isWorking}
              onMove={(trackId, nextPosition) =>
                execute({ type: "move-track", trackId, position: nextPosition })
              }
              onRemove={(trackId) => execute({ type: "remove-track", trackId })}
            />
          ))}
        </div>
        <div className="grid gap-2">
          {project.tracks.flatMap((track) =>
            track.clips.map((clip) => (
              <SocialProjectClipActions
                key={clip.clipId}
                trackId={track.trackId}
                clip={clip}
                tracks={project.tracks}
                disabled={!canEdit || isWorking}
                onUpdate={(trackId, updatedClip) =>
                  execute({ type: "put-clip", trackId, clip: updatedClip })
                }
                onMove={(clipId, targetTrackId, timelineStartMs) =>
                  execute({ type: "move-clip", clipId, targetTrackId, timelineStartMs })
                }
                onSplit={(clipId, splitAtMs, newClipId) =>
                  execute({ type: "split-clip", clipId, splitAtMs, newClipId })
                }
                onRemove={(clipId) => execute({ type: "remove-clip", clipId })}
              />
            )),
          )}
        </div>
      </section>

      <SocialProjectSettingsForm
        settings={project.settings}
        canEdit={canEdit}
        isWorking={isWorking}
        onSave={(settings: SocialProjectSettings) => execute({ type: "update-settings", settings })}
      />

      <section className="grid gap-3 rounded-md border border-border bg-card p-4">
        <div>
          <h2 className="text-ui-base font-semibold">
            {intl.formatMessage({ id: "socialProject.track.addTitle" })}
          </h2>
          <p className="mt-1 text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "socialProject.track.addDescription" })}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-44 flex-1 gap-1 text-ui-sm">
            {intl.formatMessage({ id: "socialProject.track.name" })}
            <Input
              value={trackName}
              onChange={(event) => setTrackName(event.currentTarget.value)}
              disabled={!canEdit || isWorking}
              maxLength={80}
            />
          </label>
          <label className="grid gap-1 text-ui-sm">
            {intl.formatMessage({ id: "socialProject.track.type" })}
            <select
              className="h-8 rounded-md border border-input-border bg-input px-2 text-ui-base"
              value={trackType}
              onChange={(event) =>
                setTrackType(event.currentTarget.value as SocialProjectTrack["type"])
              }
              disabled={!canEdit || isWorking}
            >
              <option value="video">
                {intl.formatMessage({ id: "socialProject.track.video" })}
              </option>
              <option value="audio">
                {intl.formatMessage({ id: "socialProject.track.audio" })}
              </option>
              <option value="text">{intl.formatMessage({ id: "socialProject.track.text" })}</option>
            </select>
          </label>
          <Button
            type="button"
            size="sm"
            disabled={!canEdit || isWorking || !trackName.trim() || project.tracks.length >= 64}
            onClick={() => void addTrack()}
          >
            {intl.formatMessage({ id: "socialProject.track.add" })}
          </Button>
        </div>
      </section>

      <SocialProjectAddClipForm
        project={project}
        assets={assets}
        canEdit={canEdit && !isWorking}
        onAdd={(trackId, clip) => execute({ type: "put-clip", trackId, clip })}
      />

      <SocialProjectHistory history={history} />
    </div>
  );
}
