import { Service, signal } from '@angular/core';

const MUTE_KEY = 'magic-book.muted';

function readStoredMute(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === 'true';
  } catch {
    return false;
  }
}

/**
 * Pure Web Audio API 8-bit chiptune sound effects (Game Boy / NES style).
 * Zero external audio assets; degrades silently if AudioContext is blocked or unavailable.
 */
@Service()
export class RetroAudioService {
  readonly muted = signal<boolean>(readStoredMute());
  private ctx: AudioContext | null = null;

  toggleMute(): void {
    const next = !this.muted();
    this.muted.set(next);
    try {
      localStorage.setItem(MUTE_KEY, String(next));
    } catch {
      // Ignore storage errors
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.muted()) {
      return null;
    }
    try {
      if (!this.ctx && typeof window !== 'undefined') {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx?.state === 'suspended') {
        void this.ctx.resume();
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  private playTone(
    freq: number,
    durationSec: number,
    startOffsetSec = 0,
    type: OscillatorType = 'square',
    gainPeak = 0.06,
    slideToFreq?: number,
  ): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime + startOffsetSec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideToFreq) {
      osc.frequency.linearRampToValueAtTime(slideToFreq, now + durationSec);
    }

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(gainPeak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + durationSec + 0.01);
  }

  /** Soft 8-bit grass/path footstep blip. */
  playStep(alternate: boolean): void {
    this.playTone(alternate ? 155 : 185, 0.045, 0, 'triangle', 0.045, alternate ? 110 : 130);
  }

  /** Classic Zelda/Mario bump thud when walking into a tree, rock, or wall. */
  playBump(): void {
    this.playTone(110, 0.09, 0, 'square', 0.06, 55);
  }

  /** Pokémon-style two-note chime when opening an NPC dialogue. */
  playGreet(): void {
    this.playTone(523.25, 0.06, 0, 'square', 0.05); // C5
    this.playTone(659.25, 0.09, 0.06, 'square', 0.05); // E5
  }

  /** Shimmering ascending arpeggio when conjuring a wish in the Magic Book. */
  playConjure(): void {
    const notes = [392.0, 493.88, 587.33, 783.99, 987.77]; // G4, B4, D5, G5, B5
    notes.forEach((freq, i) => {
      this.playTone(freq, 0.08, i * 0.055, 'square', 0.045);
    });
  }

  /** Zelda puzzle-solved / Mario power-up fanfare when a villager's problem is solved! */
  playSolved(): void {
    // G4 - B4 - D5 - G5 - F#5 - G5 - B5
    const seq: readonly [number, number, number][] = [
      [523.25, 0.08, 0.0], // C5
      [587.33, 0.08, 0.08], // D5
      [659.25, 0.08, 0.16], // E5
      [698.46, 0.08, 0.24], // F5
      [783.99, 0.12, 0.32], // G5
      [1046.5, 0.28, 0.44], // C6
    ];
    for (const [freq, dur, offset] of seq) {
      this.playTone(freq, dur, offset, 'square', 0.06);
    }
  }

  /** Descending two-note buzz when an object fails to solve the problem. */
  playFail(): void {
    this.playTone(311.13, 0.11, 0, 'sawtooth', 0.045); // D#4
    this.playTone(233.08, 0.18, 0.11, 'sawtooth', 0.045); // Bb3
  }
}
