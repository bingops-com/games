// Les sons du jeu : de petites notes fabriquées par le navigateur, sans fichier à charger
// (rien ne vient d'un autre site). Ils disent ce qui vient de se passer, jamais autre
// chose, et se coupent d'un bouton au pied de la bande.

export type SoundName =
  | 'turn' | 'msg' | 'join' | 'win' | 'lose'
  | 'card' | 'draw' | 'hit' | 'call' | 'flip'
  | 'bomb' | 'boom' | 'crate' | 'pick' | 'out';

const KEY = 'games.sound';
let on = true;
let ctx: AudioContext | null = null;

export function soundOn() {
  return on;
}
export function readSound() {
  try {
    on = localStorage.getItem(KEY) !== 'off';
  } catch {
    /* rien à faire */
  }
  return on;
}
export function setSound(value: boolean) {
  on = value;
  try {
    localStorage.setItem(KEY, value ? 'on' : 'off');
  } catch {
    /* rien à faire */
  }
}

// Une note : sa hauteur (qui peut glisser vers une autre), sa durée, sa forme d'onde.
function note(at: number, from: number, to: number, time: number, type: OscillatorType = 'sine', volume = 0.09) {
  const c = ctx!;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, at + time);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + time);
  osc.connect(gain).connect(c.destination);
  osc.start(at);
  osc.stop(at + time + 0.02);
}

// Un souffle : du bruit filtré, pour une carte qui glisse ou une explosion.
function hiss(at: number, time: number, cutoff: number, volume = 0.12) {
  const c = ctx!;
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * time), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = c.createBufferSource();
  const filter = c.createBiquadFilter();
  const gain = c.createGain();
  src.buffer = buffer;
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoff, at);
  filter.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff / 6), at + time);
  gain.gain.value = volume;
  src.connect(filter).connect(gain).connect(c.destination);
  src.start(at);
}

const SOUNDS: Record<SoundName, (t: number) => void> = {
  turn: (t) => { note(t, 660, 660, 0.09); note(t + 0.1, 880, 880, 0.16); },
  msg: (t) => note(t, 740, 880, 0.07, 'sine', 0.05),
  join: (t) => { note(t, 440, 440, 0.08, 'triangle'); note(t + 0.08, 587, 587, 0.12, 'triangle'); },
  win: (t) => [523, 659, 784, 1047].forEach((f, i) => note(t + i * 0.11, f, f, 0.2, 'triangle', 0.1)),
  lose: (t) => { note(t, 392, 330, 0.22, 'triangle'); note(t + 0.22, 330, 247, 0.35, 'triangle'); },
  card: (t) => { hiss(t, 0.07, 5000, 0.08); note(t + 0.04, 300, 200, 0.06, 'triangle', 0.07); },
  draw: (t) => hiss(t, 0.1, 3000, 0.07),
  hit: (t) => { note(t, 240, 110, 0.2, 'square', 0.06); hiss(t, 0.12, 1800, 0.08); },
  call: (t) => { note(t, 784, 784, 0.08, 'square', 0.05); note(t + 0.09, 1175, 1175, 0.18, 'square', 0.05); },
  flip: (t) => { hiss(t, 0.06, 4000, 0.07); note(t + 0.05, 520, 620, 0.08, 'sine', 0.06); },
  bomb: (t) => note(t, 180, 120, 0.1, 'triangle', 0.1),
  boom: (t) => { hiss(t, 0.5, 2400, 0.28); note(t, 140, 40, 0.4, 'sine', 0.22); },
  crate: (t) => hiss(t, 0.14, 1400, 0.1),
  pick: (t) => { note(t, 880, 1320, 0.09, 'triangle', 0.08); note(t + 0.08, 1320, 1760, 0.12, 'triangle', 0.07); },
  out: (t) => note(t, 500, 90, 0.5, 'sawtooth', 0.07),
};

export function play(name: SoundName) {
  if (!on || typeof window === 'undefined') return;
  try {
    ctx ??= new AudioContext();
    // Le navigateur ne laisse sonner qu'après un premier geste du joueur.
    if (ctx.state === 'suspended') void ctx.resume();
    if (ctx.state !== 'running') return;
    SOUNDS[name](ctx.currentTime + 0.005);
  } catch {
    /* pas de son sur cet appareil : le jeu se joue sans */
  }
}
