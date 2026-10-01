import {
  SOCIAL_PROJECT_DEFAULT_COLOR_ADJUSTMENTS,
  SOCIAL_PROJECT_DEFAULT_TRANSFORM,
  type SocialProject,
  type SocialProjectClip,
} from "@social-harness/shared";
import {
  buildSocialProjectClipColorExpressions,
  buildSocialProjectClipTransitionExpression,
  buildSocialProjectKeyframeExpression,
  compileSocialProjectSceneExpression,
  getSocialProjectClipDurationMs,
  getSocialProjectContentDurationMs,
  getSocialProjectRenderableClips,
  multiplySceneExpression,
} from "@social-harness/opencut-core";
import { SocialProjectExportRenderError } from "../app/errors.js";

export const SOCIAL_PROJECT_EXPORT_MAX_DURATION_MS = 10 * 60 * 1000;

export interface SocialProjectExportGraphInput {
  project: SocialProject;
  inputIndexByClipId: ReadonlyMap<string, number>;
  textFileByClipId: ReadonlyMap<string, string>;
  clipsWithAudio: ReadonlySet<string>;
}

export interface SocialProjectExportGraph {
  durationMs: number;
  filterComplex: string;
  videoOutputLabel: string;
  audioOutputLabel?: string;
}

function clipEndMs(clip: SocialProjectClip): number {
  return clip.timelineStartMs + getSocialProjectClipDurationMs(clip);
}

function seconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function finite(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function quoteExpression(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

function quoteFilterPath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  return quoteExpression(normalized.replaceAll(":", "\\:").replaceAll("%", "\\%"));
}

function propertyExpression(
  clip: SocialProjectClip,
  property: "x" | "y" | "scaleX" | "scaleY" | "rotation" | "opacity" | "volume",
  timeVariable: "T" | "t",
  baseValue: number,
): string {
  return compileSocialProjectSceneExpression(
    buildSocialProjectKeyframeExpression(clip, property, baseValue),
    { timeMs: `((${timeVariable})*1000)` },
  );
}

function transformExpressions(clip: SocialProjectClip) {
  const transform = "transform" in clip ? clip.transform : undefined;
  const x = propertyExpression(clip, "x", "T", transform?.x ?? 0);
  const y = propertyExpression(clip, "y", "T", transform?.y ?? 0);
  const scaleX = propertyExpression(clip, "scaleX", "T", transform?.scaleX ?? 1);
  const scaleY = propertyExpression(clip, "scaleY", "T", transform?.scaleY ?? 1);
  const rotation = propertyExpression(clip, "rotation", "T", transform?.rotation ?? 0);
  const opacity = propertyExpression(clip, "opacity", "T", transform?.opacity ?? 1);
  const transitionOpacity = compileSocialProjectSceneExpression(
    buildSocialProjectClipTransitionExpression(clip),
    { timeMs: "(T*1000)" },
  );
  const radians = `((${rotation})*PI/180)`;
  const dx = `(X-W/2-(${x}))`;
  const dy = `(Y-H/2-(${y}))`;
  const sampleX = `(((${dx})*cos(${radians})+(${dy})*sin(${radians}))/(${scaleX})+W/2)`;
  const sampleY = `(((-(${dx})*sin(${radians})+(${dy})*cos(${radians}))/(${scaleY}))+H/2)`;
  const inside = `between(${sampleX},0,W-1)*between(${sampleY},0,H-1)`;
  const alpha = `if(${inside},alpha(${sampleX},${sampleY})*(${opacity})*(${transitionOpacity}),0)`;
  const colorExpressions = buildSocialProjectClipColorExpressions(clip);
  const colorVariables = {
    red: `(r(${sampleX},${sampleY})/255)`,
    green: `(g(${sampleX},${sampleY})/255)`,
    blue: `(b(${sampleX},${sampleY})/255)`,
  };
  return {
    red: `(${compileSocialProjectSceneExpression(colorExpressions.red, colorVariables)})*255`,
    green: `(${compileSocialProjectSceneExpression(colorExpressions.green, colorVariables)})*255`,
    blue: `(${compileSocialProjectSceneExpression(colorExpressions.blue, colorVariables)})*255`,
    alpha,
  };
}

function hasIdentityMediaAppearance(clip: Extract<SocialProjectClip, { kind: "video" | "image" }>) {
  const transform = clip.transform;
  const identityTransform =
    transform === undefined ||
    (transform.x === SOCIAL_PROJECT_DEFAULT_TRANSFORM.x &&
      transform.y === SOCIAL_PROJECT_DEFAULT_TRANSFORM.y &&
      transform.scaleX === SOCIAL_PROJECT_DEFAULT_TRANSFORM.scaleX &&
      transform.scaleY === SOCIAL_PROJECT_DEFAULT_TRANSFORM.scaleY &&
      transform.rotation === SOCIAL_PROJECT_DEFAULT_TRANSFORM.rotation &&
      transform.opacity === SOCIAL_PROJECT_DEFAULT_TRANSFORM.opacity);
  const color = clip.colorAdjustments;
  const neutralColor =
    color === undefined ||
    (color.brightness === SOCIAL_PROJECT_DEFAULT_COLOR_ADJUSTMENTS.brightness &&
      color.contrast === SOCIAL_PROJECT_DEFAULT_COLOR_ADJUSTMENTS.contrast &&
      color.saturation === SOCIAL_PROJECT_DEFAULT_COLOR_ADJUSTMENTS.saturation &&
      color.hue === SOCIAL_PROJECT_DEFAULT_COLOR_ADJUSTMENTS.hue);
  const hasVisualKeyframes = clip.keyframes.some(({ property }) => property !== "volume");

  return (
    identityTransform &&
    neutralColor &&
    !hasVisualKeyframes &&
    clip.transitionIn === undefined &&
    clip.transitionOut === undefined
  );
}

function audioTempoFilters(rate: number): string[] {
  const filters: string[] = [];
  let remaining = rate;
  while (remaining > 2) {
    filters.push("atempo=2");
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push("atempo=0.5");
    remaining /= 0.5;
  }
  if (Math.abs(remaining - 1) > 0.000001) filters.push(`atempo=${finite(remaining)}`);
  return filters;
}

export function buildSocialProjectExportGraph(
  input: SocialProjectExportGraphInput,
): SocialProjectExportGraph {
  const { project } = input;
  const frameRate = project.settings.frameRate;
  const frameRateValue = `${frameRate.numerator}/${frameRate.denominator}`;
  const durationMs = Math.ceil(getSocialProjectContentDurationMs(project));
  if (
    durationMs <= 0 ||
    durationMs > SOCIAL_PROJECT_EXPORT_MAX_DURATION_MS ||
    project.settings.width * project.settings.height > 33_554_432
  ) {
    throw new SocialProjectExportRenderError("invalid-project");
  }

  const graph: string[] = [`[0:v]format=gbrap[base0]`];
  let compositeLabel = "base0";
  let nextLabel = 1;
  const visualClips = getSocialProjectRenderableClips(project).filter(
    ({ clip }) => clip.kind === "video" || clip.kind === "image" || clip.kind === "text",
  );

  for (const { clip } of visualClips) {
    const inputIndex = input.inputIndexByClipId.get(clip.clipId);
    if (inputIndex === undefined) throw new SocialProjectExportRenderError("invalid-project");
    const layerLabel = `layer${nextLabel}`;
    const duration = getSocialProjectClipDurationMs(clip);
    if (clip.kind === "text") {
      const textFile = input.textFileByClipId.get(clip.clipId);
      if (!textFile) throw new SocialProjectExportRenderError("invalid-project");
      const alignment = clip.style.alignment;
      const expressions = transformExpressions(clip);
      graph.push(
        `[${inputIndex}:v]trim=duration=${seconds(duration)},setpts=PTS-STARTPTS,fps=${frameRateValue},format=gbrap,drawtext=font=${quoteFilterPath(clip.style.fontFamily)}:textfile=${quoteFilterPath(textFile)}:fontsize=${finite(clip.style.fontSize)}:fontcolor=0x${clip.style.color.slice(1)}:text_align=${alignment}:x=(w-text_w)/2:y=(h-text_h)/2,geq=r='${expressions.red}':g='${expressions.green}':b='${expressions.blue}':a='${expressions.alpha}':interpolation=1,setpts=PTS+${seconds(clip.timelineStartMs)}/TB[${layerLabel}]`,
      );
    } else if (clip.kind === "video" || clip.kind === "image") {
      const sourceDuration = clip.sourceEndMs - clip.sourceStartMs;
      const sourceFilters = [
        `trim=duration=${seconds(sourceDuration)}`,
        `setpts=(PTS-STARTPTS)/${finite(clip.playbackRate)}`,
        `fps=${frameRateValue}`,
        `scale=${project.settings.width}:${project.settings.height}:force_original_aspect_ratio=decrease`,
        `pad=${project.settings.width}:${project.settings.height}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
        "format=gbrap",
      ];
      // 恒等的画面设置不改变像素；跳过逐像素 geq 坐标采样，避免普通媒体导出明显变慢。
      if (!hasIdentityMediaAppearance(clip)) {
        const expressions = transformExpressions(clip);
        sourceFilters.push(
          `geq=r='${expressions.red}':g='${expressions.green}':b='${expressions.blue}':a='${expressions.alpha}':interpolation=1`,
        );
      }
      graph.push(
        `[${inputIndex}:v]${sourceFilters.join(",")},setpts=PTS+${seconds(clip.timelineStartMs)}/TB[${layerLabel}]`,
      );
    } else {
      continue;
    }
    const nextCompositeLabel = `base${nextLabel}`;
    graph.push(
      `[${compositeLabel}][${layerLabel}]overlay=x=0:y=0:eof_action=pass:repeatlast=0:format=auto:enable='between(t,${seconds(clip.timelineStartMs)},${seconds(clipEndMs(clip))})'[${nextCompositeLabel}]`,
    );
    compositeLabel = nextCompositeLabel;
    nextLabel += 1;
  }

  graph.push(`[${compositeLabel}]fps=${frameRateValue},format=yuv420p[vout]`);

  const audioSources: string[] = [];
  for (const { clip, track } of getSocialProjectRenderableClips(project)) {
    if (
      track.muted ||
      clip.kind === "text" ||
      clip.kind === "image" ||
      !input.clipsWithAudio.has(clip.clipId)
    )
      continue;
    const inputIndex = input.inputIndexByClipId.get(clip.clipId);
    if (inputIndex === undefined) throw new SocialProjectExportRenderError("invalid-project");
    const volumeExpression = compileSocialProjectSceneExpression(
      multiplySceneExpression(
        buildSocialProjectKeyframeExpression(clip, "volume", clip.volume),
        buildSocialProjectClipTransitionExpression(clip),
      ),
      { timeMs: "(t*1000)" },
    );
    const filters = [
      `atrim=duration=${seconds(clip.sourceEndMs - clip.sourceStartMs)}`,
      "asetpts=PTS-STARTPTS",
      ...audioTempoFilters(clip.playbackRate),
      `volume=${quoteExpression(volumeExpression)}:eval=frame`,
    ];
    filters.push("asetpts=PTS-STARTPTS");
    if (clip.timelineStartMs > 0) filters.push(`adelay=delays=${clip.timelineStartMs}:all=1`);
    const label = `audio${audioSources.length}`;
    graph.push(`[${inputIndex}:a]${filters.join(",")}[${label}]`);
    audioSources.push(label);
  }
  if (audioSources.length > 0) {
    const mixInputs = audioSources.map((label) => `[${label}]`).join("");
    graph.push(
      `${mixInputs}amix=inputs=${audioSources.length}:duration=longest:normalize=0:dropout_transition=0,atrim=duration=${seconds(durationMs)}[aout]`,
    );
  }

  return {
    durationMs,
    filterComplex: graph.join(";"),
    videoOutputLabel: "vout",
    ...(audioSources.length > 0 ? { audioOutputLabel: "aout" } : {}),
  };
}

export function socialProjectClipDurationMs(clip: SocialProjectClip): number {
  return getSocialProjectClipDurationMs(clip);
}

export function socialProjectClipSourceDurationMs(
  clip: Exclude<SocialProjectClip, { kind: "text" }>,
) {
  return clip.sourceEndMs - clip.sourceStartMs;
}
