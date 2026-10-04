import { createSocialProjectCandidateHandoffScenarios } from "./socialHarnessCandidateHandoffMockE2E.mjs";
import { exerciseSocialHarnessMediaIntake } from "./socialHarnessMediaIntakeE2E.mjs";
import { seedSocialProjectClipCandidateAssets } from "./socialProjectClipCandidateFixtureE2E.mjs";
import { seedSocialProjectVideoAsset } from "./socialProjectEffectsE2E.mjs";

export {
  createCandidateProjectsInElectron,
  verifySocialAgentCandidateHandoffsInElectron,
  verifySocialAgentCandidateProjectsAfterRelaunch as verifyCandidateProjectsAfterRelaunch,
} from "./socialProjectAgentEditingE2E.mjs";

export async function prepareAccountFixtures(input) {
  const { page, dataBaseDir, accountName, ffmpegExecutable, mediaIntakeFixtures, runId } = input;
  const mediaIntakeResult = await exerciseSocialHarnessMediaIntake(
    page,
    dataBaseDir,
    accountName,
    mediaIntakeFixtures,
  );
  const mediaFixture = await seedSocialProjectVideoAsset(
    dataBaseDir,
    accountName,
    ffmpegExecutable,
  );
  await seedSocialProjectClipCandidateAssets(dataBaseDir, accountName, ffmpegExecutable);
  return {
    mediaIntakeResult,
    mediaFixture,
    candidateHandoffs: createSocialProjectCandidateHandoffScenarios(runId),
  };
}
