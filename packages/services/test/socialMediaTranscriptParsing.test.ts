import assert from "node:assert/strict";
import test from "node:test";
import {
  parseWebVttTranscript,
  selectYouTubeSubtitleTranscript,
} from "../src/social-media/domain/webVttTranscript.js";

test("WebVTT parser keeps only timed non-empty cues and validates cue intervals", () => {
  const transcript = parseWebVttTranscript(
    "\uFEFFWEBVTT - sample\r\n\r\nNOTE generated captions\r\nignored note\r\n\r\ncue-1\r\n00:00:00.000 --> 00:00:01.250 align:start\r\n<c.green>Olá</c> &amp; <i>mundo</i>\r\n\r\n00:00.900 --> 00:00:02.000\r\nsegunda\r\nlinha\r\n\r\n00:00:02.000 --> 00:00:02.000\r\nempty interval\r\n\r\nuntimed text\r\n\r\n00:00.000 --> 00:00:01.000\r\n<i></i>\r\n",
  );

  assert.deepEqual(transcript, [
    { startSeconds: 0, endSeconds: 1.25, text: "Olá & mundo" },
    { startSeconds: 0.9, endSeconds: 2, text: "segunda linha" },
  ]);
  assert.deepEqual(
    parseWebVttTranscript("WEBVTT\n\n00.000 --> 01.000\nInvalid seconds-only timestamp\n"),
    [],
  );
});

test("WebVTT parser rejects output that exceeds the supported cue count", () => {
  const formatTimestamp = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.000`;
  };
  const cues = Array.from(
    { length: 20_001 },
    (_, index) => `${formatTimestamp(index)} --> ${formatTimestamp(index + 1)}\nCue ${index}`,
  ).join("\n\n");
  assert.deepEqual(parseWebVttTranscript(`WEBVTT\n\n${cues}`), []);
});

test("subtitle selection prefers account language then English and skips invalid tracks", () => {
  const transcript = selectYouTubeSubtitleTranscript({
    accountLanguage: "pt-BR",
    createdAt: 123,
    subtitles: [
      {
        languageCode: "en",
        automatic: true,
        content: "WEBVTT\n\n00:00.000 --> 00:01.000\nEnglish\n",
      },
      {
        languageCode: "pt-BR",
        automatic: false,
        content: "not a webvtt file",
      },
      {
        languageCode: "pt",
        automatic: false,
        content: "WEBVTT\n\n00:00.000 --> 00:01.000\nPortuguês\n",
      },
    ],
  });

  assert.deepEqual(transcript, {
    method: "youtube-subtitles",
    languageCode: "pt",
    automatic: false,
    segments: [{ startSeconds: 0, endSeconds: 1, text: "Português" }],
    createdAt: 123,
  });
});

test("subtitle fallback accepts English only when the account language has no valid cues", () => {
  const transcript = selectYouTubeSubtitleTranscript({
    accountLanguage: "pt-BR",
    createdAt: -2,
    subtitles: [
      { languageCode: "pt", automatic: false, content: "WEBVTT\n\nnot timed text\n" },
      {
        languageCode: "en-US",
        automatic: true,
        content: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nFallback\n",
      },
    ],
  });

  assert.equal(transcript?.method, "youtube-subtitles");
  assert.equal(transcript?.languageCode, "en-US");
  assert.equal(transcript?.segments[0]?.text, "Fallback");
  assert.equal(transcript?.createdAt, 0);
  assert.equal(
    selectYouTubeSubtitleTranscript({ accountLanguage: "pt-BR", createdAt: 0, subtitles: [] }),
    null,
  );
});
