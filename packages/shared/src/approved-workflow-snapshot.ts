import { z } from "zod";
import {
  zcodeSavedWorkflowMetaSchema,
  zcodeSavedWorkflowArgDeclarationSchema,
} from "./saved-workflow-metadata.js";

export const APPROVED_WORKFLOW_SOURCE_MAX_BYTES = 1_048_576;
export const approvedWorkflowScriptSchema = z
  .string()
  .min(1)
  .max(APPROVED_WORKFLOW_SOURCE_MAX_BYTES)
  .refine(
    (script) => new TextEncoder().encode(script).byteLength <= APPROVED_WORKFLOW_SOURCE_MAX_BYTES,
    "Recipe source must not exceed 1 MiB of UTF-8 text",
  );

/** Reviewed source is carried by value; lookup must not replace it after approval. */
export const approvedWorkflowSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().min(1).max(64),
    meta: zcodeSavedWorkflowMetaSchema.extend({
      args: z
        .record(
          z.string(),
          zcodeSavedWorkflowArgDeclarationSchema.extend({
            default: z.json().optional(),
          }),
        )
        .optional(),
    }),
    script: approvedWorkflowScriptSchema,
    args: z.record(z.string(), z.json()),
  })
  .strict()
  .refine(
    (snapshot) =>
      new TextEncoder().encode(JSON.stringify(snapshot)).byteLength <=
      APPROVED_WORKFLOW_SOURCE_MAX_BYTES,
    "The approved recipe snapshot must not exceed 1 MiB",
  );
export type ApprovedWorkflowSnapshot = z.infer<typeof approvedWorkflowSnapshotSchema>;
