import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildYtDlpYouTubeSearchArgs,
  createYtDlpYouTubeSearchAdapter,
  parseYtDlpYouTubeSearchOutput,
} from "../src/social-media/adapters/ytDlpYouTubeSearch.js";
import {
  buildYtDlpChildEnvironment,
  resolveYtDlpCommand,
} from "../src/social-media/adapters/ytDlpRuntime.js";
import { buildYtDlpSourceDownloadArgs } from "../src/social-media/adapters/ytDlpSourceDownload.js";
import { SocialMediaYouTubeSearchUnavailableError } from "../src/social-media/app/errors.js";

test("yt-dlp search requests bounded flat metadata and skips downloads", () => {
  const args = buildYtDlpYouTubeSearchArgs("podcasts about design");
  assert.deepEqual(args, [
    "--ignore-config",
    "--js-runtimes",
    `node:${process.execPath}`,
    "--no-warnings",
    "--no-progress",
    "--no-cache-dir",
    "--flat-playlist",
    "--dump-single-json",
    "--skip-download",
    "--playlist-end",
    "10",
    "ytsearch10:podcasts about design",
  ]);
});

test("yt-dlp download explicitly uses the Host JavaScript runtime", () => {
  const args = buildYtDlpSourceDownloadArgs({
    sourceKey: "abcDEF_1234",
    sourceUrl: "https://www.youtube.com/watch?v=abcDEF_1234",
    workingDirectory: "/tmp/social-harness-test",
    language: "pt-BR",
    proxyUrl: "http://127.0.0.1:43210",
  });
  const runtimeIndex = args.indexOf("--js-runtimes");
  assert.notEqual(runtimeIndex, -1);
  assert.equal(args[runtimeIndex + 1], `node:${process.execPath}`);
});

test("yt-dlp source downloads use a loopback proxy for supported HTTPS URLs", () => {
  const sourceUrl = "https://cdn.example.test/interview.mp4";
  const sourceKey = `url-${createHash("sha256").update(sourceUrl).digest("hex")}`;
  const args = buildYtDlpSourceDownloadArgs({
    sourceKey,
    sourceUrl,
    workingDirectory: "/tmp/social-harness-test",
    language: "pt-BR",
    proxyUrl: "http://127.0.0.1:43210",
  });
  const proxyIndex = args.indexOf("--proxy");
  assert.notEqual(proxyIndex, -1);
  assert.equal(args[proxyIndex + 1], "http://127.0.0.1:43210");
  assert.equal(args.at(-1), sourceUrl);
  assert.ok(args.includes("--no-playlist"));
});

test("yt-dlp enables Electron's embedded Node runtime only for Electron child processes", () => {
  const source = { PATH: "/app/bin", ELECTRON_RUN_AS_NODE: "0" };
  assert.deepEqual(buildYtDlpChildEnvironment(source, true), {
    PATH: "/app/bin",
    ELECTRON_RUN_AS_NODE: "1",
  });
  assert.deepEqual(buildYtDlpChildEnvironment(source, false), { PATH: "/app/bin" });
});

test("yt-dlp development fixtures run as scripts under the Host Node executable", () => {
  const scriptPath = join(tmpdir(), "social harness yt-dlp fixture.mjs");
  const nodeExecutablePath = join(tmpdir(), "host-node");
  assert.deepEqual(resolveYtDlpCommand(scriptPath, nodeExecutablePath), {
    executable: nodeExecutablePath,
    argsPrefix: [scriptPath],
  });
  assert.deepEqual(resolveYtDlpCommand("yt-dlp", nodeExecutablePath), {
    executable: "yt-dlp",
    argsPrefix: [],
  });
});

test("yt-dlp output keeps validated metadata and leaves missing fields unavailable", () => {
  const results = parseYtDlpYouTubeSearchOutput(
    JSON.stringify({
      entries: [
        {
          id: "abcDEF_1234",
          title: "  A useful video  ",
          channel: "Channel",
          duration: 82.5,
          view_count: 12,
          upload_date: "20240229",
          url: "https://attacker.invalid/video",
        },
        {
          id: "bad-id",
          title: "Invalid ID",
        },
        {
          id: "abcDEF_1235",
          title: "No optional metadata",
          upload_date: "20230229",
        },
      ],
    }),
  );

  assert.deepEqual(results, [
    {
      videoId: "abcDEF_1234",
      videoUrl: "https://www.youtube.com/watch?v=abcDEF_1234",
      title: "A useful video",
      channel: "Channel",
      durationSeconds: 82.5,
      viewCount: 12,
      uploadDate: "2024-02-29",
    },
    {
      videoId: "abcDEF_1235",
      videoUrl: "https://www.youtube.com/watch?v=abcDEF_1235",
      title: "No optional metadata",
      channel: null,
      durationSeconds: null,
      viewCount: null,
      uploadDate: null,
    },
  ]);
});

test("missing yt-dlp is reported as a retryable unavailable search", async () => {
  const adapter = createYtDlpYouTubeSearchAdapter({
    executablePath: "social-harness-missing-yt-dlp-for-test",
  });
  await assert.rejects(adapter.search("a query", 10), SocialMediaYouTubeSearchUnavailableError);
});
