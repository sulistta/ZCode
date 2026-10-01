import { z } from "zod";
import type { InstagramReelPublisher } from "../app/ports/instagramReelPublisher.js";
import { InstagramReelRemoteError } from "../app/ports/instagramReelPublisher.js";
import { INSTAGRAM_GRAPH_API_BASE_URL, INSTAGRAM_GRAPH_API_VERSION } from "./instagramGraphApi.js";

const idResponseSchema = z.object({ id: z.union([z.string(), z.number().int().positive()]) });
const statusResponseSchema = z.object({
  status_code: z.string().trim().min(1).max(64),
  status: z.string().trim().min(1).max(512).optional(),
});

interface InstagramReelPublisherOptions {
  fetcher?: typeof fetch;
  graphBaseUrl?: string;
  graphApiVersion?: string;
}

export function createInstagramReelPublisher(
  options: InstagramReelPublisherOptions = {},
): InstagramReelPublisher {
  const fetcher = options.fetcher ?? fetch;
  const baseUrl = options.graphBaseUrl ?? INSTAGRAM_GRAPH_API_BASE_URL;
  const apiVersion = z
    .string()
    .regex(/^v\d+\.\d+$/u)
    .parse(options.graphApiVersion ?? INSTAGRAM_GRAPH_API_VERSION);
  const versionedBaseUrl = `${baseUrl.replace(/\/$/u, "")}/${apiVersion}/`;

  async function request(url: URL, init: RequestInit): Promise<Response> {
    try {
      const response = await fetcher(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return response;
      if (response.status >= 500) throw new InstagramReelRemoteError("unknown");
      throw new InstagramReelRemoteError("rejected");
    } catch (error) {
      if (error instanceof InstagramReelRemoteError) throw error;
      throw new InstagramReelRemoteError("unknown");
    }
  }

  function bearer(accessToken: string): Record<string, string> {
    return { authorization: `Bearer ${accessToken}` };
  }

  return {
    async createReelContainer({ instagramUserId, accessToken, videoUrl, caption }) {
      const userId = encodeURIComponent(z.string().trim().min(1).max(128).parse(instagramUserId));
      const url = new URL(`${userId}/media`, versionedBaseUrl);
      const body = new URLSearchParams({
        media_type: "REELS",
        video_url: videoUrl,
        caption,
        share_to_feed: "true",
      });
      const response = await request(url, { method: "POST", headers: bearer(accessToken), body });
      try {
        const result = idResponseSchema.parse(await response.json());
        return { containerId: String(result.id) };
      } catch {
        throw new InstagramReelRemoteError("unknown");
      }
    },
    async getContainerStatus({ containerId, accessToken }) {
      const id = encodeURIComponent(z.string().trim().min(1).max(128).parse(containerId));
      const url = new URL(id, versionedBaseUrl);
      url.searchParams.set("fields", "status_code,status");
      const response = await request(url, { method: "GET", headers: bearer(accessToken) });
      try {
        const result = statusResponseSchema.parse(await response.json());
        return { statusCode: result.status_code, statusMessage: result.status };
      } catch {
        throw new InstagramReelRemoteError("unknown");
      }
    },
    async publishReel({ instagramUserId, containerId, accessToken }) {
      const userId = encodeURIComponent(z.string().trim().min(1).max(128).parse(instagramUserId));
      const url = new URL(`${userId}/media_publish`, versionedBaseUrl);
      const body = new URLSearchParams({ creation_id: containerId });
      const response = await request(url, { method: "POST", headers: bearer(accessToken), body });
      try {
        const result = idResponseSchema.parse(await response.json());
        return { mediaId: String(result.id) };
      } catch {
        throw new InstagramReelRemoteError("unknown");
      }
    },
  };
}
