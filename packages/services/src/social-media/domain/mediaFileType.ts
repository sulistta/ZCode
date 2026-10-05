import type { SocialMediaKind } from "@social-harness/shared";

const MEDIA_FILE_TYPES: Record<string, { mediaKind: SocialMediaKind; mimeType: string }> = {
  ".aac": { mediaKind: "audio", mimeType: "audio/aac" },
  ".aif": { mediaKind: "audio", mimeType: "audio/aiff" },
  ".aiff": { mediaKind: "audio", mimeType: "audio/aiff" },
  ".avi": { mediaKind: "video", mimeType: "video/x-msvideo" },
  ".flac": { mediaKind: "audio", mimeType: "audio/flac" },
  ".gif": { mediaKind: "image", mimeType: "image/gif" },
  ".jpeg": { mediaKind: "image", mimeType: "image/jpeg" },
  ".jpg": { mediaKind: "image", mimeType: "image/jpeg" },
  ".m4a": { mediaKind: "audio", mimeType: "audio/mp4" },
  ".m4v": { mediaKind: "video", mimeType: "video/x-m4v" },
  ".mkv": { mediaKind: "video", mimeType: "video/x-matroska" },
  ".mov": { mediaKind: "video", mimeType: "video/quicktime" },
  ".mp3": { mediaKind: "audio", mimeType: "audio/mpeg" },
  ".mp4": { mediaKind: "video", mimeType: "video/mp4" },
  ".mpeg": { mediaKind: "video", mimeType: "video/mpeg" },
  ".mpg": { mediaKind: "video", mimeType: "video/mpeg" },
  ".ogg": { mediaKind: "audio", mimeType: "audio/ogg" },
  ".opus": { mediaKind: "audio", mimeType: "audio/opus" },
  ".png": { mediaKind: "image", mimeType: "image/png" },
  ".wav": { mediaKind: "audio", mimeType: "audio/wav" },
  ".webm": { mediaKind: "video", mimeType: "video/webm" },
  ".webp": { mediaKind: "image", mimeType: "image/webp" },
};

export function resolveMediaFileType(extension: string) {
  return MEDIA_FILE_TYPES[extension.toLowerCase()] ?? null;
}
