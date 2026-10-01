import { cloneElement, useId } from "react";
import type { ReactElement, ReactNode } from "react";
import { Label } from "@/components/ui/label.js";

export function AccountField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  const describedBy = hint ? `${id}-hint` : undefined;
  return (
    <div className="grid content-start gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {hint ? (
        <p id={describedBy} className="text-ui-sm text-foreground-subtle">
          {hint}
        </p>
      ) : null}
      {cloneElement(children as ReactElement<{ id?: string; "aria-describedby"?: string }>, {
        id,
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
      })}
    </div>
  );
}
