import { spawn } from "node:child_process";
import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";
import { convexDeploymentUrlSchema } from "@social-harness/shared";
import type { InstagramConvexProvisioner } from "../app/ports/instagramBridgeSetup.js";
import { SocialPublishingError } from "../app/socialPublishingError.js";
const allowedActions = [
  "deployment:deploy",
  "deployment:env:write",
  "deployment:data:view",
  "deployment:functions:runInternalQueries",
  "deployment:functions:runInternalMutations",
];
const bridgeFunctions = new Set([
  ...[
    "bootstrap",
    "status",
    "authorize",
    "claimCallback",
    "finishCallback",
    "redeem",
    "revoke",
    "beginUpload",
    "finalizeUpload",
    "deleteLease",
    "expireLease",
    "sweep",
  ].map((name) => `bridge:${name}`),
  ...["beginUpload", "finalizeUpload", "deleteLease", "expireLease", "sweep"].map(
    (name) => `media:${name}`,
  ),
]);
function safeFailure(output: string): SocialPublishingError {
  if (
    /^(402|429|507)\b|quota|capacity|limit exceeded|resource.*limit|deployment.*disabled/iu.test(
      output,
    )
  )
    return new SocialPublishingError(
      "capacity-unavailable",
      "Convex capacity is unavailable. Check team Usage and retry.",
    );
  if (/^(401|403)\b|unauthorized|forbidden|invalid.*key|authentication|permission/iu.test(output))
    return new SocialPublishingError(
      "invalid-provisioning-credential",
      "The provisioning credential is invalid or lacks the required permissions.",
    );
  return new SocialPublishingError(
    "bridge-deployment-failed",
    "Convex deployment failed. Check your project and retry.",
  );
}
export function createInstagramConvexProvisioner(options: {
  assetsDir: string;
  fetcher?: typeof fetch;
  executable?: string;
  runCli?: (args: string[], cwd: string, credential: string) => Promise<string>;
}): InstagramConvexProvisioner {
  const fetcher = options.fetcher ?? fetch;
  async function management(path: string, credential: string, body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetcher(`https://api.convex.dev/v1${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new SocialPublishingError(
        "bridge-deployment-failed",
        "Convex could not confirm provisioning. Retry to reconcile the dedicated project.",
      );
    }
    if (!response.ok) throw safeFailure(`${response.status} ${await response.text()}`);
    try {
      return await response.json();
    } catch {
      throw safeFailure("invalid-management-response");
    }
  }
  const runCli =
    options.runCli ??
    ((args, cwd, credential) =>
      new Promise<string>((resolve, reject) => {
        const child = spawn(
          options.executable ?? process.execPath,
          [join(options.assetsDir, "node_modules", "convex", "bin", "main.js"), ...args],
          {
            cwd,
            env: {
              ...process.env,
              ELECTRON_RUN_AS_NODE: "1",
              CI: "1",
              CONVEX_DEPLOY_KEY: credential,
              CONVEX_DEPLOYMENT: "",
              CONVEX_URL: "",
              CONVEX_SELF_HOSTED_URL: "",
              CONVEX_SELF_HOSTED_ADMIN_KEY: "",
            },
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
            timeout: 180_000,
          },
        );
        let output = "";
        let errorOutput = "";
        child.stdout.on("data", (data: Buffer) => {
          output = (output + data.toString()).slice(-262_144);
        });
        child.stderr.on("data", (data: Buffer) => {
          errorOutput = (errorOutput + data.toString()).slice(-16_384);
        });
        child.on("error", () => reject(safeFailure("bundled-runtime-unavailable")));
        child.on("close", (code) => {
          if (code === 0) resolve(output);
          else reject(safeFailure(errorOutput));
        });
      }));
  return {
    async createProject(input) {
      const token = z
        .object({ teamId: z.number().int(), type: z.literal("teamToken") })
        .parse(await management("/token_details", input.provisioningCredential));
      const projectPage = z
        .object({
          items: z.array(z.object({ id: z.number().int(), name: z.string() })),
          pagination: z.object({ hasMore: z.boolean() }),
        })
        .parse(
          await management(
            `/teams/${token.teamId}/projects?q=${encodeURIComponent(input.projectName)}&limit=100`,
            input.provisioningCredential,
          ),
        );
      if (projectPage.pagination.hasMore)
        throw new SocialPublishingError(
          "bridge-not-dedicated",
          "Use a unique dedicated project name or select the existing deployment.",
        );
      const existing = projectPage.items.filter((p) => p.name === input.projectName);
      if (existing.length > 1)
        throw new SocialPublishingError(
          "bridge-not-dedicated",
          "Choose one dedicated project in the dashboard.",
        );
      let deploymentUrl: string;
      let deploymentName: string;
      if (existing[0]) {
        const deployment = z
          .object({ name: z.string(), deploymentUrl: convexDeploymentUrlSchema })
          .parse(
            await management(
              `/projects/${existing[0].id}/deployment?defaultProd=true`,
              input.provisioningCredential,
            ),
          );
        deploymentName = deployment.name;
        deploymentUrl = deployment.deploymentUrl;
      } else {
        const project = z
          .object({ deploymentName: z.string(), deploymentUrl: convexDeploymentUrlSchema })
          .parse(
            await management(
              `/teams/${token.teamId}/create_project`,
              input.provisioningCredential,
              {
                projectName: input.projectName,
                deploymentType: "prod",
                deploymentClass: "S16",
              },
            ),
          );
        deploymentName = project.deploymentName;
        deploymentUrl = project.deploymentUrl;
      }
      const key = z.object({ deployKey: z.string().min(20) }).parse(
        await management(
          `/deployments/${encodeURIComponent(deploymentName)}/create_deploy_key`,
          input.provisioningCredential,
          {
            name: "Social Harness temporary provisioning",
            allowedActions,
            expiresAt: Date.now() + 7_200_000,
          },
        ),
      );
      return { deploymentUrl, deployKey: key.deployKey };
    },
    async configureMeta(input) {
      let response: Response;
      try {
        response = await fetcher(
          `${new URL(input.deploymentUrl).origin}/api/update_environment_variables`,
          {
            method: "POST",
            headers: {
              authorization: `Convex ${input.deployKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              changes: [
                { name: "META_INSTAGRAM_APP_ID", value: input.appId },
                { name: "META_INSTAGRAM_APP_SECRET", value: input.appSecret },
              ],
            }),
            redirect: "error",
            signal: AbortSignal.timeout(30_000),
          },
        );
      } catch {
        throw safeFailure("environment-update-failed");
      }
      if (!response.ok) throw safeFailure(`${response.status} ${await response.text()}`);
    },
    async deploy(input) {
      const workspace = await mkdtemp(join(tmpdir(), "social-harness-convex-"));
      try {
        await cp(join(options.assetsDir, "template"), workspace, { recursive: true });
        await symlink(
          join(options.assetsDir, "node_modules"),
          join(workspace, "node_modules"),
          process.platform === "win32" ? "junction" : "dir",
        );
        const spec = z
          .object({
            url: convexDeploymentUrlSchema,
            functions: z.array(z.object({ identifier: z.string() })),
          })
          .parse(JSON.parse(await runCli(["function-spec"], workspace, input.deployKey)));
        if (new URL(spec.url).origin !== new URL(input.deploymentUrl).origin)
          throw new SocialPublishingError(
            "invalid-provisioning-credential",
            "The deployment URL does not match this key.",
          );
        if (spec.functions.some((fn) => !bridgeFunctions.has(fn.identifier.replace(/\.js:/u, ":"))))
          throw new SocialPublishingError(
            "bridge-not-dedicated",
            "This deployment contains unrelated functions. Use a dedicated empty project.",
          );
        const tables = (await runCli(["data"], workspace, input.deployKey))
          .trim()
          .split(/\r?\n/u)
          .filter(Boolean);
        if (
          tables.some(
            (table) =>
              !["installations", "flows", "tickets", "credentials", "leases"].includes(table),
          )
        )
          throw new SocialPublishingError(
            "bridge-not-dedicated",
            "This deployment contains unrelated data. Use a dedicated empty project.",
          );
        await runCli(
          ["deploy", "--yes", "--typecheck", "disable", "--codegen", "disable"],
          workspace,
          input.deployKey,
        );
        // 管理凭据仅通过子进程环境传递；输出不进入 Host 日志或 Renderer。
        await runCli(
          [
            "run",
            "bridge:bootstrap",
            JSON.stringify({ credentialHash: input.installationCredentialHash }),
          ],
          workspace,
          input.deployKey,
        );
      } finally {
        await rm(workspace, { recursive: true, force: true });
      }
    },
  };
}
