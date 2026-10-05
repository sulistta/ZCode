import { z } from "zod";

export const zcodeSavedWorkflowArgTypeSchema = z.enum(["string", "number", "boolean", "json"]);
export type ZCodeSavedWorkflowArgType = z.infer<typeof zcodeSavedWorkflowArgTypeSchema>;
export const zcodeSavedWorkflowArgDeclarationSchema = z
  .object({
    type: zcodeSavedWorkflowArgTypeSchema,
    description: z.string().optional(),
    required: z.boolean().optional(),
    default: z.unknown().optional(),
  })
  .strict();
export type ZCodeSavedWorkflowArgDeclaration = z.infer<
  typeof zcodeSavedWorkflowArgDeclarationSchema
>;
export const zcodeSavedWorkflowArgsDeclarationSchema = z.record(
  z.string(),
  zcodeSavedWorkflowArgDeclarationSchema,
);
export type ZCodeSavedWorkflowArgsDeclaration = z.infer<
  typeof zcodeSavedWorkflowArgsDeclarationSchema
>;
export const zcodeSavedWorkflowMetaSchema = z
  .object({
    description: z.string().trim().min(1),
    whenToUse: z.string().trim().min(1).optional(),
    args: zcodeSavedWorkflowArgsDeclarationSchema.optional(),
  })
  .strict();
export type ZCodeSavedWorkflowMeta = z.infer<typeof zcodeSavedWorkflowMetaSchema>;
