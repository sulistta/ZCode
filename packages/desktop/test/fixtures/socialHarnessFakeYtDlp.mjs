import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFile, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const callsPath = fileURLToPath(new URL("./calls.ndjson", import.meta.url));
const searchArgument = args.find((argument) => argument.startsWith("ytsearch"));

if (searchArgument) {
  const query = searchArgument.slice(searchArgument.indexOf(":") + 1);
  await appendFile(callsPath, JSON.stringify({ type: "search", query }) + "\n");
  const entries = [
    { id: "malformed-id", title: "Omitted malformed result" },
    ...Array.from({ length: 12 }, (_, index) => ({
      id: "SHE2E" + String(index + 1).padStart(6, "0"),
      title: "Fixture search result " + (index + 1),
      channel: "Local fixture channel",
      duration: 120,
      view_count: 42,
      upload_date: "20260929",
    })),
    { id: "SHE2E000001", title: "Omitted duplicate result" },
  ];
  process.stdout.write(JSON.stringify({ entries }));
} else {
  const sourceUrl = args.at(-1);
  let videoId;
  try {
    videoId = new URL(sourceUrl).searchParams.get("v");
  } catch {
    videoId = null;
  }
  const sourceKey = videoId ?? `url-${createHash("sha256").update(sourceUrl).digest("hex")}`;
  const proxyIndex = args.indexOf("--proxy");
  const proxy = args[proxyIndex + 1];
  if (!proxy || !/^http:\/\/127\.0\.0\.1:\d+$/.test(proxy)) {
    throw new Error("Expected yt-dlp to use the loopback public HTTPS proxy");
  }

  const attemptsPath = fileURLToPath(
    new URL(`./download-attempts-${sourceKey}.txt`, import.meta.url),
  );
  const previousAttempts = await readFile(attemptsPath, "utf8").catch(() => "0");
  const attempt = Number.parseInt(previousAttempts, 10) + 1;
  await writeFile(attemptsPath, String(attempt));
  await appendFile(
    callsPath,
    JSON.stringify({
      type: "download",
      ...(videoId ? { videoId } : { sourceKey }),
      attempt,
      proxy: true,
    }) + "\n",
  );

  if (attempt === 1) {
    process.stderr.write("Local fixture asks for one explicit retry.\n");
    process.exitCode = 1;
  } else {
    const outputTemplates = args.flatMap((argument, index) =>
      argument === "--output" ? [args[index + 1]] : [],
    );
    const templateFor = (kind) =>
      kind === "video"
        ? outputTemplates.find((template) => !/^(infojson|subtitle):/.test(template))
        : outputTemplates.find((template) => template.startsWith(kind + ":"));
    const resolveOutput = (kind, extension, language) => {
      const template = templateFor(kind);
      if (!template) throw new Error("Missing output template for " + kind);
      return template
        .slice(kind === "video" ? 0 : kind.length + 1)
        .replaceAll("%(id)s", sourceKey)
        .replaceAll("%(language)s", language || "")
        .replaceAll("%(ext)s", extension);
    };
    const mediaPath = resolveOutput("video", "mp4");
    const infoPath = resolveOutput("infojson", "info.json");
    const subtitlePath = resolveOutput("subtitle", "vtt", "en");
    await mkdir(fixtureDirectory, { recursive: true });
    await mkdir(dirname(mediaPath), { recursive: true });
    if (videoId === "SHE2E000002") {
      const ffmpeg = args[args.indexOf("--ffmpeg-location") + 1];
      if (!ffmpeg) throw new Error("The production fixture requires the resolved bundled FFmpeg");
      const child = spawn(
        ffmpeg,
        [
          "-v",
          "error",
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=blue:s=64x64:r=30",
          "-f",
          "lavfi",
          "-i",
          "sine=frequency=440:sample_rate=48000",
          "-t",
          "20",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          mediaPath,
        ],
        { stdio: "ignore", windowsHide: true },
      );
      const code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      if (code !== 0) throw new Error("Could not generate the isolated production source");
    } else await writeFile(mediaPath, Buffer.from("Local fake yt-dlp MP4 fixture.\n"));
    await writeFile(
      infoPath,
      JSON.stringify({
        ...(videoId ? { id: videoId } : {}),
        title: videoId ? "Local fake YouTube video" : "Local fake HTTPS source",
        channel: "Local fixture channel",
        duration: videoId === "SHE2E000002" ? 20 : 12,
        view_count: 42,
        upload_date: "20260929",
        automatic_captions: { en: [{ ext: "vtt" }] },
        heatmap: [{ start_time: 1, end_time: 4, value: 0.8 }],
      }),
    );
    await writeFile(
      subtitlePath,
      "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nThis caption came from the local fake yt-dlp fixture.\n",
    );
  }
}
