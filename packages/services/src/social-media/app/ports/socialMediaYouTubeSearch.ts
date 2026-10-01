export interface SocialMediaYouTubeSearch {
  search(query: string, limit: number): Promise<unknown[]>;
}
