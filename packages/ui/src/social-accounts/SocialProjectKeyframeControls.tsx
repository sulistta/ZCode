import { useState } from "react";
import {
  SOCIAL_PROJECT_KEYFRAME_VALUE_RANGES,
  type SocialProjectKeyframe,
  type SocialProjectKeyframeProperty,
} from "@social-harness/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

const DEFAULT_KEYFRAME_VALUES: Record<SocialProjectKeyframeProperty, number> = {
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  opacity: 1,
  volume: 1,
};

const EASINGS = ["linear", "ease-in", "ease-out", "ease-in-out"] as const;

export function SocialProjectKeyframeControls({
  clipDurationMs,
  disabled,
  keyframes,
  onChange,
  allowedProperties,
}: {
  clipDurationMs: number;
  disabled: boolean;
  keyframes: SocialProjectKeyframe[];
  onChange: (keyframes: SocialProjectKeyframe[]) => void;
  allowedProperties: readonly SocialProjectKeyframeProperty[];
}) {
  const { intl } = useZCodeIntl();
  const initialProperty = allowedProperties[0] ?? "x";
  const [newProperty, setNewProperty] = useState<SocialProjectKeyframeProperty>(initialProperty);
  const [newTime, setNewTime] = useState("0");
  const [newValue, setNewValue] = useState(String(DEFAULT_KEYFRAME_VALUES[initialProperty]));
  const [newEasing, setNewEasing] = useState<(typeof EASINGS)[number]>("linear");
  const currentRange = SOCIAL_PROJECT_KEYFRAME_VALUE_RANGES[newProperty];
  const parsedTimeMs = Number(newTime) * 1000;
  const parsedValue = Number(newValue);
  const canAdd =
    !disabled &&
    keyframes.length < 500 &&
    Number.isFinite(parsedTimeMs) &&
    parsedTimeMs >= 0 &&
    parsedTimeMs <= clipDurationMs &&
    Number.isFinite(parsedValue) &&
    parsedValue >= currentRange.min &&
    parsedValue <= currentRange.max;

  const updateKeyframe = (index: number, patch: Partial<SocialProjectKeyframe>) => {
    onChange(
      keyframes.map((keyframe, current) =>
        current === index ? { ...keyframe, ...patch } : keyframe,
      ),
    );
  };

  const changeKeyframeProperty = (index: number, property: SocialProjectKeyframeProperty) => {
    const keyframe = keyframes[index];
    if (!keyframe) return;
    const range = SOCIAL_PROJECT_KEYFRAME_VALUE_RANGES[property];
    const value =
      keyframe.value >= range.min && keyframe.value <= range.max
        ? keyframe.value
        : DEFAULT_KEYFRAME_VALUES[property];
    updateKeyframe(index, { property, value });
  };

  const addKeyframe = () => {
    if (!canAdd) return;
    onChange([
      ...keyframes,
      {
        keyframeId: crypto.randomUUID(),
        timeMs: Math.round(parsedTimeMs),
        property: newProperty,
        value: parsedValue,
        easing: newEasing,
      },
    ]);
  };

  return (
    <fieldset className="grid gap-2 rounded-md border border-border p-3">
      <legend className="px-1 text-ui-sm font-medium">
        {intl.formatMessage({ id: "socialProject.clip.keyframes" })}
      </legend>
      <p className="text-ui-xs text-foreground-subtle">
        {intl.formatMessage({ id: "socialProject.clip.keyframe.localTime" })}
      </p>
      {keyframes.map((keyframe, index) => {
        const labelValues = { index: index + 1 };
        const range = SOCIAL_PROJECT_KEYFRAME_VALUE_RANGES[keyframe.property];
        return (
          <div
            key={keyframe.keyframeId}
            className="flex flex-wrap items-end gap-2 rounded-md bg-surface p-2"
          >
            <label className="grid gap-1 text-ui-xs">
              {intl.formatMessage({ id: "socialProject.clip.keyframe.property" }, labelValues)}
              <select
                className="h-8 min-w-28 rounded-md border border-input-border bg-input px-2 text-ui-sm"
                value={keyframe.property}
                disabled={disabled}
                onChange={(event) =>
                  changeKeyframeProperty(
                    index,
                    event.currentTarget.value as SocialProjectKeyframeProperty,
                  )
                }
              >
                {allowedProperties.map((property) => (
                  <option key={property} value={property}>
                    {intl.formatMessage({ id: `socialProject.clip.keyframe.property.${property}` })}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-ui-xs">
              {intl.formatMessage({ id: "socialProject.clip.keyframe.time" }, labelValues)}
              <Input
                className="w-28"
                type="number"
                min="0"
                max={clipDurationMs / 1000}
                step="0.01"
                value={Number.isFinite(keyframe.timeMs) ? String(keyframe.timeMs / 1000) : ""}
                disabled={disabled}
                onChange={(event) => {
                  const seconds = Number(event.currentTarget.value);
                  updateKeyframe(index, {
                    timeMs: event.currentTarget.value.trim()
                      ? Math.round(seconds * 1000)
                      : Number.NaN,
                  });
                }}
              />
            </label>
            <label className="grid gap-1 text-ui-xs">
              {intl.formatMessage({ id: "socialProject.clip.keyframe.value" }, labelValues)}
              <Input
                className="w-28"
                type="number"
                min={range.min}
                max={range.max}
                step="0.01"
                value={Number.isFinite(keyframe.value) ? String(keyframe.value) : ""}
                disabled={disabled}
                onChange={(event) =>
                  updateKeyframe(index, {
                    value: event.currentTarget.value.trim()
                      ? Number(event.currentTarget.value)
                      : Number.NaN,
                  })
                }
              />
            </label>
            <label className="grid gap-1 text-ui-xs">
              {intl.formatMessage({ id: "socialProject.clip.keyframe.easing" }, labelValues)}
              <select
                className="h-8 min-w-28 rounded-md border border-input-border bg-input px-2 text-ui-sm"
                value={keyframe.easing}
                disabled={disabled}
                onChange={(event) =>
                  updateKeyframe(index, {
                    easing: event.currentTarget.value as SocialProjectKeyframe["easing"],
                  })
                }
              >
                {EASINGS.map((easing) => (
                  <option key={easing} value={easing}>
                    {intl.formatMessage({ id: `socialProject.clip.keyframe.easing.${easing}` })}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onChange(keyframes.filter((_, current) => current !== index))}
            >
              {intl.formatMessage({ id: "socialProject.clip.keyframe.remove" }, labelValues)}
            </Button>
          </div>
        );
      })}
      {keyframes.length >= 500 ? (
        <p className="text-ui-xs text-foreground-subtle">
          {intl.formatMessage({ id: "socialProject.clip.keyframe.limit" })}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2 border-t border-border pt-2">
        <label className="grid gap-1 text-ui-xs">
          {intl.formatMessage({ id: "socialProject.clip.keyframe.newProperty" })}
          <select
            className="h-8 min-w-28 rounded-md border border-input-border bg-input px-2 text-ui-sm"
            value={newProperty}
            disabled={disabled}
            onChange={(event) => {
              const property = event.currentTarget.value as SocialProjectKeyframeProperty;
              setNewProperty(property);
              setNewValue(String(DEFAULT_KEYFRAME_VALUES[property]));
            }}
          >
            {allowedProperties.map((property) => (
              <option key={property} value={property}>
                {intl.formatMessage({ id: `socialProject.clip.keyframe.property.${property}` })}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-ui-xs">
          {intl.formatMessage({ id: "socialProject.clip.keyframe.newTime" })}
          <Input
            className="w-28"
            type="number"
            min="0"
            max={clipDurationMs / 1000}
            step="0.01"
            value={newTime}
            disabled={disabled}
            onChange={(event) => setNewTime(event.currentTarget.value)}
          />
        </label>
        <label className="grid gap-1 text-ui-xs">
          {intl.formatMessage({ id: "socialProject.clip.keyframe.newValue" })}
          <Input
            className="w-28"
            type="number"
            min={currentRange.min}
            max={currentRange.max}
            step="0.01"
            value={newValue}
            disabled={disabled}
            onChange={(event) => setNewValue(event.currentTarget.value)}
          />
        </label>
        <label className="grid gap-1 text-ui-xs">
          {intl.formatMessage({ id: "socialProject.clip.keyframe.newEasing" })}
          <select
            className="h-8 min-w-28 rounded-md border border-input-border bg-input px-2 text-ui-sm"
            value={newEasing}
            disabled={disabled}
            onChange={(event) =>
              setNewEasing(event.currentTarget.value as (typeof EASINGS)[number])
            }
          >
            {EASINGS.map((easing) => (
              <option key={easing} value={easing}>
                {intl.formatMessage({ id: `socialProject.clip.keyframe.easing.${easing}` })}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" size="sm" disabled={!canAdd} onClick={addKeyframe}>
          {intl.formatMessage({ id: "socialProject.clip.keyframe.add" })}
        </Button>
      </div>
    </fieldset>
  );
}
