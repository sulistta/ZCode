import { z } from "zod";
import type { JsonSchema } from "../model/index.js";

export const SOCIAL_PROJECT_LIST_TOOL_NAME = "SocialProjectList" as const;
export const SOCIAL_PROJECT_READ_TOOL_NAME = "SocialProjectRead" as const;
export const SOCIAL_PROJECT_COMMAND_TOOL_NAME = "SocialProjectCommand" as const;

const idSchema = z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

export const SocialProjectListInputSchema = z.object({}).strict();
export const SocialProjectGetInputSchema = z.object({ projectId: idSchema }).strict();
export const SocialProjectCommandInputSchema = z
  .object({
    projectId: idSchema.describe("Project ID returned by SocialProjectList or SocialProjectRead."),
    expectedRevision: z.number().int().nonnegative().describe("Revision from the latest project read."),
    operation: z.record(z.unknown()).describe(
      "One edit operation. Read the project first, then submit one command at its current revision. Do not retry after an uncertain result until you read the project again.",
    ),
  })
  .strict();

export type SocialProjectCommandToolInput = z.infer<typeof SocialProjectCommandInputSchema>;

const idJsonSchema: JsonSchema = {
  type: "string",
  minLength: 1,
  maxLength: 120,
  pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$",
};
const strictObject = (
  properties: Record<string, JsonSchema>,
  required: string[],
): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });

const scalarClipProperties: Record<string, JsonSchema> = {
  clipId: idJsonSchema,
  mediaId: idJsonSchema,
  timelineStartMs: { type: "integer", minimum: 0 },
  sourceStartMs: { type: "integer", minimum: 0 },
  sourceEndMs: { type: "integer", minimum: 1 },
  playbackRate: { type: "number", minimum: 0.25, maximum: 4 },
  volume: { type: "number", minimum: 0, maximum: 4 },
  keyframes: {
    type: "array",
    maxItems: 500,
    items: {
      type: "object",
      properties: {
        keyframeId: idJsonSchema,
        timeMs: { type: "integer", minimum: 0 },
        property: { type: "string", enum: ["x", "y", "scaleX", "scaleY", "rotation", "opacity", "volume"] },
        value: { type: "number" },
        easing: { type: "string", enum: ["linear", "ease-in", "ease-out", "ease-in-out"] },
      },
      required: ["keyframeId", "timeMs", "property", "value", "easing"],
      additionalProperties: false,
    },
  },
};

const mediaClipJsonSchema: JsonSchema = {
  oneOf: ["video", "image", "audio"].map((kind) => ({
    ...strictObject(
      {
        ...scalarClipProperties,
        kind: { const: kind },
        transform: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            scaleX: { type: "number", minimum: 0.01, maximum: 100 },
            scaleY: { type: "number", minimum: 0.01, maximum: 100 },
            rotation: { type: "number" },
            opacity: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["x", "y", "scaleX", "scaleY", "rotation", "opacity"],
          additionalProperties: false,
        },
        transitionIn: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["fade", "dissolve"] },
            durationMs: { type: "integer", minimum: 1, maximum: 10_000 },
          },
          required: ["kind", "durationMs"],
          additionalProperties: false,
        },
        transitionOut: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["fade", "dissolve"] },
            durationMs: { type: "integer", minimum: 1, maximum: 10_000 },
          },
          required: ["kind", "durationMs"],
          additionalProperties: false,
        },
      },
      ["kind", "clipId", "mediaId", "timelineStartMs", "sourceStartMs", "sourceEndMs", "playbackRate", "volume", "keyframes"],
    ),
  })),
};

const textClipTransformJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    x: { type: "number", minimum: -100_000, maximum: 100_000 },
    y: { type: "number", minimum: -100_000, maximum: 100_000 },
    scaleX: { type: "number", minimum: 0.01, maximum: 100 },
    scaleY: { type: "number", minimum: 0.01, maximum: 100 },
    rotation: { type: "number", minimum: -3_600, maximum: 3_600 },
    opacity: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["x", "y", "scaleX", "scaleY", "rotation", "opacity"],
  additionalProperties: false,
};

const textClipTransitionJsonSchema: JsonSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["fade", "dissolve"] },
    durationMs: { type: "integer", minimum: 1, maximum: 10_000 },
  },
  required: ["kind", "durationMs"],
  additionalProperties: false,
};

const textClipJsonSchema: JsonSchema = strictObject(
  {
    clipId: idJsonSchema,
    kind: { const: "text" },
    timelineStartMs: { type: "integer", minimum: 0 },
    durationMs: { type: "integer", minimum: 100, maximum: 600_000 },
    text: { type: "string", minLength: 1, maxLength: 10_000 },
    style: {
      type: "object",
      properties: {
        fontFamily: { type: "string", minLength: 1, maxLength: 120 },
        fontSize: { type: "number", minimum: 8, maximum: 400 },
        color: { type: "string", pattern: "^#[\\da-f]{6}$" },
        alignment: { type: "string", enum: ["left", "center", "right"] },
      },
      required: ["fontFamily", "fontSize", "color", "alignment"],
      additionalProperties: false,
    },
    transform: textClipTransformJsonSchema,
    transitionIn: textClipTransitionJsonSchema,
    transitionOut: textClipTransitionJsonSchema,
    keyframes: scalarClipProperties.keyframes!,
  },
  ["clipId", "kind", "timelineStartMs", "durationMs", "text", "style", "keyframes"],
);

const socialProjectOperationJsonSchema: JsonSchema = {
  oneOf: [
    strictObject(
      { type: { const: "rename-project" }, displayName: { type: "string", minLength: 1, maxLength: 160 } },
      ["type", "displayName"],
    ),
    strictObject(
      {
        type: { const: "add-track" },
        trackId: idJsonSchema,
        name: { type: "string", minLength: 1, maxLength: 80 },
        trackType: { type: "string", enum: ["video", "audio", "text"] },
        position: { type: "integer", minimum: 0 },
      },
      ["type", "trackId", "name", "trackType", "position"],
    ),
    strictObject({ type: { const: "remove-track" }, trackId: idJsonSchema }, ["type", "trackId"]),
    strictObject(
      { type: { const: "move-track" }, trackId: idJsonSchema, position: { type: "integer", minimum: 0 } },
      ["type", "trackId", "position"],
    ),
    strictObject(
      { type: { const: "put-clip" }, trackId: idJsonSchema, clip: { oneOf: [mediaClipJsonSchema, textClipJsonSchema] } },
      ["type", "trackId", "clip"],
    ),
    strictObject({ type: { const: "remove-clip" }, clipId: idJsonSchema }, ["type", "clipId"]),
    strictObject(
      {
        type: { const: "move-clip" },
        clipId: idJsonSchema,
        targetTrackId: idJsonSchema,
        timelineStartMs: { type: "integer", minimum: 0 },
      },
      ["type", "clipId", "targetTrackId", "timelineStartMs"],
    ),
    strictObject(
      {
        type: { const: "split-clip" },
        clipId: idJsonSchema,
        splitAtMs: { type: "integer", minimum: 0 },
        newClipId: idJsonSchema,
      },
      ["type", "clipId", "splitAtMs", "newClipId"],
    ),
    strictObject(
      {
        type: { const: "update-settings" },
        settings: {
          type: "object",
          properties: {
            width: { type: "integer", minimum: 16, maximum: 8192 },
            height: { type: "integer", minimum: 16, maximum: 8192 },
            frameRate: {
              type: "object",
              properties: {
                numerator: { type: "integer", minimum: 1, maximum: 240 },
                denominator: { type: "integer", minimum: 1, maximum: 1000 },
              },
              required: ["numerator", "denominator"],
              additionalProperties: false,
            },
            backgroundColor: { type: "string", pattern: "^#[\\da-f]{6}$" },
          },
          required: ["width", "height", "frameRate", "backgroundColor"],
          additionalProperties: false,
        },
      },
      ["type", "settings"],
    ),
  ],
};

export const SocialProjectListInputJsonSchema: JsonSchema = strictObject({}, []);
export const SocialProjectGetInputJsonSchema: JsonSchema = strictObject(
  { projectId: idJsonSchema },
  ["projectId"],
);
export const SocialProjectCommandInputJsonSchema: JsonSchema = strictObject(
  {
    projectId: {
      ...idJsonSchema,
      description: "Project ID returned by SocialProjectList or SocialProjectRead.",
    },
    expectedRevision: { type: "integer", minimum: 0, description: "Revision from the latest project read." },
    operation: {
      ...socialProjectOperationJsonSchema,
      description: "Submit one edit at the latest revision. If the result is uncertain, read before retrying.",
    },
  },
  ["projectId", "expectedRevision", "operation"],
);
export const SocialProjectOutputJsonSchema: JsonSchema = { type: "object" };
