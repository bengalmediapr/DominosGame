/** All sounds are synthesized at runtime: no audio assets to license. */
let ctx: AudioContext | null = null;
let volume = 0.7;

export const setVolume = (v: number): void => { volume = v; };

function audio(): AudioContext | null {
  if (volume <= 0) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** Tile slapped on the table. */
export function clack(hard = false): void {
  const a = audio();
  if (!a) return;
  const len = 0.09;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 6);
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = hard ? 1400 : 2400;
  filter.Q.value = 1.2;
  const gain = a.createGain();
  gain.gain.value = volume * (hard ? 1.6 : 0.9);
  src.connect(filter).connect(gain).connect(a.destination);
  src.start();
}

function chirp(a: AudioContext, at: number, from: number, to: number, dur: number, level: number): void {
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + dur);
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level * volume, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, at + dur);
  osc.connect(gain).connect(a.destination);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** The coquí frog's two-note call: "co-QUÍ". */
export function coqui(): void {
  const a = audio();
  if (!a) return;
  const now = a.currentTime;
  chirp(a, now, 1150, 1100, 0.1, 0.18);
  chirp(a, now + 0.16, 1700, 2250, 0.16, 0.16);
}

/** A little cuatro-ish flourish for winning. */
export function fanfare(win: boolean): void {
  const a = audio();
  if (!a) return;
  const notes = win ? [523, 659, 784, 1047] : [440, 392, 349];
  notes.forEach((f, i) => {
    const at = a.currentTime + i * 0.12;
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = 'triangle';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.25 * volume, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
    osc.connect(gain).connect(a.destination);
    osc.start(at);
    osc.stop(at + 0.55);
  });
}

function noise(a: AudioContext, seconds: number, decay: number): AudioBufferSourceNode {
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * seconds), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, decay);
  const src = a.createBufferSource();
  src.buffer = buf;
  return src;
}

/** Revolver shot: sharp crack plus a low, rumbling room tail. */
export function bang(): void {
  const a = audio();
  if (!a) return;
  const crack = noise(a, 0.25, 4);
  const crackGain = a.createGain();
  crackGain.gain.value = volume * 2.2;
  crack.connect(crackGain).connect(a.destination);
  const tail = noise(a, 1.6, 2.5);
  const low = a.createBiquadFilter();
  low.type = 'lowpass';
  low.frequency.value = 500;
  const tailGain = a.createGain();
  tailGain.gain.value = volume * 1.6;
  tail.connect(low).connect(tailGain).connect(a.destination);
  const thump = a.createOscillator();
  const thumpGain = a.createGain();
  thump.frequency.setValueAtTime(120, a.currentTime);
  thump.frequency.exponentialRampToValueAtTime(30, a.currentTime + 0.4);
  thumpGain.gain.setValueAtTime(volume * 1.5, a.currentTime);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.5);
  thump.connect(thumpGain).connect(a.destination);
  crack.start();
  tail.start();
  thump.start();
  thump.stop(a.currentTime + 0.55);
}

/** Empty chamber. */
export function dryClick(): void {
  const a = audio();
  if (!a) return;
  const src = noise(a, 0.03, 8);
  const hp = a.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 3000;
  const g = a.createGain();
  g.gain.value = volume * 2;
  src.connect(hp).connect(g).connect(a.destination);
  src.start();
}

/** Cylinder spinning: a quick run of ratchet ticks. */
export function spin(): void {
  const a = audio();
  if (!a) return;
  for (let i = 0; i < 12; i++) {
    const src = noise(a, 0.012, 6);
    const hp = a.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4000;
    const g = a.createGain();
    g.gain.value = volume * 0.6;
    src.connect(hp).connect(g).connect(a.destination);
    src.start(a.currentTime + i * 0.035 * (1 + i * 0.08));
  }
}
