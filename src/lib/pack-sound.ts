/**
 * Sons et vibrations de la cinématique d'ouverture — **entièrement
 * synthétisés** (Web Audio) : aucun fichier son embarqué, l'APK n'augmente
 * pas d'un octet.
 *
 * L'esprit visé est celui de Pokémon TCG Pocket : le crissement du foil au
 * déchiré, le souffle des cartes qui jaillissent, le clic du retournement et
 * une petite fanfare sur la carte rare. Les vibrations (Android/WebView)
 * ponctuent les mêmes instants.
 *
 * Toute fonction dégrade en douceur : pas d'`AudioContext`, contexte suspendu,
 * stockage coupé ou exception — rien ne doit jamais faire échouer
 * l'ouverture d'un booster.
 */

import { soundSettings } from "@/lib/sound-settings";

export type PackSound = "tear" | "whoosh" | "flip" | "rare" | "chime" | "tick";

let context: AudioContext | null = null;
let noise: { context: AudioContext; buffer: AudioBuffer } | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const ctor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!ctor) return null;
  try {
    if (!context) context = new ctor();
    // Créé hors geste (poches suspendues) : on tente un réveil à chaque appel.
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    return context;
  } catch {
    return null;
  }
}

/** Bruit blanc partagé (1,5 s) : matière première du foil et du souffle. */
function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (noise && noise.context === ac) return noise.buffer;
  const length = Math.floor(ac.sampleRate * 1.5);
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  noise = { context: ac, buffer };
  return buffer;
}

const SILENCE = 0.0001;

/** Crissement du foil : bruit filtré dont la bande monte pendant l'arraché. */
function playTear(ac: AudioContext) {
  const now = ac.currentTime;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  src.playbackRate.value = 0.85 + Math.random() * 0.3;
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 0.8;
  band.frequency.setValueAtTime(650, now);
  band.frequency.exponentialRampToValueAtTime(5400, now + 0.4);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(SILENCE, now);
  gain.gain.exponentialRampToValueAtTime(0.3, now + 0.04);
  gain.gain.exponentialRampToValueAtTime(SILENCE, now + 0.5);
  src.connect(band).connect(gain).connect(ac.destination);
  src.start(now, Math.random() * 0.4, 0.55);
}

/** Souffle des cartes qui jaillissent (ou passage à la carte suivante). */
function playWhoosh(ac: AudioContext, amount: number) {
  const now = ac.currentTime;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const lowpass = ac.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(2800, now);
  lowpass.frequency.exponentialRampToValueAtTime(300, now + 0.32);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(SILENCE, now);
  gain.gain.exponentialRampToValueAtTime(amount, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(SILENCE, now + 0.4);
  src.connect(lowpass).connect(gain).connect(ac.destination);
  src.start(now, Math.random() * 0.4, 0.45);
}

/** Clic doux du carton : sélection du pack, retournement, enchaînement. */
function playTick(ac: AudioContext) {
  const now = ac.currentTime;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const band = ac.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1900;
  band.Q.value = 1.1;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(SILENCE, now);
  gain.gain.exponentialRampToValueAtTime(0.1, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(SILENCE, now + 0.16);
  src.connect(band).connect(gain).connect(ac.destination);
  src.start(now, Math.random() * 0.5, 0.2);

  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(320, now);
  osc.frequency.exponentialRampToValueAtTime(130, now + 0.07);
  const oscGain = ac.createGain();
  oscGain.gain.setValueAtTime(0.08, now);
  oscGain.gain.exponentialRampToValueAtTime(SILENCE, now + 0.09);
  osc.connect(oscGain).connect(ac.destination);
  osc.start(now);
  osc.stop(now + 0.1);
}

/** Retournement de carte : souffle court + micro-clic. */
function playFlip(ac: AudioContext) {
  playTick(ac);
  const now = ac.currentTime;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const highpass = ac.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 1500;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(SILENCE, now);
  gain.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(SILENCE, now + 0.12);
  src.connect(highpass).connect(gain).connect(ac.destination);
  src.start(now, Math.random() * 0.5, 0.15);
}

/** Fanfare courte sur la carte rare (C6-E6-G6-C7). */
function playRare(ac: AudioContext) {
  const now = ac.currentTime;
  const notes = [1046.5, 1318.5, 1568, 2093];
  notes.forEach((frequency, step) => {
    const at = now + step * 0.075;
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = frequency;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(SILENCE, at);
    gain.gain.exponentialRampToValueAtTime(0.13, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(SILENCE, at + 0.45);
    osc.connect(gain).connect(ac.destination);
    osc.start(at);
    osc.stop(at + 0.5);
  });
}

/** Carillon doux quand le récapitulatif s'ouvre. */
function playChime(ac: AudioContext) {
  const now = ac.currentTime;
  [880, 1174.7].forEach((frequency, step) => {
    const at = now + step * 0.12;
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.value = frequency;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(SILENCE, at);
    gain.gain.exponentialRampToValueAtTime(0.11, at + 0.03);
    gain.gain.exponentialRampToValueAtTime(SILENCE, at + 0.6);
    osc.connect(gain).connect(ac.destination);
    osc.start(at);
    osc.stop(at + 0.65);
  });
}

/** Joue un son de la cinématique — un simple `no-op` si le son est coupé. */
export function playPackSound(name: PackSound): void {
  if (!soundSettings.getSnapshot()) return;
  const ac = audio();
  if (!ac) return;
  try {
    switch (name) {
      case "tear":
        playTear(ac);
        break;
      case "whoosh":
        playWhoosh(ac, 0.26);
        break;
      case "flip":
        playFlip(ac);
        break;
      case "rare":
        playRare(ac);
        break;
      case "chime":
        playChime(ac);
        break;
      case "tick":
        playWhoosh(ac, 0.12);
        playTick(ac);
        break;
    }
  } catch {
    // Jamais d'échec d'ouverture pour une question d'audio.
  }
}

/**
 * Vibration Android, calquée sur le réglage « son et vibrations ».
 * `navigator.vibrate` n'existe ni sur iOS ni sur le desktop : no-op.
 */
export function haptic(pattern: number | number[]): void {
  if (!soundSettings.getSnapshot()) return;
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Refusée par la plateforme : tant pis.
  }
}
