import * as THREE from 'three';
import { pulseHaptic } from './haptics.js';

// Alarme liga quando o fusível passa de 70% consumido (fuseUrgency, Fase A2)
// — ainda dá um bom tempo de reação antes do fim, sem tocar o jogo inteiro.
const URGENCY_THRESHOLD = 0.7;
const MIN_PULSE_INTERVAL = 0.25; // mais frequente possível, na urgência máxima
const MAX_PULSE_INTERVAL = 1.2; // recém entrou em alarme, ainda esporádico
const MIN_FREQUENCY = 500;
const MAX_FREQUENCY = 1100;
const BEEP_DURATION = 0.12;

// Alarme de proximidade (documento de especificação, seção 6 — "Sistema de
// Áudio e Feedback"): toda bomba com fusível ativo (bomb.fuseUrgency) acima
// de URGENCY_THRESHOLD ganha um bipe 3D POSICIONAL (THREE.PositionalAudio
// anexado a bomb.group, não um som mono como o createTensionCue de
// audio.js) que acelera e fica mais agudo conforme o tempo acaba — o
// jogador consegue localizar a direção da bomba crítica pelo próprio áudio
// espacializado do WebXR, mesmo estando longe (ex.: purgando o
// superaquecimento do scanner no centro enquanto uma bomba fica pra trás na
// bancada). Também pulsa (haptics.js) o controller que estiver segurando a
// bomba crítica, se houver.
export function createProximityAlarm({ listener, grabSystem }) {
  const alarms = new Map(); // bomb -> { source, timer }

  function ensureAlarm(bomb) {
    const existing = alarms.get(bomb);
    if (existing) return existing;
    const source = new THREE.PositionalAudio(listener);
    source.setRefDistance(1);
    bomb.group.add(source);
    const alarm = { source, timer: 0 };
    alarms.set(bomb, alarm);
    return alarm;
  }

  // Conecta um oscilador de vida curta direto no GainNode público da
  // PositionalAudio (`source.gain`, já ligado ao panner/destino por dentro
  // do three.js) — mesma técnica de osciladores efêmeros de
  // audio.js#createTensionCue, só que o destino é espacializado em vez de
  // `ctx.destination` puro.
  function pulseTone(source, frequency) {
    const ctx = source.context;
    if (ctx.state === 'suspended') ctx.resume();
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0.0001, ctx.currentTime);
    envelope.gain.exponentialRampToValueAtTime(0.5, ctx.currentTime + 0.015);
    envelope.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + BEEP_DURATION);
    oscillator.connect(envelope).connect(source.gain);
    oscillator.start();
    oscillator.stop(ctx.currentTime + BEEP_DURATION);
  }

  function update(dt, bombs) {
    bombs.forEach((bomb) => {
      const urgency = bomb.fuseUrgency;
      if (urgency === null || urgency < URGENCY_THRESHOLD) return;

      const alarm = ensureAlarm(bomb);
      const t = THREE.MathUtils.clamp((urgency - URGENCY_THRESHOLD) / (1 - URGENCY_THRESHOLD), 0, 1);
      const interval = THREE.MathUtils.lerp(MAX_PULSE_INTERVAL, MIN_PULSE_INTERVAL, t);
      const frequency = THREE.MathUtils.lerp(MIN_FREQUENCY, MAX_FREQUENCY, t);

      alarm.timer -= dt;
      if (alarm.timer <= 0) {
        alarm.timer = interval;
        pulseTone(alarm.source, frequency);

        const holdingController = grabSystem.getHoldingController(bomb.group);
        if (holdingController) pulseHaptic(holdingController, 0.3 + 0.5 * t, 60);
      }
    });

    // Limpa alarmes de bombas que saíram de cena (entregues) — evita vazar
    // PositionalAudio/GainNode indefinidamente ao longo da partida.
    for (const bomb of alarms.keys()) {
      if (!bombs.includes(bomb)) {
        const alarm = alarms.get(bomb);
        bomb.group.remove(alarm.source);
        alarms.delete(bomb);
      }
    }
  }

  return { update };
}
