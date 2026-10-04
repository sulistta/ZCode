import { useEffect, useState } from "react";
import {
  SOCIAL_PROJECT_DEFAULT_TRANSFORM,
  SOCIAL_PROJECT_KEYFRAME_PROPERTIES,
  socialProjectClipSchema,
  type SocialProjectClip,
  type SocialProjectKeyframe,
  type SocialProjectKeyframeProperty,
  type SocialProjectTransform,
} from "@social-harness/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { SocialProjectKeyframeControls } from "./SocialProjectKeyframeControls.js";

type TransitionKind = "" | "fade" | "dissolve";
type TransformProperty = keyof SocialProjectTransform;

const TRANSFORM_FIELDS: Array<{
  property: TransformProperty;
  labelId: string;
  min: number;
  max: number;
  step: number;
}> = [
  {
    property: "x",
    labelId: "socialProject.clip.transform.x",
    min: -100_000,
    max: 100_000,
    step: 1,
  },
  {
    property: "y",
    labelId: "socialProject.clip.transform.y",
    min: -100_000,
    max: 100_000,
    step: 1,
  },
  {
    property: "scaleX",
    labelId: "socialProject.clip.transform.scaleX",
    min: 0.01,
    max: 100,
    step: 0.01,
  },
  {
    property: "scaleY",
    labelId: "socialProject.clip.transform.scaleY",
    min: 0.01,
    max: 100,
    step: 0.01,
  },
  {
    property: "rotation",
    labelId: "socialProject.clip.transform.rotation",
    min: -3600,
    max: 3600,
    step: 1,
  },
  {
    property: "opacity",
    labelId: "socialProject.clip.transform.opacity",
    min: 0,
    max: 1,
    step: 0.01,
  },
];

function clipDurationMs(clip: SocialProjectClip): number {
  if (clip.kind === "text") return clip.durationMs;
  return (clip.sourceEndMs - clip.sourceStartMs) / clip.playbackRate;
}

function allowedKeyframeProperties(clip: SocialProjectClip): SocialProjectKeyframeProperty[] {
  if (clip.kind === "audio") return ["volume"];
  if (clip.kind !== "video") {
    return SOCIAL_PROJECT_KEYFRAME_PROPERTIES.filter((property) => property !== "volume");
  }
  return [...SOCIAL_PROJECT_KEYFRAME_PROPERTIES];
}

function transitionKind(transition: SocialProjectClip["transitionIn"]): TransitionKind {
  return transition?.kind ?? "";
}

export function SocialProjectClipEffectsForm({
  trackId,
  clip,
  disabled,
  onUpdate,
}: {
  trackId: string;
  clip: SocialProjectClip;
  disabled: boolean;
  onUpdate: (trackId: string, clip: SocialProjectClip) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const [transform, setTransform] = useState<SocialProjectTransform>({
    ...SOCIAL_PROJECT_DEFAULT_TRANSFORM,
  });
  const [keyframes, setKeyframes] = useState<SocialProjectKeyframe[]>(clip.keyframes);
  const [transitionInKind, setTransitionInKind] = useState<TransitionKind>(
    transitionKind(clip.transitionIn),
  );
  const [transitionOutKind, setTransitionOutKind] = useState<TransitionKind>(
    transitionKind(clip.transitionOut),
  );
  const [transitionInDuration, setTransitionInDuration] = useState("0.5");
  const [transitionOutDuration, setTransitionOutDuration] = useState("0.5");
  const [validationError, setValidationError] = useState<string | null>(null);
  const durationMs = clipDurationMs(clip);
  const isVisualClip = clip.kind !== "audio";
  const keyframeProperties = allowedKeyframeProperties(clip);

  useEffect(() => {
    if (clip.kind !== "audio")
      setTransform(clip.transform ?? { ...SOCIAL_PROJECT_DEFAULT_TRANSFORM });
    setKeyframes(clip.keyframes);
    setTransitionInKind(transitionKind(clip.transitionIn));
    setTransitionOutKind(transitionKind(clip.transitionOut));
    setTransitionInDuration(
      clip.transitionIn ? String(clip.transitionIn.durationMs / 1000) : "0.5",
    );
    setTransitionOutDuration(
      clip.transitionOut ? String(clip.transitionOut.durationMs / 1000) : "0.5",
    );
    setValidationError(null);
  }, [clip]);

  const saveEffects = () => {
    setValidationError(null);
    const createTransition = (
      kind: TransitionKind,
      seconds: string,
    ): SocialProjectClip["transitionIn"] => {
      if (!kind) return undefined;
      return { kind, durationMs: Math.round(Number(seconds) * 1000) };
    };
    const transitionIn = createTransition(transitionInKind, transitionInDuration);
    const transitionOut = createTransition(transitionOutKind, transitionOutDuration);
    const candidate: SocialProjectClip =
      clip.kind === "audio"
        ? { ...clip, keyframes, transitionIn, transitionOut }
        : { ...clip, transform, keyframes, transitionIn, transitionOut };
    const validatedClip = socialProjectClipSchema.safeParse(candidate);
    if (!validatedClip.success || durationMs < 1) {
      setValidationError(intl.formatMessage({ id: "socialProject.clip.effects.invalid" }));
      return;
    }
    void onUpdate(trackId, validatedClip.data);
  };

  return (
    <details
      className="rounded-md border border-border"
      data-testid={`social-project-clip-effects-${clip.clipId}`}
    >
      <summary className="cursor-pointer px-3 py-2 text-ui-sm font-medium hover:bg-surface-hover">
        {intl.formatMessage({ id: "socialProject.clip.effects.title" })}
      </summary>
      <div className="grid gap-3 border-t border-border p-3">
        {isVisualClip ? (
          <fieldset className="grid gap-2">
            <legend className="text-ui-sm font-medium">
              {intl.formatMessage({ id: "socialProject.clip.transform.title" })}
            </legend>
            <div className="flex flex-wrap items-end gap-2">
              {TRANSFORM_FIELDS.map(({ property, labelId, min, max, step }) => (
                <label key={property} className="grid gap-1 text-ui-xs">
                  {intl.formatMessage({ id: labelId })}
                  <Input
                    className="w-28"
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    value={Number.isFinite(transform[property]) ? String(transform[property]) : ""}
                    disabled={disabled}
                    onChange={(event) => {
                      const value = event.currentTarget.value.trim()
                        ? Number(event.currentTarget.value)
                        : Number.NaN;
                      setTransform((current) => ({ ...current, [property]: value }));
                    }}
                  />
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <fieldset className="grid gap-2">
          <legend className="text-ui-sm font-medium">
            {intl.formatMessage({ id: "socialProject.clip.transition.title" })}
          </legend>
          <div className="flex flex-wrap items-end gap-2">
            {(
              [
                [
                  "in",
                  transitionInKind,
                  setTransitionInKind,
                  transitionInDuration,
                  setTransitionInDuration,
                ],
                [
                  "out",
                  transitionOutKind,
                  setTransitionOutKind,
                  transitionOutDuration,
                  setTransitionOutDuration,
                ],
              ] as const
            ).map(([direction, kind, setKind, duration, setDuration]) => (
              <div key={direction} className="flex flex-wrap items-end gap-2">
                <label className="grid gap-1 text-ui-xs">
                  {intl.formatMessage({ id: `socialProject.clip.transition.${direction}` })}
                  <select
                    className="h-8 min-w-28 rounded-md border border-input-border bg-input px-2 text-ui-sm"
                    value={kind}
                    disabled={disabled}
                    onChange={(event) => setKind(event.currentTarget.value as TransitionKind)}
                  >
                    <option value="">
                      {intl.formatMessage({ id: "socialProject.clip.transition.none" })}
                    </option>
                    <option value="fade">
                      {intl.formatMessage({ id: "socialProject.clip.transition.fade" })}
                    </option>
                    <option value="dissolve">
                      {intl.formatMessage({ id: "socialProject.clip.transition.dissolve" })}
                    </option>
                  </select>
                </label>
                {kind ? (
                  <label className="grid gap-1 text-ui-xs">
                    {intl.formatMessage({
                      id: `socialProject.clip.transition.duration.${direction}`,
                    })}
                    <Input
                      className="w-28"
                      type="number"
                      min="0.001"
                      max={Math.min(10, durationMs / 1000)}
                      step="0.1"
                      value={duration}
                      disabled={disabled}
                      onChange={(event) => setDuration(event.currentTarget.value)}
                    />
                  </label>
                ) : null}
              </div>
            ))}
          </div>
        </fieldset>

        <SocialProjectKeyframeControls
          clipDurationMs={durationMs}
          disabled={disabled}
          keyframes={keyframes}
          onChange={setKeyframes}
          allowedProperties={keyframeProperties}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={disabled} onClick={saveEffects}>
            {intl.formatMessage({ id: "socialProject.clip.effects.save" })}
          </Button>
          {validationError ? (
            <p className="text-ui-sm text-destructive" role="alert">
              {validationError}
            </p>
          ) : null}
        </div>
      </div>
    </details>
  );
}
