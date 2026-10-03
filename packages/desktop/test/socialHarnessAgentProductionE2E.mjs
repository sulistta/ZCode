import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { sendSocialAgentPrompt } from "./socialProjectAgentEditingE2E.mjs";

export function planSocialProductionResponse(body, scenario, calls) {
  const messages = body.messages ?? [];
  const start = messages.findLastIndex(
    (message) => message.role === "user" && JSON.stringify(message).includes(scenario.marker),
  );
  const toolNames = new Map(
    messages.flatMap((message) =>
      (message.tool_calls ?? []).map((call) => [call.id, call.function.name]),
    ),
  );
  const results = messages
    .slice(start)
    .filter((message) => message.role === "tool")
    .map((message) => {
      const raw =
        typeof message.content === "string"
          ? message.content
          : message.content?.find((item) => item.type === "text")?.text;
      let content;
      try {
        content = JSON.parse(raw);
      } catch {
        content = raw;
      }
      return { name: message.name ?? toolNames.get(message.tool_call_id), content };
    });
  const result = (name) => results.findLast((item) => item.name === name)?.content;
  const call = (name, args) => {
    assert.ok(
      body.tools.some((tool) => tool.function?.name === name),
      `Missing production tool ${name}`,
    );
    calls.push({ name, args });
    return {
      toolCalls: [
        {
          id: `call_production_${calls.length}`,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    };
  };
  if (!result("SocialAgentGetContext")) return call("SocialAgentGetContext", {});
  if (!result("SocialMediaList")) return call("SocialMediaList", {});
  if (!result("SocialMediaImportUrl")) {
    assert.equal(
      result("SocialMediaList").assets.length,
      0,
      "Production starts with an empty library",
    );
    assert.equal(
      result("SocialAgentGetContext").context.projects.length,
      0,
      "Production starts without projects",
    );
    return call("SocialMediaImportUrl", { url: "https://www.youtube.com/watch?v=SHE2E000002" });
  }
  const admitted = result("SocialMediaImportUrl").job;
  const latestJobResult = results.findLast(
    (item) => item.name === "SocialMediaJobs" || item.name === "SocialMediaJobCommand",
  );
  const job = latestJobResult?.content?.jobs?.[0] ?? latestJobResult?.content?.job;
  if (!job) return call("SocialMediaJobs", { jobId: admitted.jobId });
  if (!job.mediaId) {
    if (job.state === "failed") {
      assert.ok(
        !result("SocialMediaJobCommand"),
        "The isolated download may require only one retry",
      );
      return call("SocialMediaJobCommand", { jobId: job.jobId, action: "retry" });
    }
    return call("SocialMediaJobs", { jobId: job.jobId });
  }
  const media = result("SocialMediaList").assets.find((asset) => asset.mediaId === job.mediaId);
  if (!media) return call("SocialMediaList", {});
  if (!result("SocialClipCandidates"))
    return call("SocialClipCandidates", { mediaId: media.mediaId, mode: "music" });
  const candidate = result("SocialClipCandidates").result.candidates[0];
  assert.ok(candidate, "Production must use actual measured candidate evidence");
  if (!result("SocialProjectCreate"))
    return call("SocialProjectCreate", { displayName: scenario.projectName });
  const created = result("SocialProjectCreate").project;
  if (!result("SocialProjectRead"))
    return call("SocialProjectRead", { projectId: created.projectId });
  const project = result("SocialProjectRead").project.project;
  if (!result("SocialProjectCommand"))
    return call("SocialProjectCommand", {
      projectId: project.projectId,
      expectedRevision: project.revision,
      operation: {
        type: "put-clip",
        trackId: project.tracks.find((track) => track.type === "video").trackId,
        clip: {
          clipId: "production-clip",
          kind: "video",
          mediaId: media.mediaId,
          timelineStartMs: 0,
          sourceStartMs: Math.round(candidate.startSeconds * 1000),
          sourceEndMs: Math.round(candidate.endSeconds * 1000),
          playbackRate: 1,
          volume: 1,
          keyframes: [],
        },
      },
    });
  const edited = result("SocialProjectCommand").result.project;
  if (!result("SocialProjectExport"))
    return call("SocialProjectExport", {
      projectId: edited.projectId,
      expectedRevision: edited.revision,
    });
  const exportJob = result("SocialProjectExport").job;
  const exported = result("SocialProjectExports")?.jobs?.[0];
  if (!exported || exported.status === "queued" || exported.status === "rendering")
    return call("SocialProjectExports", { exportId: exportJob.exportId });
  assert.equal(exported.status, "completed", "Publication requires a completed real export");
  if (!result("SocialPublicationRequest"))
    return call("SocialPublicationRequest", {
      exportId: exported.exportId,
      caption: "Isolated measured music candidate",
    });
  assert.equal(result("SocialPublicationRequest").publication.status, "approval-required");
  return { content: scenario.finalResponseText };
}

export async function verifySocialAgentProductionInElectron(
  page,
  { scenario, mockProvider, dataBaseDir, firstAccountName, runId },
) {
  const name = `Production pilot ${runId}`;
  await page.getByRole("button", { name: "Accounts", exact: true }).click();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Account name").fill(name);
  await page.getByLabel("Niche").fill("Measured music clips");
  await page.getByLabel("Audience").fill("Music listeners");
  await page.getByLabel("Visual style").fill("Minimal captions");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await page.getByRole("heading", { level: 1, name, exact: true }).waitFor();
  await sendSocialAgentPrompt(page, {
    marker: scenario.marker,
    promptText: `${scenario.marker}: prepare a music Reel from the supplied source, export it and request supervised review.`,
    responseText: scenario.finalResponseText,
    approveToolNames: [
      "SocialMediaImportUrl",
      "SocialMediaJobCommand",
      "SocialProjectCreate",
      "SocialProjectCommand",
      "SocialProjectExport",
      "SocialPublicationRequest",
    ],
  });
  const names = mockProvider.productionToolCalls.map((call) => call.name);
  for (const required of [
    "SocialMediaImportUrl",
    "SocialMediaJobs",
    "SocialMediaJobCommand",
    "SocialClipCandidates",
    "SocialProjectCreate",
    "SocialProjectCommand",
    "SocialProjectExport",
    "SocialProjectExports",
    "SocialPublicationRequest",
  ])
    assert.ok(names.includes(required), `Production must exercise ${required}`);
  const root = join(dataBaseDir, ".social-harness", "v1");
  const accounts = JSON.parse(await readFile(join(root, "social-accounts/accounts.json"), "utf8"));
  const account = accounts.find((item) => item.displayName === name);
  const catalog = JSON.parse(await readFile(join(root, "social-media/catalog.json"), "utf8"));
  assert.equal(catalog.assets.filter((asset) => asset.accountId === account.accountId).length, 1);
  assert.equal(catalog.jobs.filter((job) => job.accountId === account.accountId).length, 1);
  await page.getByRole("button", { name: "Player", exact: true }).click();
  await page.getByRole("button", { name: scenario.projectName, exact: true }).click();
  await page
    .getByText("Automation proposal. Review the caption and export, then approve publishing.", {
      exact: true,
    })
    .waitFor();
  await page
    .locator('[aria-label="Accounts"]')
    .getByRole("button", { name: firstAccountName })
    .click();
  console.log(
    "[social-e2e] Agent imported into empty account, retried actual failure, analyzed, created/edited/exported and requested supervised approval",
  );
}
