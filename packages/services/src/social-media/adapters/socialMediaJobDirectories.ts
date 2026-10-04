import { lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { socialMediaJobSchema, socialMediaSourceKeySchema } from "@social-harness/shared";

export async function createSocialMediaJobWorkingDirectory(
  jobsDirectory: string,
  jobId: string,
): Promise<string> {
  const validatedId = socialMediaJobSchema.shape.jobId.parse(jobId);
  await mkdir(jobsDirectory, { recursive: true, mode: 0o700 });
  const jobDirectory = join(jobsDirectory, validatedId);
  await mkdir(jobDirectory, { recursive: true, mode: 0o700 });
  const [jobsRoot, actualDirectory, directoryInfo] = await Promise.all([
    realpath(jobsDirectory),
    realpath(jobDirectory),
    lstat(jobDirectory),
  ]);
  if (
    !directoryInfo.isDirectory() ||
    directoryInfo.isSymbolicLink() ||
    dirname(actualDirectory) !== jobsRoot
  ) {
    throw new Error("Media job directory escaped its managed root");
  }
  return actualDirectory;
}

export async function cleanupSocialMediaJobWorkingDirectory(
  jobsDirectory: string,
  jobId: string,
): Promise<void> {
  await rm(join(jobsDirectory, socialMediaJobSchema.shape.jobId.parse(jobId)), {
    recursive: true,
    force: true,
  });
}

export async function discardSocialMediaNonResumableOutput(
  jobsDirectory: string,
  jobId: string,
  sourceKey: string,
): Promise<void> {
  const validatedJobId = socialMediaJobSchema.shape.jobId.parse(jobId);
  const validatedSourceKey = socialMediaSourceKeySchema.parse(sourceKey);
  const jobDirectory = join(jobsDirectory, validatedJobId);
  let directoryInfo;
  try {
    directoryInfo = await lstat(jobDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) {
    throw new Error("Media job directory is not a managed directory");
  }
  const [jobsRoot, actualDirectory] = await Promise.all([
    realpath(jobsDirectory),
    realpath(jobDirectory),
  ]);
  if (dirname(actualDirectory) !== jobsRoot) {
    throw new Error("Media job directory escaped its managed root");
  }
  const entries = await readdir(actualDirectory, { withFileTypes: true });
  await Promise.all(
    entries
      .filter(
        (entry) =>
          !entry.isDirectory() &&
          entry.name.startsWith(`${validatedSourceKey}.`) &&
          !entry.name.endsWith(".part"),
      )
      .map((entry) => rm(join(actualDirectory, entry.name), { force: true })),
  );
}
