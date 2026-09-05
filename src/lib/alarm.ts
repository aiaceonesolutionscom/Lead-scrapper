// Completion alarm — a cheerful multi-tone chime generated with the Web Audio
// API (no audio files needed). Loops until the user stops/dismisses it so the
// operator knows the requested lead count was reached.

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let playing = false;

const MUTE_KEY = "lead-crm:alarm-muted";

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = (window.AudioContext || (window as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext) as AudioContextCtor | undefined;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

function beep(freq: number, startAt: number, dur: number, volume: number): void {
  const c = ctx!;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
  osc.connect(gain);
  gain.connect(c.destination);
  osc.start(startAt);
  osc.stop(startAt + dur + 0.05);
}

function playJingle(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") {
    void c.resume().catch(() => undefined);
  }
  const t0 = c.currentTime + 0.02;
  // C5-E5-G5-C6 — a bright "success" rise.
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => beep(f, t0 + i * 0.17, 0.15, 0.25));
  // A low confirmation thump at the end.
  beep(261.63, t0 + 0.72, 0.3, 0.22);
}

/** Starts looping the chime until stopAlarm() is called. */
export function startAlarm(): void {
  if (playing) return;
  playing = true;
  const tick = () => {
    if (!playing) return;
    playJingle();
    loopTimer = setTimeout(tick, 4200);
  };
  tick();
}

export function stopAlarm(): void {
  playing = false;
  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
}

/** Browsers block autoplay audio until a user gesture; call this on any
    pointer/key input while the alarm should be audible. */
export function kickAudioIfNeeded(): void {
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") {
    void c.resume().catch(() => undefined);
  }
  if (playing) playJingle();
}

export function isAlarmMuted(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(MUTE_KEY) === "1";
}

export function setAlarmMuted(muted: boolean): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
}