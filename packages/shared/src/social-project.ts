import { z } from "zod";

export const SOCIAL_PROJECT_ID_MAX_LENGTH = 120;
export const SOCIAL_PROJECT_NAME_MAX_LENGTH = 160;
export const SOCIAL_PROJECT_TRACK_LIMIT = 64;
export const SOCIAL_PROJECT_CLIP_LIMIT = 1000;

export const socialProjectIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(SOCIAL_PROJECT_ID_MAX_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

const projectTextSchema = z.string().trim().min(1).max(SOCIAL_PROJECT_NAME_MAX_LENGTH);
const finiteNumberSchema = z.number().finite();

export const SOCIAL_PROJECT_KEYFRAME_PROPERTIES = [
  "x",
  "y",
  "scaleX",
  "scaleY",
  "rotation",
  "opacity",
  "volume",
] as const;

export const SOCIAL_PROJECT_KEYFRAME_VALUE_RANGES = {
  x: { min: -100_000, max: 100_000 },
  y: { min: -100_000, max: 100_000 },
  scaleX: { min: 0.01, max: 100 },
  scaleY: { min: 0.01, max: 100 },
  rotation: { min: -3600, max: 3600 },
  opacity: { min: 0, max: 1 },
  volume: { min: 0, max: 4 },
} as const;

export const SOCIAL_PROJECT_DEFAULT_TRANSFORM = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
} as const;

function boundedFiniteNumber(range: { min: number; max: number }) {
  return finiteNumberSchema.min(range.min).max(range.max);
}

export const socialProjectSettingsSchema = z.object({
  width: z.number().int().min(16).max(8192),
  height: z.number().int().min(16).max(8192),
  frameRate: z.object({
    numerator: z.number().int().min(1).max(240),
    denominator: z.number().int().min(1).max(1000),
  }),
  backgroundColor: z.string().regex(/^#[\da-f]{6}$/i),
});

export const socialProjectTransformSchema = z.object({
  x: boundedFiniteNumber(SOCIAL_PROJECT_KEYFRAME_VALUE_RANGES.x),
  y: boundedFiniteNumber(SOCIAL_PROJECT_KEYFRAME_VALUE_RANGES.y),
  scaleX: boundedFiniteNumber(SOCIAL_PROJECT_KEYFRAME_VALUE_RANGES.scaleX),
  scaleY: boundedFiniteNumber(SOCIAL_PROJECT_KEYFRAME_VALUE_RANGES.scaleY),
  rotation: boundedFiniteNumber(SOCIAL_PROJECT_KEYFRAME_VALUE_RANGES.rotation),
  opacity: boundedFiniteNumber(SOCIAL_PROJECT_KEYFRAME_VALUE_RANGES.opacity),
});

export const socialProjectColorAdjustmentsSchema = z.object({
  brightness: finiteNumberSchema.min(-1).max(1),
  contrast: finiteNumberSchema.min(0).max(2),
  saturation: finiteNumberSchema.min(0).max(2),
  hue: finiteNumberSchema.min(-180).max(180),
});

export const SOCIAL_PROJECT_DEFAULT_COLOR_ADJUSTMENTS = {
  brightness: 0,
  contrast: 1,
  saturation: 1,
  hue: 0,
} as const;

export const socialProjectKeyframeSchema = z
  .object({
    keyframeId: socialProjectIdSchema,
    timeMs: z.number().int().nonnegative(),
    property: z.enum(SOCIAL_PROJECT_KEYFRAME_PROPERTIES),
    value: finiteNumberSchema,
    easing: z.enum(["linear", "ease-in", "ease-out", "ease-in-out"]),
  })
  .superRefine((keyframe, context) => {
    const range = SOCIAL_PROJECT_KEYFRAME_VALUE_RANGES[keyframe.property];
    if (keyframe.value < range.min || keyframe.value > range.max) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: `Keyframe value for ${keyframe.property} must be between ${range.min} and ${range.max}`,
      });
    }
  });

export const socialProjectTransitionSchema = z.object({
  kind: z.enum(["fade", "dissolve"]),
  durationMs: z.number().int().min(1).max(10_000),
});

const clipTransitionFields = {
  transitionIn: socialProjectTransitionSchema.optional(),
  transitionOut: socialProjectTransitionSchema.optional(),
};

const clipPresentationSchema = {
  ...clipTransitionFields,
  transform: socialProjectTransformSchema.optional(),
  keyframes: z.array(socialProjectKeyframeSchema).max(500),
};

const visualClipPresentationSchema = {
  ...clipPresentationSchema,
  colorAdjustments: socialProjectColorAdjustmentsSchema.optional(),
};

const mediaClipSchema = z.object({
  clipId: socialProjectIdSchema,
  mediaId: socialProjectIdSchema,
  timelineStartMs: z.number().int().nonnegative(),
  sourceStartMs: z.number().int().nonnegative(),
  sourceEndMs: z.number().int().positive(),
  playbackRate: finiteNumberSchema.min(0.25).max(4),
  volume: finiteNumberSchema.min(0).max(4),
});

export const socialProjectVideoClipSchema = mediaClipSchema.extend({
  kind: z.literal("video"),
  ...visualClipPresentationSchema,
});
export const socialProjectImageClipSchema = mediaClipSchema
  .extend({
    kind: z.literal("image"),
    ...visualClipPresentationSchema,
  })
  .superRefine((clip, context) => {
    clip.keyframes.forEach((keyframe, index) => {
      if (keyframe.property === "volume") {
        context.addIssue({
          code: "custom",
          path: ["keyframes", index, "property"],
          message: "Image clips do not support volume keyframes",
        });
      }
    });
  });
export const socialProjectAudioClipSchema = mediaClipSchema
  .extend({
    kind: z.literal("audio"),
    ...clipTransitionFields,
    keyframes: z.array(socialProjectKeyframeSchema).max(500),
  })
  .strict()
  .superRefine((clip, context) => {
    clip.keyframes.forEach((keyframe, index) => {
      if (keyframe.property !== "volume") {
        context.addIssue({
          code: "custom",
          path: ["keyframes", index, "property"],
          message: "Audio clips only support volume keyframes",
        });
      }
    });
  });

export const socialProjectTextClipSchema = z
  .object({
    clipId: socialProjectIdSchema,
    kind: z.literal("text"),
    timelineStartMs: z.number().int().nonnegative(),
    durationMs: z.number().int().min(100).max(600_000),
    text: z.string().trim().min(1).max(10_000),
    style: z.object({
      fontFamily: z.string().trim().min(1).max(120),
      fontSize: finiteNumberSchema.min(8).max(400),
      color: z.string().regex(/^#[\da-f]{6}$/i),
      alignment: z.enum(["left", "center", "right"]),
    }),
    ...clipPresentationSchema,
  })
  .strict()
  .superRefine((clip, context) => {
    clip.keyframes.forEach((keyframe, index) => {
      if (keyframe.property === "volume") {
        context.addIssue({
          code: "custom",
          path: ["keyframes", index, "property"],
          message: "Text clips do not support volume keyframes",
        });
      }
    });
  });

export const socialProjectClipSchema = z.discriminatedUnion("kind", [
  socialProjectVideoClipSchema,
  socialProjectImageClipSchema,
  socialProjectAudioClipSchema,
  socialProjectTextClipSchema,
]);

export const socialProjectTrackTypeSchema = z.enum(["video", "audio", "text"]);

export const socialProjectTrackSchema = z.object({
  trackId: socialProjectIdSchema,
  name: z.string().trim().min(1).max(80),
  type: socialProjectTrackTypeSchema,
  muted: z.boolean(),
  hidden: z.boolean(),
  clips: z.array(socialProjectClipSchema).max(SOCIAL_PROJECT_CLIP_LIMIT),
});

export const socialProjectSchema = z.object({
  projectId: socialProjectIdSchema,
  accountId: z.string().trim().min(1).max(120),
  displayName: projectTextSchema,
  revision: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  editControlOwner: z.enum(["agent", "user"]),
  settings: socialProjectSettingsSchema,
  tracks: z.array(socialProjectTrackSchema).max(SOCIAL_PROJECT_TRACK_LIMIT),
});

export const socialProjectHistoryEntrySchema = z.object({
  revision: z.number().int().positive(),
  commandId: socialProjectIdSchema,
  author: z.enum(["user", "agent"]),
  operation: z.string().trim().min(1).max(80),
  updatedAt: z.number().int().nonnegative(),
});

export const socialProjectSummarySchema = z.object({
  projectId: socialProjectIdSchema,
  accountId: z.string().trim().min(1).max(120),
  displayName: projectTextSchema,
  revision: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  trackCount: z.number().int().nonnegative().max(SOCIAL_PROJECT_TRACK_LIMIT),
});

export const socialProjectOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("rename-project"),
    displayName: projectTextSchema,
  }),
  z.object({
    type: z.literal("add-track"),
    trackId: socialProjectIdSchema,
    name: z.string().trim().min(1).max(80),
    trackType: socialProjectTrackTypeSchema,
    position: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("remove-track"), trackId: socialProjectIdSchema }),
  z.object({
    type: z.literal("move-track"),
    trackId: socialProjectIdSchema,
    position: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("put-clip"),
    trackId: socialProjectIdSchema,
    clip: socialProjectClipSchema,
  }),
  z.object({ type: z.literal("remove-clip"), clipId: socialProjectIdSchema }),
  z.object({
    type: z.literal("move-clip"),
    clipId: socialProjectIdSchema,
    targetTrackId: socialProjectIdSchema,
    timelineStartMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("split-clip"),
    clipId: socialProjectIdSchema,
    splitAtMs: z.number().int().nonnegative(),
    newClipId: socialProjectIdSchema,
  }),
  z.object({ type: z.literal("update-settings"), settings: socialProjectSettingsSchema }),
  z.object({ type: z.literal("undo") }),
  z.object({ type: z.literal("redo") }),
  z.object({ type: z.literal("take-control") }),
  z.object({ type: z.literal("return-to-agent") }),
]);

export const createSocialProjectRequestSchema = z.object({
  accountId: z.string().trim().min(1).max(120),
  displayName: projectTextSchema,
  requestId: socialProjectIdSchema.optional(),
});

export const socialProjectCommandRequestSchema = z.object({
  accountId: z.string().trim().min(1).max(120),
  projectId: socialProjectIdSchema,
  commandId: socialProjectIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  author: z.enum(["user", "agent"]),
  operation: socialProjectOperationSchema,
});

export const socialProjectCommandResultSchema = z.object({
  project: socialProjectSchema,
  history: z.array(socialProjectHistoryEntrySchema),
  duplicate: z.boolean(),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
});

export const socialProjectReadModelSchema = z.object({
  project: socialProjectSchema,
  history: z.array(socialProjectHistoryEntrySchema),
  canUndo: z.boolean(),
  canRedo: z.boolean(),
});

export const socialProjectExportRequestSchema = z.object({
  accountId: z.string().trim().min(1).max(120),
  projectId: socialProjectIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  requestId: socialProjectIdSchema,
});

export const socialProjectExportCancelRequestSchema = z.object({
  accountId: z.string().trim().min(1).max(120),
  exportId: socialProjectIdSchema,
});

export const socialProjectExportDownloadRequestSchema = z.object({
  accountId: z.string().trim().min(1).max(120),
  exportId: socialProjectIdSchema,
});

export const socialProjectExportJobSchema = z.object({
  exportId: socialProjectIdSchema,
  requestId: socialProjectIdSchema,
  accountId: z.string().trim().min(1).max(120),
  projectId: socialProjectIdSchema,
  projectRevision: z.number().int().nonnegative(),
  status: z.enum(["queued", "rendering", "completed", "failed", "cancelled"]),
  progressPercent: z.number().int().min(0).max(100),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  durationMs: z.number().int().positive().optional(),
  fileSizeBytes: z.number().int().positive().optional(),
  sha256: z
    .string()
    .regex(/^[\da-f]{64}$/)
    .optional(),
  errorCode: z
    .enum([
      "renderer-unavailable",
      "invalid-project",
      "invalid-media",
      "render-failed",
      "verification-failed",
    ])
    .optional(),
});

export const socialProjectExportDownloadSchema = z.object({
  url: z.string().trim().min(1).max(4096),
  expiresAt: z.number().int().nonnegative(),
  suggestedName: z.string().trim().min(1).max(120),
});

export type SocialProjectSettings = z.infer<typeof socialProjectSettingsSchema>;
export type SocialProjectTransform = z.infer<typeof socialProjectTransformSchema>;
export type SocialProjectColorAdjustments = z.infer<typeof socialProjectColorAdjustmentsSchema>;
export type SocialProjectKeyframe = z.infer<typeof socialProjectKeyframeSchema>;
export type SocialProjectKeyframeProperty = (typeof SOCIAL_PROJECT_KEYFRAME_PROPERTIES)[number];
export type SocialProjectClip = z.infer<typeof socialProjectClipSchema>;
export type SocialProjectTrack = z.infer<typeof socialProjectTrackSchema>;
export type SocialProject = z.infer<typeof socialProjectSchema>;
export type SocialProjectHistoryEntry = z.infer<typeof socialProjectHistoryEntrySchema>;
export type SocialProjectOperation = z.infer<typeof socialProjectOperationSchema>;
export type SocialProjectAgentOperation = Exclude<
  SocialProjectOperation,
  { type: "undo" | "redo" | "take-control" | "return-to-agent" }
>;
export type SocialProjectReadModel = z.infer<typeof socialProjectReadModelSchema>;
export type SocialProjectSummary = z.infer<typeof socialProjectSummarySchema>;
export type SocialProjectExportRequest = z.infer<typeof socialProjectExportRequestSchema>;
export type SocialProjectExportCancelRequest = z.infer<
  typeof socialProjectExportCancelRequestSchema
>;
export type SocialProjectExportDownloadRequest = z.infer<
  typeof socialProjectExportDownloadRequestSchema
>;
export type SocialProjectExportJob = z.infer<typeof socialProjectExportJobSchema>;
export type SocialProjectExportDownload = z.infer<typeof socialProjectExportDownloadSchema>;
export type CreateSocialProjectRequest = z.infer<typeof createSocialProjectRequestSchema>;
export type SocialProjectCommandRequest = z.infer<typeof socialProjectCommandRequestSchema>;
export type SocialProjectCommandResult = z.infer<typeof socialProjectCommandResultSchema>;

export type SocialProjectAgentCommand = {
  commandId: string;
  expectedRevision: number;
  operation: SocialProjectAgentOperation;
  projectId: string;
};

export interface SocialProjectAgentScope {
  list(): Promise<SocialProjectSummary[]>;
  get(projectId: string): Promise<SocialProjectReadModel | null>;
  executeCommand(request: SocialProjectAgentCommand): Promise<SocialProjectCommandResult>;
}

export function isSocialProjectAgentOperation(
  operation: SocialProjectOperation,
): operation is SocialProjectAgentOperation {
  return !["undo", "redo", "take-control", "return-to-agent"].includes(operation.type);
}
