import type {
  InstagramPublication,
  SocialAutomationPolicy,
  SocialProjectExportJob,
} from "@social-harness/shared";
import type { InstagramPublicationWorkflowOptions } from "./instagramPublicationWorkflowOptions.js";
import { SocialPublishingError } from "./socialPublishingError.js";

const AUTOMATION_CADENCE_MS = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
} as const;

const AUTOMATION_RESERVATION_STATUSES = new Set<InstagramPublication["status"]>([
  "approval-required",
  "preparing-media",
  "creating-container",
  "processing-container",
  "publishing",
  "published",
  "reconciliation-required",
]);

export async function requireAllowedAutomationSources(
  options: Pick<InstagramPublicationWorkflowOptions, "projectService" | "listMedia">,
  accountId: string,
  job: SocialProjectExportJob,
  policy: Extract<SocialAutomationPolicy, { autonomyEnabled: true }>,
): Promise<void> {
  const readModel = await options.projectService.get(accountId, job.projectId);
  if (!readModel || readModel.project.revision !== job.projectRevision) {
    throw new SocialPublishingError(
      "publication-project-changed",
      "Project changed after this export was created.",
    );
  }
  const mediaIds = [
    ...new Set(
      readModel.project.tracks.flatMap((track) =>
        track.clips.flatMap((clip) => (clip.kind === "text" ? [] : [clip.mediaId])),
      ),
    ),
  ];
  if (mediaIds.length === 0) {
    throw new SocialPublishingError(
      "publication-policy-denied",
      "Automated publishing requires a project with account-owned source media.",
    );
  }
  const assets = await options.listMedia(accountId);
  const assetsById = new Map(
    assets.filter((asset) => asset.accountId === accountId).map((asset) => [asset.mediaId, asset]),
  );
  for (const mediaId of mediaIds) {
    const asset = assetsById.get(mediaId);
    const source =
      asset?.sourceKind === "local-file"
        ? "local-file"
        : asset?.sourceKind === "youtube"
          ? asset.sourceOrigin
          : undefined;
    if (!source || !policy.allowedSources.includes(source)) {
      throw new SocialPublishingError(
        "publication-policy-denied",
        "Project source media is outside the saved automation policy.",
      );
    }
  }
}

export function assertAutomationPublicationLimit(
  publications: InstagramPublication[],
  policy: Extract<SocialAutomationPolicy, { autonomyEnabled: true }>,
  now: number,
): void {
  const currentTime = Math.max(0, Math.trunc(now));
  const automated = publications.filter(
    (publication) =>
      publication.trigger === "automation" &&
      AUTOMATION_RESERVATION_STATUSES.has(publication.status),
  );
  if (automated.some((publication) => publication.status === "reconciliation-required")) {
    throw new SocialPublishingError(
      "publication-policy-denied",
      "Resolve the uncertain Instagram publication before starting another automated post.",
    );
  }
  const withinDay = automated.filter((publication) => {
    const occurredAt =
      publication.status === "published" ? publication.updatedAt : publication.createdAt;
    return occurredAt > currentTime - 24 * 60 * 60 * 1000;
  });
  if (withinDay.length >= policy.maxPublicationsPerDay) {
    throw new SocialPublishingError(
      "publication-policy-denied",
      "The account's daily automated publication limit has been reached.",
    );
  }
  const lastAutomatedPublicationAt = automated.reduce(
    (latest, publication) =>
      Math.max(
        latest,
        publication.status === "published" ? publication.updatedAt : publication.createdAt,
      ),
    -1,
  );
  if (
    lastAutomatedPublicationAt >= 0 &&
    currentTime - lastAutomatedPublicationAt < AUTOMATION_CADENCE_MS[policy.cadence]
  ) {
    throw new SocialPublishingError(
      "publication-policy-denied",
      "The account's automation cadence does not allow another publication yet.",
    );
  }
}
