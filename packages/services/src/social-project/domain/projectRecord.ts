import { z } from "zod";
import {
  socialProjectHistoryEntrySchema,
  socialProjectSchema,
  socialProjectSettingsSchema,
  socialProjectTrackSchema,
} from "@social-harness/shared";

export const socialProjectContentSnapshotSchema = z.object({
  displayName: z.string().trim().min(1).max(160),
  settings: socialProjectSettingsSchema,
  tracks: z.array(socialProjectTrackSchema).max(64),
});

export const socialProjectAppliedCommandSchema = z.object({
  commandId: z.string().trim().min(1).max(120),
  fingerprint: z.string().regex(/^[\da-f]{64}$/),
  revision: z.number().int().positive(),
});

export const socialProjectRecordSchema = z.object({
  project: socialProjectSchema,
  history: z.array(socialProjectHistoryEntrySchema),
  undoStack: z.array(socialProjectContentSnapshotSchema),
  redoStack: z.array(socialProjectContentSnapshotSchema),
  appliedCommands: z.array(socialProjectAppliedCommandSchema),
});

export type SocialProjectContentSnapshot = z.infer<typeof socialProjectContentSnapshotSchema>;
export type SocialProjectAppliedCommand = z.infer<typeof socialProjectAppliedCommandSchema>;
export type SocialProjectRecord = z.infer<typeof socialProjectRecordSchema>;

export function snapshotSocialProjectContent(
  project: SocialProjectRecord["project"],
): SocialProjectContentSnapshot {
  return {
    displayName: project.displayName,
    settings: project.settings,
    tracks: project.tracks,
  };
}

export function restoreSocialProjectContent(
  project: SocialProjectRecord["project"],
  snapshot: SocialProjectContentSnapshot,
  revision: number,
  updatedAt: number,
): SocialProjectRecord["project"] {
  return socialProjectSchema.parse({
    ...project,
    ...snapshot,
    revision,
    updatedAt,
  });
}
