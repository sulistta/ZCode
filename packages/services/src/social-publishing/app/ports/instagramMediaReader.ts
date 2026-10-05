import type { InstagramMedia } from "@social-harness/shared";

export interface InstagramMediaReader {
  list(input: {
    instagramUserId: string;
    accessToken: string;
    limit: number;
  }): Promise<InstagramMedia[]>;
}
