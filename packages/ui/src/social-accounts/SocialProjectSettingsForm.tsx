import { useEffect, useState } from "react";
import type { SocialProjectSettings } from "@social-harness/shared";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

export function SocialProjectSettingsForm({
  settings,
  canEdit,
  isWorking,
  onSave,
}: {
  settings: SocialProjectSettings;
  canEdit: boolean;
  isWorking: boolean;
  onSave: (settings: SocialProjectSettings) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const [width, setWidth] = useState(String(settings.width));
  const [height, setHeight] = useState(String(settings.height));
  const [frameRate, setFrameRate] = useState(String(settings.frameRate.numerator));
  const [backgroundColor, setBackgroundColor] = useState(settings.backgroundColor);
  const [invalid, setInvalid] = useState(false);
  const savedWidth = settings.width;
  const savedHeight = settings.height;
  const savedFrameRate = settings.frameRate.numerator / settings.frameRate.denominator;
  const savedBackgroundColor = settings.backgroundColor;

  useEffect(() => {
    // 服务端刷新可能创建新的 settings 对象但字段未变；只有持久化值变化时才重置用户草稿。
    setWidth(String(savedWidth));
    setHeight(String(savedHeight));
    setFrameRate(String(savedFrameRate));
    setBackgroundColor(savedBackgroundColor);
    setInvalid(false);
  }, [savedBackgroundColor, savedFrameRate, savedHeight, savedWidth]);

  const save = () => {
    const nextWidth = Number(width);
    const nextHeight = Number(height);
    const nextFrameRate = Number(frameRate);
    if (
      !Number.isInteger(nextWidth) ||
      nextWidth < 16 ||
      nextWidth > 8192 ||
      !Number.isInteger(nextHeight) ||
      nextHeight < 16 ||
      nextHeight > 8192 ||
      !Number.isInteger(nextFrameRate) ||
      nextFrameRate < 1 ||
      nextFrameRate > 240 ||
      !/^#[\da-f]{6}$/i.test(backgroundColor)
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    void onSave({
      width: nextWidth,
      height: nextHeight,
      frameRate: { numerator: nextFrameRate, denominator: 1 },
      backgroundColor: backgroundColor.toUpperCase(),
    });
  };

  return (
    <section className="grid gap-3 rounded-md border border-border bg-card p-4">
      <div>
        <h2 className="text-ui-base font-semibold">
          {intl.formatMessage({ id: "socialProject.settings.title" })}
        </h2>
        <p className="mt-1 text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "socialProject.settings.description" })}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="grid gap-1 text-ui-sm">
          {intl.formatMessage({ id: "socialProject.settings.width" })}
          <Input
            type="number"
            min="16"
            max="8192"
            step="1"
            value={width}
            onChange={(event) => setWidth(event.currentTarget.value)}
            disabled={!canEdit || isWorking}
          />
        </label>
        <label className="grid gap-1 text-ui-sm">
          {intl.formatMessage({ id: "socialProject.settings.height" })}
          <Input
            type="number"
            min="16"
            max="8192"
            step="1"
            value={height}
            onChange={(event) => setHeight(event.currentTarget.value)}
            disabled={!canEdit || isWorking}
          />
        </label>
        <label className="grid gap-1 text-ui-sm">
          {intl.formatMessage({ id: "socialProject.settings.frameRate" })}
          <Input
            type="number"
            min="1"
            max="240"
            step="1"
            value={frameRate}
            onChange={(event) => setFrameRate(event.currentTarget.value)}
            disabled={!canEdit || isWorking}
          />
        </label>
        <label className="grid gap-1 text-ui-sm">
          {intl.formatMessage({ id: "socialProject.settings.background" })}
          <Input
            value={backgroundColor}
            onChange={(event) => setBackgroundColor(event.currentTarget.value)}
            disabled={!canEdit || isWorking}
            maxLength={7}
          />
        </label>
      </div>
      {invalid ? (
        <p className="text-ui-sm text-destructive" role="alert">
          {intl.formatMessage({ id: "socialProject.settings.invalid" })}
        </p>
      ) : null}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canEdit || isWorking}
          onClick={save}
        >
          {intl.formatMessage({ id: "socialProject.settings.save" })}
        </Button>
      </div>
    </section>
  );
}
