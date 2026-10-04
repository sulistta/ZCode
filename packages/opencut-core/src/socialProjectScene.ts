import {
  SOCIAL_PROJECT_DEFAULT_COLOR_ADJUSTMENTS,
  type SocialProject,
  type SocialProjectClip,
  type SocialProjectKeyframe,
} from "@social-harness/shared";
import {
  add,
  compileSocialProjectFfmpegExpression,
  conditional,
  constant,
  divide,
  evaluateSocialProjectExpression,
  maximum,
  minimum,
  multiply,
  subtract,
  variable,
  type SocialProjectExpressionValues,
  type SocialProjectFfmpegVariables,
  type SocialProjectNumericExpression,
} from "./socialProjectExpression.js";

export interface ActiveSocialProjectClip {
  clip: SocialProjectClip;
  track: SocialProject["tracks"][number];
  trackPosition: number;
}

export type SocialProjectAnimatedProperty = SocialProjectKeyframe["property"];

export interface SocialProjectColorExpressions {
  red: SocialProjectNumericExpression;
  green: SocialProjectNumericExpression;
  blue: SocialProjectNumericExpression;
}

const timeMs = variable("timeMs");

export function getSocialProjectClipDurationMs(clip: SocialProjectClip): number {
  if (clip.kind === "text") return clip.durationMs;
  return Math.max(0, (clip.sourceEndMs - clip.sourceStartMs) / clip.playbackRate);
}

export function getSocialProjectContentDurationMs(project: SocialProject): number {
  return Math.max(
    0,
    ...project.tracks.flatMap((track) =>
      track.clips.map((clip) => clip.timelineStartMs + getSocialProjectClipDurationMs(clip)),
    ),
  );
}

export function getSocialProjectEndMs(project: SocialProject): number {
  return Math.max(15_000, getSocialProjectContentDurationMs(project));
}

export function getActiveSocialProjectClips(
  project: SocialProject,
  playheadMs: number,
): ActiveSocialProjectClip[] {
  return getSocialProjectRenderableClips(project).filter(({ clip }) => {
    const start = clip.timelineStartMs;
    return playheadMs >= start && playheadMs < start + getSocialProjectClipDurationMs(clip);
  });
}

export function getSocialProjectRenderableClips(project: SocialProject): ActiveSocialProjectClip[] {
  return project.tracks
    .flatMap((track, trackPosition) =>
      track.hidden || (track.type === "audio" && track.muted)
        ? []
        : track.clips.map((clip) => ({ clip, track, trackPosition })),
    )
    .toSorted(
      (left, right) =>
        left.trackPosition - right.trackPosition ||
        left.clip.timelineStartMs - right.clip.timelineStartMs,
    );
}

export function getSocialProjectSourceTimeMs(
  clip: Exclude<SocialProjectClip, { kind: "text" }>,
  playheadMs: number,
): number {
  const elapsedMs = Math.max(0, playheadMs - clip.timelineStartMs);
  return Math.min(clip.sourceEndMs, clip.sourceStartMs + elapsedMs * clip.playbackRate);
}

function easeProgress(
  progress: SocialProjectNumericExpression,
  easing: SocialProjectKeyframe["easing"],
): SocialProjectNumericExpression {
  switch (easing) {
    case "ease-in":
      return multiply(progress, progress);
    case "ease-out":
      return subtract(
        constant(1),
        multiply(subtract(constant(1), progress), subtract(constant(1), progress)),
      );
    case "ease-in-out":
      return multiply(
        multiply(progress, progress),
        subtract(constant(3), multiply(constant(2), progress)),
      );
    case "linear":
      return progress;
  }
}

function mix(
  from: number,
  to: number,
  progress: SocialProjectNumericExpression,
): SocialProjectNumericExpression {
  return add(constant(from), multiply(constant(to - from), progress));
}

function orderedKeyframes(
  clip: SocialProjectClip,
  property: SocialProjectAnimatedProperty,
): SocialProjectKeyframe[] {
  return clip.keyframes
    .filter((keyframe) => keyframe.property === property)
    .map((keyframe, index) => ({ keyframe, index }))
    .toSorted(
      (left, right) => left.keyframe.timeMs - right.keyframe.timeMs || left.index - right.index,
    )
    .reduce<SocialProjectKeyframe[]>((unique, { keyframe }) => {
      if (unique.at(-1)?.timeMs === keyframe.timeMs) unique[unique.length - 1] = keyframe;
      else unique.push(keyframe);
      return unique;
    }, []);
}

export function buildSocialProjectKeyframeExpression(
  clip: SocialProjectClip,
  property: SocialProjectAnimatedProperty,
  baseValue: number,
): SocialProjectNumericExpression {
  const keys = orderedKeyframes(clip, property);
  if (keys.length === 0) return constant(baseValue);

  let expression: SocialProjectNumericExpression = constant(keys.at(-1)!.value);
  for (let index = keys.length - 1; index > 0; index -= 1) {
    const from = keys[index - 1]!;
    const to = keys[index]!;
    const segmentProgress = divide(
      subtract(timeMs, constant(from.timeMs)),
      constant(to.timeMs - from.timeMs),
    );
    expression = conditional(
      lessThan(timeMs, to.timeMs),
      mix(from.value, to.value, easeProgress(segmentProgress, from.easing)),
      expression,
    );
  }

  const first = keys[0]!;
  if (first.timeMs <= 0) return expression;
  const baseToFirst = mix(baseValue, first.value, divide(timeMs, constant(first.timeMs)));
  return conditional(lessThan(timeMs, first.timeMs), baseToFirst, expression);
}

function lessThan(
  left: SocialProjectNumericExpression,
  right: number,
): SocialProjectNumericExpression {
  return { operator: "lessThan", left, right: constant(right) };
}

export function getSocialProjectKeyframedValue(
  clip: SocialProjectClip,
  property: SocialProjectAnimatedProperty,
  playheadMs: number,
  baseValue: number,
): number {
  return evaluateSocialProjectExpression(
    buildSocialProjectKeyframeExpression(clip, property, baseValue),
    { timeMs: Math.max(0, playheadMs - clip.timelineStartMs) },
  );
}

function getBaseValue(clip: SocialProjectClip, property: SocialProjectAnimatedProperty): number {
  if (property === "volume") return clip.kind === "text" ? 1 : clip.volume;
  const transform = "transform" in clip ? clip.transform : undefined;
  if (property === "x") return transform?.x ?? 0;
  if (property === "y") return transform?.y ?? 0;
  if (property === "scaleX") return transform?.scaleX ?? 1;
  if (property === "scaleY") return transform?.scaleY ?? 1;
  if (property === "rotation") return transform?.rotation ?? 0;
  if (property === "opacity") return transform?.opacity ?? 1;
  return 1;
}

export function getSocialProjectClipTransform(clip: SocialProjectClip, playheadMs: number) {
  return {
    x: getSocialProjectKeyframedValue(clip, "x", playheadMs, getBaseValue(clip, "x")),
    y: getSocialProjectKeyframedValue(clip, "y", playheadMs, getBaseValue(clip, "y")),
    scaleX: getSocialProjectKeyframedValue(
      clip,
      "scaleX",
      playheadMs,
      getBaseValue(clip, "scaleX"),
    ),
    scaleY: getSocialProjectKeyframedValue(
      clip,
      "scaleY",
      playheadMs,
      getBaseValue(clip, "scaleY"),
    ),
    rotation: getSocialProjectKeyframedValue(
      clip,
      "rotation",
      playheadMs,
      getBaseValue(clip, "rotation"),
    ),
    opacity: getSocialProjectKeyframedValue(
      clip,
      "opacity",
      playheadMs,
      getBaseValue(clip, "opacity"),
    ),
  };
}

export function getSocialProjectClipVolume(
  clip: Exclude<SocialProjectClip, { kind: "text" }>,
  playheadMs: number,
): number {
  return getSocialProjectKeyframedValue(clip, "volume", playheadMs, clip.volume);
}

function clamp01(value: SocialProjectNumericExpression): SocialProjectNumericExpression {
  return minimum(constant(1), maximum(constant(0), value));
}

function weightedSum(
  terms: Array<[number, SocialProjectNumericExpression]>,
): SocialProjectNumericExpression {
  return terms.reduce<SocialProjectNumericExpression>(
    (sum, [weight, value]) => add(sum, multiply(constant(weight), value)),
    constant(0),
  );
}

export function getSocialProjectClipColorAdjustments(clip: SocialProjectClip) {
  if (clip.kind !== "video" && clip.kind !== "image") return undefined;
  return clip.colorAdjustments ?? SOCIAL_PROJECT_DEFAULT_COLOR_ADJUSTMENTS;
}

export function buildSocialProjectClipColorExpressions(
  clip: SocialProjectClip,
): SocialProjectColorExpressions {
  const adjustments = getSocialProjectClipColorAdjustments(clip);
  const red = variable("red");
  const green = variable("green");
  const blue = variable("blue");
  if (!adjustments) return { red, green, blue };

  const brightness = 1 + adjustments.brightness;
  const contrast = adjustments.contrast;
  const source = [red, green, blue].map((channel) =>
    add(
      multiply(
        subtract(multiply(channel, constant(brightness)), constant(0.5)),
        constant(contrast),
      ),
      constant(0.5),
    ),
  );
  const saturation = adjustments.saturation;
  const saturated = [
    weightedSum([
      [0.213 + 0.787 * saturation, source[0]!],
      [0.715 - 0.715 * saturation, source[1]!],
      [0.072 - 0.072 * saturation, source[2]!],
    ]),
    weightedSum([
      [0.213 - 0.213 * saturation, source[0]!],
      [0.715 + 0.285 * saturation, source[1]!],
      [0.072 - 0.072 * saturation, source[2]!],
    ]),
    weightedSum([
      [0.213 - 0.213 * saturation, source[0]!],
      [0.715 - 0.715 * saturation, source[1]!],
      [0.072 + 0.928 * saturation, source[2]!],
    ]),
  ];
  const radians = (adjustments.hue * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const hueRotated = [
    weightedSum([
      [0.213 + cosine * 0.787 - sine * 0.213, saturated[0]!],
      [0.715 - cosine * 0.715 - sine * 0.715, saturated[1]!],
      [0.072 - cosine * 0.072 + sine * 0.928, saturated[2]!],
    ]),
    weightedSum([
      [0.213 - cosine * 0.213 + sine * 0.143, saturated[0]!],
      [0.715 + cosine * 0.285 + sine * 0.14, saturated[1]!],
      [0.072 - cosine * 0.072 - sine * 0.283, saturated[2]!],
    ]),
    weightedSum([
      [0.213 - cosine * 0.213 - sine * 0.787, saturated[0]!],
      [0.715 - cosine * 0.715 + sine * 0.715, saturated[1]!],
      [0.072 + cosine * 0.928 + sine * 0.072, saturated[2]!],
    ]),
  ];

  return {
    red: clamp01(hueRotated[0]!),
    green: clamp01(hueRotated[1]!),
    blue: clamp01(hueRotated[2]!),
  };
}

export function getSocialProjectClipColorFilter(clip: SocialProjectClip): string | undefined {
  const adjustments = getSocialProjectClipColorAdjustments(clip);
  if (!adjustments) return undefined;
  const filters: string[] = [];
  if (adjustments.brightness !== 0) filters.push(`brightness(${1 + adjustments.brightness})`);
  if (adjustments.contrast !== 1) filters.push(`contrast(${adjustments.contrast})`);
  if (adjustments.saturation !== 1) filters.push(`saturate(${adjustments.saturation})`);
  if (adjustments.hue !== 0) filters.push(`hue-rotate(${adjustments.hue}deg)`);
  return filters.length > 0 ? filters.join(" ") : undefined;
}

export function buildSocialProjectClipTransitionExpression(
  clip: SocialProjectClip,
): SocialProjectNumericExpression {
  const durationMs = getSocialProjectClipDurationMs(clip);
  const duration = constant(durationMs);
  let opacity: SocialProjectNumericExpression = constant(1);
  if (clip.transitionIn) {
    opacity = multiply(opacity, clamp01(divide(timeMs, constant(clip.transitionIn.durationMs))));
  }
  if (clip.transitionOut) {
    opacity = multiply(
      opacity,
      clamp01(divide(subtract(duration, timeMs), constant(clip.transitionOut.durationMs))),
    );
  }
  return opacity;
}

export function getSocialProjectClipTransitionOpacity(
  clip: SocialProjectClip,
  playheadMs: number,
): number {
  return evaluateSocialProjectExpression(buildSocialProjectClipTransitionExpression(clip), {
    timeMs: Math.max(0, playheadMs - clip.timelineStartMs),
  });
}

export function compileSocialProjectSceneExpression(
  expression: SocialProjectNumericExpression,
  values: SocialProjectFfmpegVariables = {},
): string {
  return compileSocialProjectFfmpegExpression(expression, values);
}

export function evaluateSocialProjectSceneExpression(
  expression: SocialProjectNumericExpression,
  values: SocialProjectExpressionValues,
): number {
  return evaluateSocialProjectExpression(expression, values);
}
