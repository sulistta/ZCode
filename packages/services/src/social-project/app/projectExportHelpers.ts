import type { SocialProject, SocialProjectExportJob } from "@social-harness/shared";
import type { SocialProjectExportChange } from "../contract.js";

export function canonicalizeProjectExportValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeProjectExportValue).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalizeProjectExportValue(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function collectProjectExportMediaIds(project: SocialProject): Set<string> {
  return new Set(
    project.tracks.flatMap((track) =>
      track.clips.flatMap((clip) => (clip.kind === "text" ? [] : [clip.mediaId])),
    ),
  );
}

export function toSocialProjectExportChange(
  job: SocialProjectExportJob,
): SocialProjectExportChange {
  return {
    accountId: job.accountId,
    exportId: job.exportId,
    projectId: job.projectId,
    status: job.status,
    progressPercent: job.progressPercent,
  };
}
