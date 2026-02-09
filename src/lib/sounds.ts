/**
 * Sound effects utility using Web Audio API.
 * Generates short notification sounds without requiring audio file assets.
 */

type SoundType = 'chime' | 'ding' | 'pop';

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

function playTone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume = 0.3,
): void {
  const ctx = getAudioContext();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + duration);
}

function playChime(): void {
  const ctx = getAudioContext();
  // Two-note ascending chime
  playTone(587, 0.15, 'sine', 0.25); // D5
  setTimeout(() => {
    if (ctx.state === 'running') {
      playTone(880, 0.3, 'sine', 0.2); // A5
    }
  }, 120);
}

function playDing(): void {
  // Single bright tone with decay
  playTone(1047, 0.4, 'sine', 0.3); // C6
}

function playPop(): void {
  const ctx = getAudioContext();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(600, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.08);
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(ctx.currentTime);
  oscillator.stop(ctx.currentTime + 0.15);
}

const SOUND_MAP: Record<SoundType, () => void> = {
  chime: playChime,
  ding: playDing,
  pop: playPop,
};

export function playSound(type: string): void {
  const fn = SOUND_MAP[type as SoundType];
  if (fn) {
    try {
      fn();
    } catch {
      // Audio playback can fail if the context is suspended or unavailable
    }
  }
}
