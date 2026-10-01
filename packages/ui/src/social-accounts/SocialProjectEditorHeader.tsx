import type { SocialProjectCommandRequest } from "@social-harness/shared";
import type { SocialProjectReadModel } from "@social-harness/services";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

type Operation = SocialProjectCommandRequest["operation"];

export function SocialProjectEditorHeader({
  readModel,
  projectName,
  onProjectNameChange,
  canEdit,
  isWorking,
  error,
  notice,
  onExecute,
  onSaveName,
}: {
  readModel: SocialProjectReadModel;
  projectName: string;
  onProjectNameChange: (name: string) => void;
  canEdit: boolean;
  isWorking: boolean;
  error: string | null;
  notice: string | null;
  onExecute: (operation: Operation) => Promise<void>;
  onSaveName: () => void;
}) {
  const { intl } = useZCodeIntl();
  const { project, canUndo, canRedo } = readModel;

  return (
    <>
      <section className="grid gap-3 rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "socialProject.revision" }, { revision: project.revision })}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <span className={`size-2 rounded-full ${canEdit ? "bg-success" : "bg-warning"}`} />
              <span className="text-ui-sm">
                {intl.formatMessage({
                  id: canEdit ? "socialProject.control.user" : "socialProject.control.agent",
                })}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isWorking}
                onClick={() => void onExecute({ type: "return-to-agent" })}
              >
                {intl.formatMessage({ id: "socialProject.control.return" })}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={isWorking}
                onClick={() => void onExecute({ type: "take-control" })}
              >
                {intl.formatMessage({ id: "socialProject.control.take" })}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canEdit || !canUndo || isWorking}
              onClick={() => void onExecute({ type: "undo" })}
            >
              {intl.formatMessage({ id: "socialProject.undo" })}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canEdit || !canRedo || isWorking}
              onClick={() => void onExecute({ type: "redo" })}
            >
              {intl.formatMessage({ id: "socialProject.redo" })}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-56 flex-1 gap-1 text-ui-sm">
            {intl.formatMessage({ id: "socialProject.name" })}
            <Input
              value={projectName}
              onChange={(event) => onProjectNameChange(event.currentTarget.value)}
              disabled={!canEdit || isWorking}
              maxLength={160}
            />
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!canEdit || isWorking || !projectName.trim()}
            onClick={onSaveName}
          >
            {intl.formatMessage({ id: "socialProject.saveName" })}
          </Button>
        </div>
        {!canEdit ? (
          <p className="text-ui-sm text-foreground-subtle">
            {intl.formatMessage({ id: "socialProject.control.takeFirst" })}
          </p>
        ) : null}
      </section>
      {error ? (
        <p
          className="rounded-md border border-destructive/30 bg-card px-3 py-2 text-ui-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          className="rounded-md border border-success/30 bg-card px-3 py-2 text-ui-sm text-success"
          role="status"
        >
          {notice}
        </p>
      ) : null}
    </>
  );
}
