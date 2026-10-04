import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { SocialAccount } from "@social-harness/shared";
import type {
  SocialMediaService,
  SocialMediaPreviewService,
  SocialProjectService,
  SocialProjectSummary,
  SocialPublishingService,
} from "@social-harness/services";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SocialProjectEditor } from "./SocialProjectEditor.js";

export function SocialProjectWorkbench({
  account,
  service,
  mediaService,
  mediaPreviewService,
  publishingService,
  instagramConnected,
}: {
  account: SocialAccount;
  service: SocialProjectService;
  mediaService?: SocialMediaService;
  mediaPreviewService?: SocialMediaPreviewService;
  publishingService?: SocialPublishingService;
  instagramConnected: boolean;
}) {
  const { intl } = useZCodeIntl();
  const [projects, setProjects] = useState<SocialProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadGeneration = useRef(0);

  const loadProjects = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const nextProjects = await service.list(account.accountId);
      if (generation !== loadGeneration.current) return;
      setProjects(nextProjects);
      setSelectedProjectId((current) =>
        current && nextProjects.some((project) => project.projectId === current)
          ? current
          : (nextProjects[0]?.projectId ?? null),
      );
    } catch {
      if (generation === loadGeneration.current) setLoadFailed(true);
    } finally {
      if (generation === loadGeneration.current) setIsLoading(false);
    }
  }, [account.accountId, service]);

  useEffect(() => {
    const subscription = service.onChanged((change) => {
      if (change.accountId === account.accountId) void loadProjects();
    });
    void loadProjects();
    return () => {
      loadGeneration.current += 1;
      subscription.dispose();
    };
  }, [account.accountId, loadProjects, service]);

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const displayName = newProjectName.trim();
    if (!displayName || isCreating) return;
    setIsCreating(true);
    setError(null);
    try {
      const created = await service.create({ accountId: account.accountId, displayName });
      setSelectedProjectId(created.project.projectId);
      setNewProjectName("");
      await loadProjects();
      setSelectedProjectId(created.project.projectId);
    } catch {
      setError(intl.formatMessage({ id: "socialProject.status.createFailed" }));
    } finally {
      setIsCreating(false);
    }
  };

  const selectedProject = projects.find((project) => project.projectId === selectedProjectId);

  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 inline-flex items-center rounded-full bg-accent px-2.5 py-1 text-ui-xs font-medium text-foreground">
            {account.displayName}
          </div>
          <h1 className="text-ui-xl font-semibold">
            {intl.formatMessage({ id: "socialProject.title" })}
          </h1>
          <p className="mt-2 max-w-2xl text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "socialProject.description" })}
          </p>
        </div>
      </header>

      {error ? (
        <p
          className="rounded-md border border-destructive/30 bg-card px-3 py-2 text-ui-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="grid min-h-0 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="grid content-start gap-3 rounded-md border border-border bg-card p-3">
          <h2 className="px-1 text-ui-base font-semibold">
            {intl.formatMessage({ id: "socialProject.projects" })}
          </h2>
          {isLoading && projects.length === 0 ? (
            <p className="px-1 py-2 text-ui-sm text-foreground-subtle" role="status">
              {intl.formatMessage({ id: "socialProject.status.loading" })}
            </p>
          ) : loadFailed ? (
            <div className="grid gap-2">
              <p className="text-ui-sm text-destructive" role="alert">
                {intl.formatMessage({ id: "socialProject.status.loadFailed" })}
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadProjects()}>
                {intl.formatMessage({ id: "socialAccounts.retry" })}
              </Button>
            </div>
          ) : projects.length === 0 ? (
            <p className="px-1 py-2 text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "socialProject.projects.empty" })}
            </p>
          ) : (
            <div className="grid gap-1">
              {projects.map((project) => (
                <button
                  key={project.projectId}
                  type="button"
                  aria-current={project.projectId === selectedProjectId ? "page" : undefined}
                  onClick={() => setSelectedProjectId(project.projectId)}
                  className={`grid gap-1 rounded-md px-3 py-2 text-left ${project.projectId === selectedProjectId ? "bg-card-selected" : "hover:bg-surface-hover"}`}
                >
                  <span className="truncate text-ui-sm font-medium">{project.displayName}</span>
                  <span className="text-ui-xs text-foreground-subtle">
                    {intl.formatMessage(
                      { id: "socialProject.projectMeta" },
                      { revision: project.revision, tracks: project.trackCount },
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
          <form className="grid gap-2 border-t border-border pt-3" onSubmit={createProject}>
            <label className="grid gap-1 text-ui-sm">
              {intl.formatMessage({ id: "socialProject.newName" })}
              <Input
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.currentTarget.value)}
                placeholder={intl.formatMessage({ id: "socialProject.newNamePlaceholder" })}
                maxLength={160}
                required
              />
            </label>
            <Button type="submit" size="sm" disabled={isCreating || !newProjectName.trim()}>
              {isCreating
                ? intl.formatMessage({ id: "socialProject.createWorking" })
                : intl.formatMessage({ id: "socialProject.create" })}
            </Button>
          </form>
        </aside>

        <section className="min-w-0">
          {selectedProject ? (
            <SocialProjectEditor
              key={selectedProject.projectId}
              accountId={account.accountId}
              projectId={selectedProject.projectId}
              service={service}
              mediaService={mediaService}
              mediaPreviewService={mediaPreviewService}
              publishingService={publishingService}
              instagramConnected={instagramConnected}
            />
          ) : (
            <div className="rounded-md border border-border bg-card px-5 py-8">
              <h2 className="text-ui-lg font-semibold">
                {intl.formatMessage({ id: "socialProject.emptyTitle" })}
              </h2>
              <p className="mt-2 max-w-xl text-ui-sm text-foreground-subtle">
                {intl.formatMessage({ id: "socialProject.emptyDescription" })}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
