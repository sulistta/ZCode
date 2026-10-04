import { z } from "zod";
import type { JsonSchema } from "../model/index.js";

export const SOCIAL_AGENT_CONTEXT_TOOL_NAME = "SocialAgentGetContext" as const;
export const SOCIAL_MEDIA_LIST_TOOL_NAME = "SocialMediaList" as const;
export const SOCIAL_YOUTUBE_SEARCH_TOOL_NAME = "SocialYouTubeSearch" as const;
export const SOCIAL_CLIP_CANDIDATES_TOOL_NAME = "SocialClipCandidates" as const;
export const SOCIAL_PUBLICATION_REQUEST_TOOL_NAME = "SocialPublicationRequest" as const;

const mediaIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

export const SocialAgentContextInputSchema = z.object({}).strict();
export const SocialMediaListInputSchema = z.object({}).strict();
export const SocialYouTubeSearchInputSchema = z
  .object({ query: z.string().trim().min(1).max(240) })
  .strict();
export const SocialClipCandidatesInputSchema = z
  .object({
    mediaId: mediaIdSchema,
    mode: z.enum(["podcast", "music"]),
  })
  .strict();
export const SocialPublicationRequestInputSchema = z
  .object({
    exportId: mediaIdSchema,
    caption: z.string().trim().min(1).max(2_200),
  })
  .strict();

export const SocialAgentContextInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};
export const SocialMediaListInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};
export const SocialYouTubeSearchInputJsonSchema: JsonSchema = {
  type: "object",
  properties: { query: { type: "string", minLength: 1, maxLength: 240 } },
  required: ["query"],
  additionalProperties: false,
};
export const SocialClipCandidatesInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    mediaId: {
      type: "string",
      minLength: 1,
      maxLength: 120,
      pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$",
    },
    mode: { type: "string", enum: ["podcast", "music"] },
  },
  required: ["mediaId", "mode"],
  additionalProperties: false,
};
export const SocialPublicationRequestInputJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    exportId: {
      type: "string",
      minLength: 1,
      maxLength: 120,
      pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$",
    },
    caption: { type: "string", minLength: 1, maxLength: 2_200 },
  },
  required: ["exportId", "caption"],
  additionalProperties: false,
};
export const SocialAgentReadOutputJsonSchema: JsonSchema = { type: "object" };
