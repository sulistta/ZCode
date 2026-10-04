import { z } from "zod";
import { socialAccountIdSchema } from "./social-account.js";
import { socialMediaYouTubeVideoIdSchema } from "./social-media-primitives.js";

export const socialMediaSourceKeySchema = z.union([
  socialMediaYouTubeVideoIdSchema,
  z.string().regex(/^url-[a-f0-9]{64}$/),
]);

export const socialMediaSourceUrlDownloadRequestSchema = z.object({
  accountId: socialAccountIdSchema,
  url: z.string().trim().min(1).max(2048),
});

/** Strict URL allowlist used before any yt-dlp process is started. */
export function normalizeSocialMediaYouTubeVideoUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hash
  ) {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (parsed.searchParams.has("list")) return null;
  let candidate: string | null = null;
  if (host === "youtu.be" || host === "www.youtu.be") {
    const match = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(parsed.pathname);
    candidate = match?.[1] ?? null;
  } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
    if (parsed.pathname === "/watch") {
      const ids = parsed.searchParams.getAll("v");
      candidate = ids.length === 1 ? ids[0]! : null;
    } else {
      const match = /^\/(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})\/?$/.exec(parsed.pathname);
      candidate = match?.[1] ?? null;
    }
  }
  const videoId = socialMediaYouTubeVideoIdSchema.safeParse(candidate);
  return videoId.success ? `https://www.youtube.com/watch?v=${videoId.data}` : null;
}

export type NormalizedSocialMediaSourceUrl = {
  sourceKind: "youtube" | "remote-url";
  sourceUrl: string;
  sourceVideoId?: string;
};

const YOUTUBE_SOURCE_HOSTS = new Set([
  "youtu.be",
  "www.youtu.be",
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
]);
const CREDENTIAL_QUERY_KEY =
  /^(?:access[_-]?token|refresh[_-]?token|token|auth(?:orization)?|api[_-]?key|key|secret|sig|signature|credential|password|session|cookie|code|x-amz-(?:credential|signature|security-token))$/iu;

/**
 * Normalize supported HTTPS source URLs before they become durable jobs. The Host's downloader
 * still routes every request through its public-address-only proxy; this parser is not the egress
 * security boundary by itself.
 */
export function normalizeSocialMediaSourceUrl(
  value: string,
): NormalizedSocialMediaSourceUrl | null {
  const youtubeUrl = normalizeSocialMediaYouTubeVideoUrl(value);
  if (youtubeUrl) {
    return {
      sourceKind: "youtube",
      sourceUrl: youtubeUrl,
      sourceVideoId: new URL(youtubeUrl).searchParams.get("v") ?? undefined,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  const rawHostname = parsed.hostname.toLowerCase();
  const hostname = rawHostname.replace(/^\[|\]$/gu, "");
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hash ||
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.startsWith("[") ||
    rawHostname.endsWith(".") ||
    /^\d+(?:\.\d+){0,3}$/u.test(hostname) ||
    YOUTUBE_SOURCE_HOSTS.has(hostname) ||
    [...parsed.searchParams.keys()].some((key) => CREDENTIAL_QUERY_KEY.test(key))
  ) {
    return null;
  }
  parsed.hostname = hostname;
  return { sourceKind: "remote-url", sourceUrl: parsed.toString() };
}

export type SocialMediaSourceUrlDownloadRequest = z.infer<
  typeof socialMediaSourceUrlDownloadRequestSchema
>;
