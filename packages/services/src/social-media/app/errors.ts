export class SocialMediaAccountNotFoundError extends Error {
  constructor(accountId: string) {
    super(`Social account not found: ${accountId}`);
    this.name = "SocialMediaAccountNotFoundError";
  }
}

export class SocialMediaAssetNotFoundError extends Error {
  readonly mediaId: string;

  constructor(mediaId: string) {
    super(`Social media asset not found: ${mediaId}`);
    this.name = "SocialMediaAssetNotFoundError";
    this.mediaId = mediaId;
  }
}

export class SocialMediaPreviewUnavailableError extends Error {
  constructor() {
    super("Media preview is unavailable. Retry the preview request.");
    this.name = "SocialMediaPreviewUnavailableError";
  }
}

export class SocialMediaPreviewProxyToolUnavailableError extends Error {
  constructor() {
    super("The bundled preview conversion tool is unavailable");
    this.name = "SocialMediaPreviewProxyToolUnavailableError";
  }
}

export class SocialMediaYouTubeSearchUnavailableError extends Error {
  constructor() {
    super("YouTube search is unavailable. Check the connection and try again.");
    this.name = "SocialMediaYouTubeSearchUnavailableError";
  }
}

export class SocialMediaYouTubeSearchFailedError extends Error {
  constructor() {
    super("YouTube search failed. Try again.");
    this.name = "SocialMediaYouTubeSearchFailedError";
  }
}

export class SocialMediaSourceDownloadUnavailableError extends Error {
  constructor() {
    super("Media downloads are unavailable. Check the application installation and try again.");
    this.name = "SocialMediaSourceDownloadUnavailableError";
  }
}

export class SocialMediaSourceDownloadFailedError extends Error {
  constructor() {
    super("The media source could not be downloaded. Check the URL and try again.");
    this.name = "SocialMediaSourceDownloadFailedError";
  }
}

export class SocialMediaSourceDownloadOutputError extends Error {
  constructor() {
    super("The downloaded media or its metadata did not pass validation.");
    this.name = "SocialMediaSourceDownloadOutputError";
  }
}

export class SocialMediaTranscriptionModelDownloadError extends Error {
  readonly code: "download-failed" | "integrity-failed";

  constructor(code: "download-failed" | "integrity-failed") {
    super("The local transcription model could not be installed");
    this.name = "SocialMediaTranscriptionModelDownloadError";
    this.code = code;
  }
}

export class SocialMediaTranscriptionModelUnavailableError extends Error {
  constructor() {
    super("The selected local transcription model is not installed");
    this.name = "SocialMediaTranscriptionModelUnavailableError";
  }
}

export class SocialMediaTranscriptionToolUnavailableError extends Error {
  constructor(tool: "ffmpeg" | "whisper.cpp") {
    super(`The local transcription tool is unavailable: ${tool}`);
    this.name = "SocialMediaTranscriptionToolUnavailableError";
  }
}

export class SocialMediaTranscriptionOutputError extends Error {
  constructor() {
    super("Local transcription output did not pass validation");
    this.name = "SocialMediaTranscriptionOutputError";
  }
}

export class SocialMediaTranscriptionFailedError extends Error {
  constructor() {
    super("Local transcription failed");
    this.name = "SocialMediaTranscriptionFailedError";
  }
}

export class SocialMediaClipAnalysisToolUnavailableError extends Error {
  readonly tool: "ffmpeg" | "ffprobe";

  constructor(tool: "ffmpeg" | "ffprobe") {
    super(`The local clip-analysis tool is unavailable: ${tool}`);
    this.name = "SocialMediaClipAnalysisToolUnavailableError";
    this.tool = tool;
  }
}

export class SocialMediaClipAnalysisFailedError extends Error {
  constructor() {
    super("Local clip analysis failed");
    this.name = "SocialMediaClipAnalysisFailedError";
  }
}

export class SocialMediaJobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Social media job not found: ${jobId}`);
    this.name = "SocialMediaJobNotFoundError";
  }
}
