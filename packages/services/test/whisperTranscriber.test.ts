import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SocialMediaTranscriptionToolUnavailableError } from "../src/social-media/app/errors.js";
import {
  buildFfmpegTranscriptionArgs,
  buildWhisperCliArgs,
  createWhisperTranscriber,
} from "../src/social-media/adapters/whisperTranscriber.js";

test("transcription commands pass paths as arguments and use a strict primary language code", () => {
  const ffmpegArgs = buildFfmpegTranscriptionArgs({
    mediaPath: "/private/source with spaces.mp4",
    audioPath: "/private/job/audio.wav",
  });
  assert.ok(ffmpegArgs.includes("/private/source with spaces.mp4"));
  assert.ok(ffmpegArgs.includes("/private/job/audio.wav"));
  assert.ok(ffmpegArgs.includes("-ac"));
  assert.ok(ffmpegArgs.includes("-ar"));

  const whisperArgs = buildWhisperCliArgs({
    modelPath: "/private/model.bin",
    audioPath: "/private/audio.wav",
    outputBasePath: "/private/transcript",
    languageCode: "pt-BR",
  });
  assert.equal(whisperArgs[whisperArgs.indexOf("--language") + 1], "pt");
  const malformedLanguageArgs = buildWhisperCliArgs({
    modelPath: "/private/model.bin",
    audioPath: "/private/audio.wav",
    outputBasePath: "/private/transcript",
    languageCode: "pt-BR extra",
  });
  assert.equal(malformedLanguageArgs[malformedLanguageArgs.indexOf("--language") + 1], "auto");
});

test(
  "local Whisper transcriber validates process output and returns timed transcript segments",
  {
    skip: process.platform === "win32",
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "social-media-whisper-transcriber-"));
    try {
      const ffmpegPath = join(root, "fake-ffmpeg");
      const whisperPath = join(root, "fake-whisper");
      await writeFile(
        ffmpegPath,
        "#!/usr/bin/env node\nimport { writeFile } from 'node:fs/promises';\nawait writeFile(process.argv.at(-1), 'wav bytes');\n",
        { mode: 0o700 },
      );
      await writeFile(
        whisperPath,
        "#!/usr/bin/env node\nimport { writeFile } from 'node:fs/promises';\nconst args = process.argv.slice(2);\nconst prefix = args[args.indexOf('--output-file') + 1];\nawait writeFile(`${prefix}.vtt`, 'WEBVTT\\n\\n00:00.000 --> 00:01.250\\nLocal words\\n');\n",
        { mode: 0o700 },
      );
      await chmod(ffmpegPath, 0o700);
      await chmod(whisperPath, 0o700);
      const workingDirectory = join(root, "job");
      const task = createWhisperTranscriber({
        ffmpegExecutablePath: ffmpegPath,
        whisperExecutablePath: whisperPath,
      }).start({
        mediaPath: join(root, "source.mp4"),
        workingDirectory,
        modelPath: join(root, "model.bin"),
        modelId: "small",
        languageCode: "pt-BR",
        createdAt: 123,
      });

      assert.deepEqual(await task.completion, {
        method: "whisper-local",
        languageCode: "pt-BR",
        modelId: "small",
        segments: [{ startSeconds: 0, endSeconds: 1.25, text: "Local words" }],
        createdAt: 123,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("missing FFmpeg fails with an actionable transcription tool error", async () => {
  const root = await mkdtemp(join(tmpdir(), "social-media-whisper-tool-missing-"));
  try {
    const task = createWhisperTranscriber({
      ffmpegExecutablePath: join(root, "missing-ffmpeg"),
    }).start({
      mediaPath: join(root, "source.mp4"),
      workingDirectory: join(root, "job"),
      modelPath: join(root, "model.bin"),
      modelId: "small",
      languageCode: "pt-BR",
      createdAt: 123,
    });
    await assert.rejects(task.completion, SocialMediaTranscriptionToolUnavailableError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
