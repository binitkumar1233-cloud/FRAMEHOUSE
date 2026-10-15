import { useEffect, useState } from "react";

let sharedContext: AudioContext | null = null;

const getAudioContext = () => {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  if (!sharedContext || sharedContext.state === "closed") sharedContext = new AudioContext();
  // Browsers start the context suspended until the page has had a user gesture.
  if (sharedContext.state === "suspended") void sharedContext.resume().catch(() => undefined);
  return sharedContext;
};

const SPEAKING_THRESHOLD = 0.035;
const HOLD_MS = 350;

/**
 * Returns true while the audio in `stream` is above a speaking threshold.
 * Pass `enabled = false` (e.g. when muted) to skip analysis entirely.
 */
export function useSpeaking(stream: MediaStream | null | undefined, enabled = true) {
  const [speaking, setSpeaking] = useState(false);
  const audioTrack = stream?.getAudioTracks()[0];

  useEffect(() => {
    if (!audioTrack || !enabled || audioTrack.readyState === "ended") {
      setSpeaking(false);
      return;
    }

    const context = getAudioContext();
    if (!context) return;

    let source: MediaStreamAudioSourceNode;
    try {
      source = context.createMediaStreamSource(new MediaStream([audioTrack]));
    } catch {
      return;
    }

    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);

    const samples = new Float32Array(analyser.fftSize);
    let lastLoudAt = 0;
    let current = false;

    const interval = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);

      const now = performance.now();
      if (rms > SPEAKING_THRESHOLD) lastLoudAt = now;
      const next = now - lastLoudAt < HOLD_MS;

      if (next !== current) {
        current = next;
        setSpeaking(next);
      }
    }, 100);

    return () => {
      window.clearInterval(interval);
      source.disconnect();
      analyser.disconnect();
      setSpeaking(false);
    };
  }, [audioTrack, enabled]);

  return speaking;
}
