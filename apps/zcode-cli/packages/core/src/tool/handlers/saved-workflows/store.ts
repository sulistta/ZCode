// 保存定义的唯一存储入口：异步读取先于审批投影，写入由同一路径锁和原子替换完成。
// 旧实现用同步 IO 支撑审批；resolveInput 已可异步归一化，无需阻塞 runtime 或另建审批路径。
import { readdir, readFile, rename, unlink, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  SAVED_WORKFLOW_FILE_EXTENSION,
  SAVED_WORKFLOW_MAX_NAME_CHARS,
  SavedWorkflowMetaSchema,
  isValidSavedWorkflowName,
  type SavedWorkflowEntry,
  type SavedWorkflowInvalidEntry,
  type SavedWorkflowMeta,
  type SavedWorkflowScope,
  type SavedWorkflowShadowing,
} from "@social-harness/contracts";
import { parseSavedWorkflow, serializeSavedWorkflow } from "./frontmatter.js";
import {
  assertAccountWorkflowSource,
  isAccountRecipeWorkspace,
  savedWorkflowPath,
  savedWorkflowRoot,
  savedWorkflowRoots,
  type SavedWorkflowRoot,
  type SavedWorkflowRootsOptions,
} from "./paths.js";
import {
  ensureSavedWorkflowRoot,
  isSavedWorkflowNotFound,
  readSavedWorkflowFile,
  savedWorkflowFileExists,
  withSavedWorkflowMutation,
  writeSavedWorkflowFile,
} from "./files.js";
export {
  assertAccountWorkflowSource,
  isAccountRecipeWorkspace,
  savedWorkflowFileName,
  savedWorkflowPath,
  savedWorkflowRoot,
  savedWorkflowRoots,
  type SavedWorkflowRoot,
  type SavedWorkflowRootsOptions,
} from "./paths.js";

interface LookupOptions extends SavedWorkflowRootsOptions {
  cwd: string;
  name: string;
  scope?: SavedWorkflowScope;
}

export interface ResolvedSavedWorkflow {
  name: string;
  path: string;
  scope: SavedWorkflowScope;
  meta: SavedWorkflowMeta;
  script: string;
  /** 文件原文；运行工作副本和审批使用同一次读取的字节。 */
  source: string;
  bodyLineOffset: number;
}
export type SavedWorkflowResolveFailure =
  | { ok: false; reason: "invalid_name"; detail: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "parse_error"; path: string; detail: string }
  | { ok: false; reason: "read_error"; path: string; detail: string };
export type SavedWorkflowResolveResult =
  | ({ ok: true } & ResolvedSavedWorkflow)
  | SavedWorkflowResolveFailure;
export interface SavedWorkflowListResult {
  entries: SavedWorkflowEntry[];
  invalid: SavedWorkflowInvalidEntry[];
}

const invalidNameDetail = `workflow names may only contain letters, digits, '.', '-' and '_', and must be 1-${SAVED_WORKFLOW_MAX_NAME_CHARS} characters`;

function rootsFor(options: Omit<LookupOptions, "name">): SavedWorkflowRoot[] {
  return options.scope === undefined
    ? savedWorkflowRoots(options.cwd, options)
    : [savedWorkflowRoot(options.cwd, options.scope, options)];
}

export async function resolveSavedWorkflow(
  options: LookupOptions,
): Promise<SavedWorkflowResolveResult> {
  if (!isValidSavedWorkflowName(options.name))
    return { ok: false, reason: "invalid_name", detail: invalidNameDetail };
  for (const root of rootsFor(options)) {
    const path = savedWorkflowPath(root, options.name);
    let source: string;
    try {
      await ensureSavedWorkflowRoot(root, options.cwd, options.workspaceIdentity);
      source = await readSavedWorkflowFile(path, options.workspaceIdentity);
    } catch (error) {
      if (isSavedWorkflowNotFound(error)) continue;
      return { ok: false, reason: "read_error", path, detail: describeError(error) };
    }
    const parsed = parseSavedWorkflow(source);
    if (!parsed.ok) return { ok: false, reason: "parse_error", path, detail: parsed.detail };
    return {
      ok: true,
      name: options.name,
      path,
      scope: root.scope,
      meta: parsed.meta,
      script: parsed.script,
      source,
      bodyLineOffset: parsed.bodyLineOffset,
    };
  }
  return { ok: false, reason: "not_found" };
}

export async function listSavedWorkflows(
  options: Omit<LookupOptions, "name">,
): Promise<SavedWorkflowListResult> {
  const entries: SavedWorkflowEntry[] = [];
  const invalid: SavedWorkflowInvalidEntry[] = [];
  const claimed = new Set<string>();
  for (const root of rootsFor(options)) {
    let names: string[];
    try {
      await ensureSavedWorkflowRoot(root, options.cwd, options.workspaceIdentity);
      names = await readdir(root.dir);
    } catch (error) {
      if (!isSavedWorkflowNotFound(error))
        invalid.push({ path: root.dir, reason: describeError(error) });
      continue;
    }
    for (const fileName of names.sort()) {
      if (!fileName.endsWith(SAVED_WORKFLOW_FILE_EXTENSION)) continue;
      const name = fileName.slice(0, -SAVED_WORKFLOW_FILE_EXTENSION.length);
      const path = join(root.dir, fileName);
      if (!isValidSavedWorkflowName(name)) {
        invalid.push({ path, reason: "file name is not a usable workflow name" });
        continue;
      }
      if (claimed.has(name)) continue;
      let source: string;
      try {
        source = await readSavedWorkflowFile(path, options.workspaceIdentity);
      } catch (error) {
        invalid.push({ path, reason: describeError(error) });
        continue;
      }
      const parsed = parseSavedWorkflow(source);
      if (!parsed.ok) {
        invalid.push({ path, reason: `${parsed.reason}: ${parsed.detail}` });
        continue;
      }
      claimed.add(name);
      entries.push({
        name,
        description: parsed.meta.description,
        ...(parsed.meta.whenToUse === undefined ? {} : { whenToUse: parsed.meta.whenToUse }),
        ...(parsed.meta.args === undefined ? {} : { args: parsed.meta.args }),
        scope: root.scope,
        path,
      });
    }
  }
  return { entries, invalid };
}

export async function saveSavedWorkflow(
  options: LookupOptions & { meta: SavedWorkflowMeta; script: string },
): Promise<{ path: string; scope: SavedWorkflowScope; overwritten: boolean }> {
  const root = savedWorkflowRoot(options.cwd, options.scope ?? "project", options);
  const path = savedWorkflowPath(root, options.name);
  const meta = SavedWorkflowMetaSchema.parse(options.meta);
  const source = serializeSavedWorkflow(meta, options.script);
  // 元数据中出现注释终止符也不能写出解析器读不回的定义。
  const parsed = parseSavedWorkflow(source);
  if (!parsed.ok) throw new Error(`Invalid saved workflow metadata: ${parsed.detail}`);
  return withSavedWorkflowMutation(path, async () => {
    const overwritten = await writeSavedWorkflowFile({
      root,
      path,
      cwd: options.cwd,
      source,
      workspaceIdentity: options.workspaceIdentity,
    });
    return { path, scope: root.scope, overwritten };
  });
}

export async function savedWorkflowExists(options: LookupOptions): Promise<boolean> {
  if (!isValidSavedWorkflowName(options.name)) return false;
  const root = savedWorkflowRoot(options.cwd, options.scope ?? "project", options);
  try {
    await ensureSavedWorkflowRoot(root, options.cwd, options.workspaceIdentity);
    return await savedWorkflowFileExists(
      savedWorkflowPath(root, options.name),
      options.workspaceIdentity,
    );
  } catch (error) {
    if (isSavedWorkflowNotFound(error)) return false;
    throw error;
  }
}

export async function findSavedWorkflowShadowing(
  options: LookupOptions & { scope: SavedWorkflowScope },
): Promise<SavedWorkflowShadowing | undefined> {
  assertAccountWorkflowSource(options.workspaceIdentity, { scope: options.scope });
  if (
    isAccountRecipeWorkspace(options.workspaceIdentity) ||
    !isValidSavedWorkflowName(options.name)
  )
    return undefined;
  const otherScope = options.scope === "project" ? "global" : "project";
  if (!(await savedWorkflowExists({ ...options, scope: otherScope }))) return undefined;
  return options.scope === "project" ? "hides_global" : "hidden_by_project";
}

export async function updateSavedWorkflowMeta(
  options: LookupOptions & { meta: SavedWorkflowMeta },
): Promise<{ ok: true; path: string } | SavedWorkflowResolveFailure> {
  const meta = SavedWorkflowMetaSchema.parse(options.meta);
  if (!isValidSavedWorkflowName(options.name))
    return { ok: false, reason: "invalid_name", detail: invalidNameDetail };
  const root = savedWorkflowRoot(options.cwd, options.scope ?? "project", options);
  const path = savedWorkflowPath(root, options.name);
  return withSavedWorkflowMutation(path, async () => {
    const resolved = await resolveSavedWorkflow({ ...options, scope: root.scope });
    if (!resolved.ok) return resolved;
    const source = serializeSavedWorkflow(meta, resolved.script);
    const parsed = parseSavedWorkflow(source);
    if (!parsed.ok) throw new Error(`Invalid saved workflow metadata: ${parsed.detail}`);
    await writeSavedWorkflowFile({
      root,
      path,
      cwd: options.cwd,
      source,
      workspaceIdentity: options.workspaceIdentity,
    });
    return { ok: true as const, path };
  });
}

export async function deleteSavedWorkflow(
  options: LookupOptions,
): Promise<{ ok: true; path: string } | SavedWorkflowResolveFailure> {
  if (!isValidSavedWorkflowName(options.name))
    return { ok: false, reason: "invalid_name", detail: invalidNameDetail };
  const root = savedWorkflowRoot(options.cwd, options.scope ?? "project", options);
  const path = savedWorkflowPath(root, options.name);
  return withSavedWorkflowMutation(path, async () => {
    try {
      await ensureSavedWorkflowRoot(root, options.cwd, options.workspaceIdentity);
      if (!(await savedWorkflowFileExists(path, options.workspaceIdentity)))
        return { ok: false as const, reason: "not_found" as const };
      await unlink(path);
    } catch (error) {
      if (isSavedWorkflowNotFound(error))
        return { ok: false as const, reason: "not_found" as const };
      return {
        ok: false as const,
        reason: "read_error" as const,
        path,
        detail: describeError(error),
      };
    }
    return { ok: true as const, path };
  });
}

export type SavedWorkflowMoveResult =
  | { ok: true; from: string; to: string }
  | { ok: false; reason: "invalid_name"; detail: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "target_exists"; path: string }
  | { ok: false; reason: "read_error" | "write_error"; path: string; detail: string };

export async function moveSavedWorkflow(
  options: Omit<LookupOptions, "scope">,
): Promise<SavedWorkflowMoveResult> {
  assertAccountWorkflowSource(options.workspaceIdentity, { scope: "global" });
  if (!isValidSavedWorkflowName(options.name))
    return { ok: false, reason: "invalid_name", detail: invalidNameDetail };
  const from = savedWorkflowPath(savedWorkflowRoot(options.cwd, "global", options), options.name);
  const root = savedWorkflowRoot(options.cwd, "project", options);
  const to = savedWorkflowPath(root, options.name);
  return withSavedWorkflowMutation(to, async () => {
    if (!(await savedWorkflowFileExists(from, undefined)))
      return { ok: false as const, reason: "not_found" as const };
    if (await savedWorkflowFileExists(to, undefined))
      return { ok: false as const, reason: "target_exists" as const, path: to };
    try {
      await mkdir(root.dir, { recursive: true });
      try {
        await rename(from, to);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
        const bytes = await readFile(from);
        await writeFile(to, bytes, { flag: "wx" });
        await unlink(from);
      }
      return { ok: true as const, from, to };
    } catch (error) {
      return {
        ok: false as const,
        reason: "write_error" as const,
        path: to,
        detail: describeError(error),
      };
    }
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
