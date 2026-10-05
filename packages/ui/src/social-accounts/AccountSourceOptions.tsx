import type { EditorialSource } from "./socialAccountsModel.js";
import { SOURCE_OPTIONS } from "./socialAccountsModel.js";
import { Checkbox } from "@/components/ui/checkbox.js";
import { Label } from "@/components/ui/label.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useId } from "react";

export function AccountSourceOptions({
  legend,
  selected,
  onToggle,
}: {
  legend: string;
  selected: EditorialSource[];
  onToggle: (source: EditorialSource, checked: boolean) => void;
}) {
  const { intl } = useZCodeIntl();
  const idPrefix = useId();
  return (
    <fieldset className="grid gap-3">
      <legend className="text-ui-base font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-3">
        {SOURCE_OPTIONS.map(({ value, labelId }) => (
          <div key={value} className="flex items-center gap-2 text-ui-sm text-foreground">
            <Checkbox
              id={`${idPrefix}-${value}`}
              checked={selected.includes(value)}
              onCheckedChange={(checked) => onToggle(value, checked === true)}
            />
            <Label className="text-ui-sm font-normal" htmlFor={`${idPrefix}-${value}`}>
              {intl.formatMessage({ id: labelId })}
            </Label>
          </div>
        ))}
      </div>
    </fieldset>
  );
}
