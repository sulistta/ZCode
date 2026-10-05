import {
  SavedWorkflowMetaSchema,
  isValidSavedWorkflowName,
  type SavedWorkflowScope,
} from "@social-harness/contracts";
import {
  approvedWorkflowSnapshotSchema,
  type ApprovedWorkflowSnapshot,
} from "@social-harness/shared";
import type { AnalyzeResult } from "@social-harness/dynamic-workflow";
import { analyzeScript } from "../workflow-script-analysis.js";
import { validateWorkflowArgs } from "./args.js";
import { serializeSavedWorkflow } from "./frontmatter.js";
import {
  isAccountRecipeWorkspace,
  savedWorkflowPath,
  savedWorkflowRoot,
  type SavedWorkflowRootsOptions,
} from "./paths.js";
import { resolveSavedWorkflow, type ResolvedSavedWorkflow } from "./store.js";

interface LaunchSourceOptions extends SavedWorkflowRootsOptions {
  cwd: string;
  name: string;
  scope?: SavedWorkflowScope;
  args?: Record<string, unknown>;
  approvedSnapshot?: ApprovedWorkflowSnapshot;
}

type LaunchSourceResult =
  | {
      ok: true;
      definition: ResolvedSavedWorkflow;
      args: Record<string, unknown>;
      analysis: AnalyzeResult;
    }
  | {
      ok: false;
      reason: "invalid_name" | "not_found" | "invalid_args" | "compile_failed";
      message: string;
    };
const COMPILE_DIAGNOSTICS_MAX_CHARS = 8_192;

/** The definition store remains the source owner; reviewed account launches use its codec by value. */
export async function resolveSavedWorkflowLaunch(
  options: LaunchSourceOptions,
): Promise<LaunchSourceResult> {
  let definition: ResolvedSavedWorkflow;
  let args: Record<string, unknown> | undefined;
  try {
    const account = isAccountRecipeWorkspace(options.workspaceIdentity);
    if (account || options.approvedSnapshot !== undefined) {
      if (!account || options.scope === "global" || options.args !== undefined) {
        return {
          ok: false,
          reason: "invalid_args",
          message: "Reviewed account recipes require account project scope and snapshot arguments.",
        };
      }
      const parsed = approvedWorkflowSnapshotSchema.safeParse(options.approvedSnapshot);
      if (!parsed.success || parsed.data.name !== options.name) {
        return {
          ok: false,
          reason: "invalid_args",
          message: "Review this account recipe's source and arguments before running it.",
        };
      }
      if (!isValidSavedWorkflowName(parsed.data.name)) {
        return { ok: false, reason: "invalid_name", message: "Invalid saved recipe name." };
      }
      const meta = SavedWorkflowMetaSchema.parse(parsed.data.meta);
      // 按名称重新读盘会执行审批后改过的脚本；账户启动只用用户审阅的字节，路径仅用于原有展示关联。
      definition = {
        name: parsed.data.name,
        scope: "project",
        path: savedWorkflowPath(
          savedWorkflowRoot(options.cwd, "project", options),
          parsed.data.name,
        ),
        meta,
        script: parsed.data.script,
        source: serializeSavedWorkflow(meta, parsed.data.script),
        bodyLineOffset: 0,
      };
      args = parsed.data.args;
    } else {
      const found = await resolveSavedWorkflow(options);
      if (!found.ok) {
        return {
          ok: false,
          reason: found.reason === "invalid_name" ? "invalid_name" : "not_found",
          message:
            found.reason === "invalid_name"
              ? `'${options.name}' is not a usable workflow name: ${found.detail}`
              : found.reason === "not_found"
                ? options.scope === undefined
                  ? `No saved workflow named '${options.name}' in this project or globally.`
                  : `No ${options.scope} workflow named '${options.name}'.`
                : `The saved workflow '${options.name}' at ${found.path} could not be read: ${found.detail}`,
        };
      }
      definition = found;
      args = options.args;
    }
  } catch {
    return {
      ok: false,
      reason: "invalid_args",
      message: "The account recipe source or workspace identity is invalid.",
    };
  }

  const validated = validateWorkflowArgs(definition.meta.args, args);
  if (!validated.ok) {
    return {
      ok: false,
      reason: "invalid_args",
      message: [
        `The arguments for saved workflow '${definition.name}' are not valid:`,
        ...validated.errors.map((error) => `- ${error}`),
      ]
        .join("\n")
        .slice(0, COMPILE_DIAGNOSTICS_MAX_CHARS),
    };
  }
  const analysis = analyzeScript(definition.script);
  if (!analysis.ok || analysis.diagnostics.length > 0) {
    const message = [
      `The saved workflow '${definition.name}' has errors:`,
      ...analysis.diagnostics.map(
        (diagnostic) => `L${diagnostic.line}:C${diagnostic.column} ${diagnostic.message}`,
      ),
    ]
      .join("\n")
      .slice(0, COMPILE_DIAGNOSTICS_MAX_CHARS);
    return { ok: false, reason: "compile_failed", message };
  }
  return { ok: true, definition, args: validated.args, analysis };
}
