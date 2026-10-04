import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import { isAccountRecipeWorkspace, type SavedWorkflowRoot } from "./paths.js";

const MAX_ACCOUNT_RECIPE_BYTES = 1024 * 1024;
const mutations = new Map<string, Promise<void>>();

/** 所有定义写入共用一个入口；不会把元数据更新变成第二个写所有者。 */
export async function withSavedWorkflowMutation<T>(
  path: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = mutations.get(path) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => {
    release = resolveGate;
  });
  const tail = previous.then(() => gate);
  mutations.set(path, tail);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (mutations.get(path) === tail) mutations.delete(path);
  }
}

export function isSavedWorkflowNotFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export async function ensureSavedWorkflowRoot(
  root: SavedWorkflowRoot,
  cwd: string,
  identity: string | undefined,
  create = false,
): Promise<void> {
  if (!isAccountRecipeWorkspace(identity)) {
    if (create) await mkdir(root.dir, { recursive: true });
    return;
  }
  const relativeRoot = relative(resolve(cwd), resolve(root.dir));
  if (!relativeRoot || relativeRoot.startsWith(`..${sep}`) || relativeRoot === "..")
    throw new Error("Account recipe root must be private.");
  let directory = resolve(cwd);
  const segments = ["", ...relativeRoot.split(sep)];
  for (const segment of segments) {
    directory = join(directory, segment);
    if (create && segment) {
      try {
        await mkdir(directory, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Account recipe directories must be private and cannot be symbolic links.");
  }
}

async function assertPrivateDefinition(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1)
    throw new Error("Account recipe files must be private regular files without symbolic links.");
  if (info.size > MAX_ACCOUNT_RECIPE_BYTES) throw new Error("Account recipe exceeds 1 MiB.");
}

export async function readSavedWorkflowFile(
  path: string,
  identity: string | undefined,
): Promise<string> {
  if (!isAccountRecipeWorkspace(identity)) return readFile(path, "utf8");
  await assertPrivateDefinition(path);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > MAX_ACCOUNT_RECIPE_BYTES)
      throw new Error("Account recipe must be a private file of at most 1 MiB.");
    const source = await handle.readFile("utf8");
    if (Buffer.byteLength(source) > MAX_ACCOUNT_RECIPE_BYTES)
      throw new Error("Account recipe exceeds 1 MiB.");
    return source;
  } finally {
    await handle.close();
  }
}

export async function savedWorkflowFileExists(
  path: string,
  identity: string | undefined,
): Promise<boolean> {
  try {
    if (isAccountRecipeWorkspace(identity)) await assertPrivateDefinition(path);
    else if (!(await lstat(path)).isFile()) return false;
    return true;
  } catch (error) {
    if (isSavedWorkflowNotFound(error)) return false;
    throw error;
  }
}

/** 同目录原子替换防止并发读取半份 frontmatter；失败不会破坏已保存的定义。 */
export async function writeSavedWorkflowFile(options: {
  root: SavedWorkflowRoot;
  cwd: string;
  path: string;
  source: string;
  workspaceIdentity?: string;
}): Promise<boolean> {
  if (
    isAccountRecipeWorkspace(options.workspaceIdentity) &&
    Buffer.byteLength(options.source) > MAX_ACCOUNT_RECIPE_BYTES
  )
    throw new Error("Account recipe exceeds 1 MiB.");
  await ensureSavedWorkflowRoot(options.root, options.cwd, options.workspaceIdentity, true);
  const overwritten = await savedWorkflowFileExists(options.path, options.workspaceIdentity);
  const temporary = `${options.path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(options.source, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await ensureSavedWorkflowRoot(options.root, options.cwd, options.workspaceIdentity);
    await savedWorkflowFileExists(options.path, options.workspaceIdentity);
    await rename(temporary, options.path);
  } finally {
    await unlink(temporary).catch((error: unknown) => {
      if (!isSavedWorkflowNotFound(error)) throw error;
    });
  }
  return overwritten;
}
