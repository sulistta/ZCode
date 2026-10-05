import type { SocialMediaTranscript, SocialMediaTranscriptSegment } from "@social-harness/shared";

const MAX_WEBVTT_BYTES = 10 * 1024 * 1024;
const MAX_TRANSCRIPT_SEGMENTS = 20_000;
const TIMING_LINE = /^(.+?)\s+-->\s+(.+?)(?:\s+.*)?$/;

export interface SubtitleTranscriptInput {
  languageCode: string;
  automatic: boolean;
  content: string;
}

function parseTimestamp(value: string): number | null {
  const parts = value.split(":");
  const secondsMatch = /^(\d{2})\.(\d{3})$/.exec(parts.at(-1) ?? "");
  if (!secondsMatch) return null;
  const seconds = Number(secondsMatch[1]);
  const milliseconds = Number(secondsMatch[2]);
  if (seconds > 59) return null;
  if (parts.length === 1) return null;
  const minutes = Number(parts.at(-2));
  if (!Number.isInteger(minutes) || minutes > 59) return null;
  if (parts.length === 2) return minutes * 60 + seconds + milliseconds / 1000;
  if (parts.length !== 3 || !/^\d{2,}$/.test(parts[0] ?? "")) return null;
  const hours = Number(parts[0]);
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

function cleanCueText(lines: readonly string[]): string {
  return lines
    .join(" ")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_entity, decimal: string) => {
      const codePoint = Number(decimal);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "";
    })
    .replace(/&#x([a-f\d]+);/gi, (_entity, hexadecimal: string) => {
      const codePoint = Number.parseInt(hexadecimal, 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "";
    })
    .replace(/\s+/g, " ")
    .trim();
}

function parseTimingLine(line: string): { startSeconds: number; endSeconds: number } | null {
  const match = TIMING_LINE.exec(line.trim());
  if (!match) return null;
  const startSeconds = parseTimestamp(match[1]!.trim());
  const endToken = match[2]!.trim().split(/\s+/)[0]!;
  const endSeconds = parseTimestamp(endToken);
  return startSeconds !== null && endSeconds !== null && endSeconds > startSeconds
    ? { startSeconds, endSeconds }
    : null;
}

export function parseWebVttTranscript(content: string): SocialMediaTranscriptSegment[] {
  if (new TextEncoder().encode(content).byteLength > MAX_WEBVTT_BYTES) return [];
  const lines = content
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split("\n");
  if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0]?.trim() ?? "")) return [];
  const segments: SocialMediaTranscriptSegment[] = [];

  for (let index = 1; index < lines.length; ) {
    const currentLine = lines[index]!.trim();
    if (!currentLine) {
      index += 1;
      continue;
    }
    if (/^(?:NOTE|STYLE|REGION)(?:\s|$)/.test(currentLine)) {
      while (index < lines.length && lines[index]!.trim()) index += 1;
      continue;
    }
    let timing = parseTimingLine(currentLine);
    if (!timing && index + 1 < lines.length) {
      timing = parseTimingLine(lines[index + 1]!.trim());
      if (timing) index += 1;
    }
    if (!timing) {
      index += 1;
      continue;
    }
    index += 1;
    const textLines: string[] = [];
    while (index < lines.length && lines[index]!.trim()) {
      textLines.push(lines[index]!);
      index += 1;
    }
    const text = cleanCueText(textLines);
    if (text) {
      if (segments.length === MAX_TRANSCRIPT_SEGMENTS) return [];
      segments.push({ ...timing, text });
    }
  }
  return segments;
}

function normalizedLanguageCode(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", "-");
}

export function selectYouTubeSubtitleTranscript(input: {
  subtitles: readonly SubtitleTranscriptInput[];
  accountLanguage: string;
  createdAt: number;
}): SocialMediaTranscript | null {
  const target = normalizedLanguageCode(input.accountLanguage);
  const targetPrimary = target.split("-")[0];
  const ranked = input.subtitles
    .map((subtitle, index) => {
      const languageCode = normalizedLanguageCode(subtitle.languageCode);
      const primary = languageCode.split("-")[0];
      const rank =
        languageCode === target ? 0 : primary === targetPrimary ? 1 : primary === "en" ? 2 : 99;
      return { subtitle, index, languageCode, rank };
    })
    .filter((candidate) => candidate.rank < 99)
    .sort((first, second) => first.rank - second.rank || first.index - second.index);

  for (const candidate of ranked) {
    const segments = parseWebVttTranscript(candidate.subtitle.content);
    if (segments.length === 0) continue;
    return {
      method: "youtube-subtitles",
      languageCode: candidate.subtitle.languageCode,
      automatic: candidate.subtitle.automatic,
      segments,
      createdAt: Math.max(0, Math.trunc(input.createdAt)),
    };
  }
  return null;
}
