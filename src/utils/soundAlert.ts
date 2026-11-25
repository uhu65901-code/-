import { SoundDurationMode, TrendDirection } from '../lib/types';

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Unlocks Web Audio on mobile Android/iOS browsers during the first user tap.
 */
export function unlockAudioContext() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

/**
 * Triggers Android haptic vibration pattern when a 5-6 candle trend is detected.
 */
export function triggerSignalVibration() {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate([260, 110, 260, 110, 340]);
    } catch {
      // ignore unsupported browsers
    }
  }
}

/**
 * Plays a loud, unmistakable multi-cycle broadcast chime so traders notice
 * 1-minute flowing trend alerts immediately on PC and Android speakers.
 */
export function playTrendAlertChime(
  direction: TrendDirection,
  volume = 0.95,
  durationMode: SoundDurationMode = 'LONG'
) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const clampedVol = Math.min(1, Math.max(0.2, volume));
  const cycles = durationMode === 'LONG' ? 3 : 2;

  // Dynamics compressor keeps loud alerts crisp without clipping
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.setValueAtTime(-12, ctx.currentTime);
  compressor.knee.setValueAtTime(10, ctx.currentTime);
  compressor.ratio.setValueAtTime(6, ctx.currentTime);
  compressor.connect(ctx.destination);

  const now = ctx.currentTime;
  const basePattern =
    direction === 'UP'
      ? [659.25, 880.0, 1174.66, 1318.51] // bright ascending CALL alert
      : [987.77, 783.99, 659.25, 523.25]; // clear descending PUT alert

  const cycleSpacing = 1.08;
  const noteStep = 0.16;
  const noteDuration = 0.34;

  for (let cycle = 0; cycle < cycles; cycle++) {
    const cycleStart = now + cycle * cycleSpacing;
    basePattern.forEach((freq, idx) => {
      const start = cycleStart + idx * noteStep;

      // Primary warm triangle layer
      const oscMain = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();

      oscMain.type = 'triangle';
      oscMain.frequency.setValueAtTime(freq, start);

      // Harmonic undertone for strong audibility on laptop & mobile speakers
      const oscHarmonic = ctx.createOscillator();
      const gainHarmonic = ctx.createGain();
      oscHarmonic.type = 'sawtooth';
      oscHarmonic.frequency.setValueAtTime(freq * 0.5, start);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3200, start);

      const peakGain = 0.52 * clampedVol;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(peakGain * 0.65, start + 0.14);
      gain.gain.exponentialRampToValueAtTime(0.001, start + noteDuration);

      gainHarmonic.gain.setValueAtTime(0.001, start);
      gainHarmonic.gain.exponentialRampToValueAtTime(peakGain * 0.32, start + 0.025);
      gainHarmonic.gain.exponentialRampToValueAtTime(0.001, start + noteDuration);

      oscMain.connect(filter);
      oscHarmonic.connect(gainHarmonic);
      gainHarmonic.connect(filter);
      filter.connect(gain);
      gain.connect(compressor);

      oscMain.start(start);
      oscHarmonic.start(start);
      oscMain.stop(start + noteDuration + 0.02);
      oscHarmonic.stop(start + noteDuration + 0.02);
    });
  }
}
