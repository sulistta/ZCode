import { z } from "zod";

export const socialMediaIdSchema = z.string().uuid();
export const socialMediaYouTubeVideoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
