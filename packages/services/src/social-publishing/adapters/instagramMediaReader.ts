import { z } from "zod";
import type { InstagramMedia } from "@social-harness/shared";
import { instagramMediaSchema } from "@social-harness/shared";
import type { InstagramMediaReader } from "../app/ports/instagramMediaReader.js";
import { INSTAGRAM_GRAPH_API_BASE_URL, INSTAGRAM_GRAPH_API_VERSION } from "./instagramGraphApi.js";

const mediaResponseSchema = z.object({ data: z.array(z.unknown()) });
const mediaItemSchema = z.object({
  id: z.union([z.string().trim().min(1).max(128), z.number().int().positive()]),
  media_type: z.string().trim().min(1).max(32),
  caption: z.string().max(2_200).optional(),
  permalink: z.string().url().optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
});

function safePermalink(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !["instagram.com", "www.instagram.com"].includes(url.hostname) ||
      !/^\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname) ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function createInstagramMediaReader(options?: {
  fetcher?: typeof fetch;
}): InstagramMediaReader {
  const fetcher = options?.fetcher ?? fetch;

  return {
    async list({ instagramUserId, accessToken, limit }) {
      const userId = z.string().trim().min(1).max(128).parse(instagramUserId);
      const pageSize = z.number().int().min(1).max(25).parse(limit);
      const url = new URL(
        `${INSTAGRAM_GRAPH_API_VERSION}/${encodeURIComponent(userId)}/media`,
        `${INSTAGRAM_GRAPH_API_BASE_URL}/`,
      );
      url.searchParams.set("fields", "id,caption,media_type,permalink,timestamp");
      url.searchParams.set("limit", String(pageSize));
      let response: Response;
      try {
        response = await fetcher(url, {
          headers: { authorization: `Bearer ${accessToken}` },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new Error("Instagram media could not be loaded");
      }
      if (!response.ok) throw new Error("Instagram media could not be loaded");
      try {
        const result = mediaResponseSchema.parse(await response.json());
        const items: InstagramMedia[] = [];
        for (const raw of result.data) {
          if (items.length >= pageSize) break;
          const parsed = mediaItemSchema.safeParse(raw);
          if (!parsed.success) continue;
          const item = parsed.data;
          const projection = instagramMediaSchema.safeParse({
            mediaId: String(item.id),
            mediaType: item.media_type,
            caption: item.caption ?? null,
            permalink: safePermalink(item.permalink),
            timestamp: item.timestamp ?? null,
          });
          if (projection.success) items.push(projection.data);
        }
        return items;
      } catch {
        throw new Error("Instagram media response was invalid");
      }
    },
  };
}
