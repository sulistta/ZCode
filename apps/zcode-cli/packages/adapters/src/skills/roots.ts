import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { SkillRoot, SkillSource } from "@social-harness/contracts";

const GIT_MARKER = ".git";
const HOME_PREFIX = "~/";
const PRIORITY_STEP = 10;
const SKILLS_DIR = "skills";
const SOCIAL_HARNESS_DIR = ".zcode";
const AGENTS_DIR = ".agents";

export interface SkillRootResolutionOptions {
  homeDirectory?: string;
  dataBaseDir?: string;
  extraRoots?: string[];
  extraResolvedRoots?: SkillRoot[];
  includeZcodeSkills?: boolean;
}

export async function resolveDefaultSkillRoots(
  workingDirectory: string,
  options: SkillRootResolutionOptions = {},
): Promise<SkillRoot[]> {
  const resolvedWorkingDirectory = resolve(workingDirectory);
  const roots: SkillRoot[] = [];
  const includeZcode = options.includeZcodeSkills ?? true;
  const home = options.homeDirectory ?? homedir();
  const dataBaseDir =
    options.dataBaseDir?.trim() || process.env.SOCIAL_HARNESS_DATA_BASE_DIR?.trim() || home;
  let priority = 0;
  const nextPriority = () => {
    priority += PRIORITY_STEP;
    return priority;
  };

  for (const extraRoot of options.extraRoots ?? []) {
    roots.push(
      root(
        resolveConfiguredRoot(extraRoot, resolvedWorkingDirectory),
        "project",
        "zcode",
        nextPriority(),
      ),
    );
  }

  if (includeZcode) {
    roots.push(...skillRootsForBase(dataBaseDir, "user", nextPriority, home));
  }

  const projectDirectories = await resolveProjectSkillDirectories(resolvedWorkingDirectory);
  for (const directory of projectDirectories) {
    if (includeZcode) {
      roots.push(...skillRootsForBase(directory, "project", nextPriority));
    }
  }

  roots.push(...(options.extraResolvedRoots ?? []));

  return roots;
}

async function resolveProjectSkillDirectories(workingDirectory: string): Promise<string[]> {
  const worktreeRoot = await findWorktreeRoot(workingDirectory);
  if (!worktreeRoot) return [workingDirectory];

  const directories: string[] = [];
  let current = workingDirectory;
  while (true) {
    directories.push(current);
    if (current === worktreeRoot || current === dirname(current)) break;
    current = dirname(current);
  }
  return directories;
}

async function findWorktreeRoot(workingDirectory: string): Promise<string | null> {
  let current = workingDirectory;
  while (true) {
    if (await pathExists(join(current, GIT_MARKER))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function skillRootsForBase(
  baseDirectory: string,
  scope: SkillRoot["scope"],
  nextPriority: () => number,
  compatibilityBaseDirectory = baseDirectory,
): SkillRoot[] {
  const productSkillRoot =
    scope === "user"
      ? join(baseDirectory, ".social-harness", "v1", SKILLS_DIR)
      : join(baseDirectory, SOCIAL_HARNESS_DIR, SKILLS_DIR);
  // Global Social Harness skills and compatible ~/.agents skills remain separate sources.
  return [
    root(productSkillRoot, scope, "zcode", nextPriority()),
    root(join(compatibilityBaseDirectory, AGENTS_DIR, SKILLS_DIR), scope, "agents", nextPriority()),
  ];
}

function root(
  path: string,
  scope: SkillRoot["scope"],
  source: SkillSource,
  priority: number,
): SkillRoot {
  return {
    path: resolve(path),
    scope,
    source,
    priority,
  };
}

function resolveConfiguredRoot(path: string, workingDirectory: string): string {
  const expanded = path.startsWith(HOME_PREFIX)
    ? join(homedir(), path.slice(HOME_PREFIX.length))
    : path;
  return isAbsolute(expanded) ? expanded : resolve(workingDirectory, expanded);
}
