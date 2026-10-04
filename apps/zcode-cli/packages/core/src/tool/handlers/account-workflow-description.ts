import { FACADE_DTS } from "@social-harness/dynamic-workflow";
import type { ToolEntry } from "../types.js";

const descriptions: Readonly<Record<string, string>> = {
  ListSavedWorkflows:
    "List saved script recipes belonging to the current social account. Only this account's project scope is available. These are reusable definitions, not run history. Run an owned name with CreateWorkflow.saved; use ListWorkflowRuns for actual executions. No global definitions or other account files are visible.",
  SaveWorkflow:
    "Typecheck and save a reusable script recipe for the current account after the user approves the actual source and metadata. Use scope: project, a valid name, description, optional whenToUse/argument declarations, and inline script. Global scope and script_path are unavailable. Every creation or replacement requires approval. Saving a new version does not replace a version previously approved in a schedule.",
  CreateWorkflow: [
    "Run a social-account script recipe only when the user asks for a recipe or workflow. Pass exactly one inline script or saved: {name, scope: project, args}. The existing compiler validates it, then the user approves the actual script before execution. Filesystem paths and global recipes are unavailable.",
    "Use plain TypeScript control flow, phase markers and account-scoped agents with typed ask results. No imports, exports, Node APIs or fetch. Actors inherit this account's social tools and visible permissions; they cannot create nested workflows or widen their tools. Read SocialAgentGetContext for current profile, memory and policy. Media/project/export/publication commands retain Host ownership, revision checks and explicit publication approval. A request is not evidence of completed export or publication.",
    "files.*, git.*, world.run and artifact.file are unavailable and reject before side effects, even if they typecheck. Use actor social tools for owned facts and actions, and artifact.markdown/chart/table for in-memory deliverables. Source is stored in the run journal; no draft file is created. To revise a saved definition use SaveWorkflow with inline source. Return only confirmed outcomes and clear impediments.",
    "Facade declarations (the denied world/file operations remain unavailable for this account):",
    "```ts",
    FACADE_DTS.trim(),
    "```",
  ].join("\n\n"),
  ListWorkflowRuns:
    "List actual workflow runs in the current account, including its other conversations. This is run history, not saved recipes. Use GetWorkflowRun for progress and confirmed results. No runs from other accounts are visible.",
  GetWorkflowRun:
    "Read an instant snapshot of an actual workflow run belonging to this account: progress, confirmed results or failure. A foreign or unknown ID is unavailable. Another conversation's run is readable within the same account, but only its owning conversation can resume it.",
  ResumeWorkflowRun:
    "Resume a stopped workflow started by this conversation, under the same approved source, arguments and run ID. Finished work is replayed from the existing journal. Never resume a user-cancelled run without the user's request. Fix expired credentials or quota impediments before retrying. Another conversation's run must be continued in its owning conversation.",
  ResolveWorkflowQuestion:
    "Answer an actor's pending escalation in a workflow owned by this conversation. Preserve the user's authority over permission and publication decisions; never use this answer to bypass a denied Host action.",
};

/** 注册和刷新共用账户描述；不能用通用文件/命令指引诱导模型请求不存在的能力。 */
export function describeAccountWorkflowTool(entry: ToolEntry): ToolEntry {
  const description = descriptions[entry.metadata.name];
  return description ? { ...entry, metadata: { ...entry.metadata, description } } : entry;
}
