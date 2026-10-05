import type {
  SocialMediaClipAudioWindow,
  SocialMediaClipSignals,
  SocialMediaClipVisualSample,
} from "../domain/clipSignals.js";

export const CLIP_SIGNAL_SAMPLE_RATE = 4_000;
export const CLIP_SIGNAL_WINDOW_SECONDS = 1;
export const CLIP_VISUAL_SAMPLE_INTERVAL_SECONDS = 2;
export const CLIP_VISUAL_FRAME_WIDTH = 32;
export const CLIP_VISUAL_FRAME_HEIGHT = 18;
export const MAX_CLIP_ANALYSIS_DURATION_SECONDS = 2 * 60 * 60;

export function buildFfprobeClipAnalysisArgs(mediaPath: string): string[] {
  return [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type",
    "-of",
    "json",
    mediaPath,
  ];
}

export function buildFfmpegClipAnalysisArgs(input: {
  mediaPath: string;
  hasVideo: boolean;
}): string[] {
  const args = ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", input.mediaPath];
  args.push("-map", "0:a:0", "-vn", "-ac", "1", "-ar", String(CLIP_SIGNAL_SAMPLE_RATE));
  args.push("-f", "f32le", "pipe:1");
  if (input.hasVideo) {
    args.push(
      "-map",
      "0:v:0",
      "-an",
      "-vf",
      `fps=1/${CLIP_VISUAL_SAMPLE_INTERVAL_SECONDS},scale=${CLIP_VISUAL_FRAME_WIDTH}:${CLIP_VISUAL_FRAME_HEIGHT}:flags=area,format=gray`,
      "-fps_mode",
      "passthrough",
      "-pix_fmt",
      "gray",
      "-f",
      "rawvideo",
      "pipe:3",
    );
  }
  return args;
}

class PcmWindowAccumulator {
  private readonly blockMeanSquares: number[] = [];
  private readonly blockOnsets: number[] = [];
  private currentBlockSquares = 0;
  private currentBlockSamples = 0;
  private sampleCount = 0;
  private previousBlockEnergy = 0;
  private remainder = Buffer.alloc(0);

  push(chunk: Buffer): void {
    const combined = this.remainder.length > 0 ? Buffer.concat([this.remainder, chunk]) : chunk;
    const completeBytes = combined.length - (combined.length % 4);
    for (let offset = 0; offset < completeBytes; offset += 4) {
      const value = Math.max(-1, Math.min(1, combined.readFloatLE(offset)));
      if (!Number.isFinite(value)) continue;
      this.currentBlockSquares += value * value;
      this.currentBlockSamples += 1;
      this.sampleCount += 1;
      if (this.currentBlockSamples === CLIP_SIGNAL_SAMPLE_RATE / 10) this.finishBlock();
    }
    this.remainder = Buffer.from(combined.subarray(completeBytes));
  }

  finish(): {
    audioWindows: SocialMediaClipAudioWindow[];
    durationSeconds: number;
    peakAudioRms: number;
    rhythm: { bpm: number; confidence: number } | null;
  } {
    if (this.currentBlockSamples > 0) this.finishBlock();
    if (this.blockMeanSquares.length === 0) {
      return { audioWindows: [], durationSeconds: 0, peakAudioRms: 0, rhythm: null };
    }
    const durationSeconds = this.sampleCount / CLIP_SIGNAL_SAMPLE_RATE;
    const secondSquares: number[] = [];
    const secondOnsets: number[] = [];
    const blocksPerSecond: number[] = [];
    for (let index = 0; index < this.blockMeanSquares.length; index += 1) {
      const second = Math.floor(index / 10);
      secondSquares[second] = (secondSquares[second] ?? 0) + this.blockMeanSquares[index]!;
      secondOnsets[second] = (secondOnsets[second] ?? 0) + this.blockOnsets[index]!;
      blocksPerSecond[second] = (blocksPerSecond[second] ?? 0) + 1;
    }
    const windows = secondSquares.map((sumSquares, index) => ({
      startSeconds: index,
      endSeconds: Math.min(index + CLIP_SIGNAL_WINDOW_SECONDS, durationSeconds),
      rms: Math.sqrt(sumSquares / Math.max(1, blocksPerSecond[index]!)),
      onsetRate: secondOnsets[index] ?? 0,
    }));
    const maximumRms = Math.max(...windows.map((window) => window.rms));
    const maximumOnsets = Math.max(...windows.map((window) => window.onsetRate));
    const audioWindows = windows.map(({ rms, onsetRate, ...window }) => ({
      ...window,
      energy: maximumRms > 0 ? Math.min(1, rms / maximumRms) : 0,
      onsetRate: maximumOnsets > 0 ? Math.min(1, onsetRate / maximumOnsets) : 0,
    }));
    return {
      audioWindows,
      durationSeconds,
      peakAudioRms: maximumRms,
      rhythm: estimateRhythm(this.blockMeanSquares),
    };
  }

  private finishBlock(): void {
    if (this.currentBlockSamples === 0) return;
    const currentEnergy = Math.sqrt(this.currentBlockSquares / this.currentBlockSamples);
    const onset = Math.max(0, currentEnergy - this.previousBlockEnergy);
    this.previousBlockEnergy = currentEnergy;
    this.blockMeanSquares.push(currentEnergy * currentEnergy);
    this.blockOnsets.push(onset);
    this.currentBlockSquares = 0;
    this.currentBlockSamples = 0;
  }
}

function estimateRhythm(blockSquares: number[]): { bpm: number; confidence: number } | null {
  if (blockSquares.length < 40) return null;
  const onset = blockSquares.map((value, index) =>
    index === 0 ? 0 : Math.max(0, Math.sqrt(value) - Math.sqrt(blockSquares[index - 1]!)),
  );
  const average = onset.reduce((sum, value) => sum + value, 0) / onset.length;
  const centered = onset.map((value) => value - average);
  let best = { bpm: 0, confidence: 0 };
  for (let lag = 3; lag <= 10; lag += 1) {
    let covariance = 0;
    let leftSquares = 0;
    let rightSquares = 0;
    for (let index = lag; index < centered.length; index += 1) {
      covariance += centered[index]! * centered[index - lag]!;
      leftSquares += centered[index]! ** 2;
      rightSquares += centered[index - lag]! ** 2;
    }
    const confidence =
      leftSquares > 0 && rightSquares > 0
        ? Math.max(0, Math.min(1, covariance / Math.sqrt(leftSquares * rightSquares)))
        : 0;
    if (confidence > best.confidence) best = { bpm: Math.round(600 / lag), confidence };
  }
  return best.confidence >= 0.18 ? best : null;
}

class GrayFrameAccumulator {
  private remainder = Buffer.alloc(0);
  private previousFrame: Buffer | null = null;
  private readonly samples: SocialMediaClipVisualSample[] = [];
  private frameCount = 0;

  push(chunk: Buffer): void {
    const frameBytes = CLIP_VISUAL_FRAME_WIDTH * CLIP_VISUAL_FRAME_HEIGHT;
    const combined = this.remainder.length > 0 ? Buffer.concat([this.remainder, chunk]) : chunk;
    const frameCount = Math.floor(combined.length / frameBytes);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const start = frameIndex * frameBytes;
      const current = combined.subarray(start, start + frameBytes);
      this.frameCount += 1;
      if (this.previousFrame) {
        let difference = 0;
        for (let pixel = 0; pixel < frameBytes; pixel += 1) {
          difference += Math.abs(current[pixel]! - this.previousFrame[pixel]!);
        }
        const changeScore = difference / (frameBytes * 255);
        if (changeScore >= 0.08) {
          this.samples.push({
            atSeconds: (this.frameCount - 1) * CLIP_VISUAL_SAMPLE_INTERVAL_SECONDS,
            changeScore,
          });
        }
      }
      this.previousFrame = Buffer.from(current);
    }
    this.remainder = Buffer.from(combined.subarray(frameCount * frameBytes));
  }

  finish(): SocialMediaClipVisualSample[] {
    return this.samples;
  }
}

export function createClipSignalAccumulators() {
  const audio = new PcmWindowAccumulator();
  const visual = new GrayFrameAccumulator();
  return {
    onAudioChunk: (chunk: Buffer) => audio.push(chunk),
    onVisualChunk: (chunk: Buffer) => visual.push(chunk),
    finish(): SocialMediaClipSignals {
      const analysis = audio.finish();
      return {
        ...analysis,
        visualSamples: visual.finish(),
      };
    },
  };
}
