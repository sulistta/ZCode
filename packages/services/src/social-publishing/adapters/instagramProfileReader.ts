import { z } from "zod";
import type { InstagramConnectionProfile } from "@social-harness/shared";
import { INSTAGRAM_GRAPH_API_BASE_URL, INSTAGRAM_GRAPH_API_VERSION } from "./instagramGraphApi.js";

const profileResponseSchema = z.object({
  id: z.union([z.string().min(1), z.number().int().positive()]),
  username: z.string().trim().min(1).max(64),
  profile_picture_url: z.string().url().nullable().optional(),
});

export function createInstagramProfileReader(options?: { fetcher?: typeof fetch }) {
  const fetcher = options?.fetcher ?? fetch;
  return async (accessToken: string): Promise<InstagramConnectionProfile> => {
    let response: Response;
    try {
      response = await fetcher(
        `${INSTAGRAM_GRAPH_API_BASE_URL}/${INSTAGRAM_GRAPH_API_VERSION}/me?fields=id,username,profile_picture_url`,
        {
          headers: { authorization: `Bearer ${accessToken}` },
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch {
      throw new Error("Instagram profile could not be verified");
    }
    if (!response.ok) throw new Error("Instagram profile could not be verified");
    try {
      const profile = profileResponseSchema.parse(await response.json());
      return {
        instagramUserId: String(profile.id),
        username: profile.username,
        profilePictureUrl: profile.profile_picture_url ?? null,
      };
    } catch {
      throw new Error("Instagram profile could not be verified");
    }
  };
}
