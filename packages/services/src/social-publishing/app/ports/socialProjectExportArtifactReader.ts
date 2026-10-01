export interface SocialProjectExportArtifactReader {
  open(input: {
    exportId: string;
    expectedSha256: string;
    expectedFileSizeBytes: number;
  }): Promise<Blob>;
}
