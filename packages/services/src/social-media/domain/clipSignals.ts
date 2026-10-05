export interface SocialMediaClipAudioWindow {
  startSeconds: number;
  endSeconds: number;
  energy: number;
  onsetRate: number;
}

export interface SocialMediaClipVisualSample {
  atSeconds: number;
  changeScore: number;
}

export interface SocialMediaClipSignals {
  durationSeconds: number;
  peakAudioRms: number;
  audioWindows: SocialMediaClipAudioWindow[];
  rhythm: { bpm: number; confidence: number } | null;
  visualSamples: SocialMediaClipVisualSample[];
}
