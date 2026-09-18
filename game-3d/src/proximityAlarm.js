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

// Achado do playtest: com várias bombas acumuladas (ex.: fila cheia na caixa
// de coleta) e todas passando de URGENCY_THRESHOLD ao mesmo tempo, os bipes
// somavam e ficavam insuportáveis mesmo estando longe do jogador — o
// PositionalAudio já existia (o som sai de bomb.group, não é mono), mas o
// modelo de distância padrão do PannerNode (inverse, refDistance=1) cai
// devagar demais pro tamanho da sala (~6x5.2m): uma bomba a 3m ainda tocava
// a ~1/3 do volume. REF_DISTANCE/ROLLOFF/DISTANCE_MODEL abaixo apertam essa
// curva pra ficar bem alto só na distância de "segurando a bomba" (braço
// estendido, <0.4m da cabeça) e cair quase pro silêncio a partir de ~1-1.5m.
// GAIN_HELD/GAIN_IDLE reforçam isso mais um passo: mesmo que o jogador
// incline a cabeça perto de uma pilha de bombas SEM pegar nenhuma, o pico do
// bipe já nasce bem mais baixo do que quando ele está de fato com a bomba na
// mão — some com a curva de distância acima, mas não depende só dela.
const REF_DISTANCE = 0.35;
const ROLLOFF_FACTOR = 3;
const GAIN_HELD = 0.32; // pico do bipe com a bomba na mão (era 0.5 fixo, sem distinção)
const GAIN_IDLE = 0.08; // pico do bipe com a bomba fora da mão (mesa, caixa de coleta, etc.)

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
    // ACHADO REAL (não só ajuste de curva): PositionalAudio.updateMatrixWorld
    // só sincroniza a posição do PannerNode com a posição de bomb.group
    // quando `isPlaying` é true — e isso só fica true dentro de source.play(),
    // que a gente nunca chama (o oscilador efêmero de pulseTone() é ligado
    // direto em source.gain, sem passar pelo play/pause do THREE.Audio). Com
    // hasPlaybackControl no default (true) e isPlaying sempre false, o
    // panner ficava CONGELADO na origem do mundo (0,0,0) pra sempre — todo
    // bipe de toda bomba saía do centro da sala, não da bomba, e a distância
    // real do jogador até cada bomba nunca era usada (por isso os bipes da
    // caixa de coleta continuavam audíveis na mesa de desarme, quase sem
    // atenuação de verdade). hasPlaybackControl = false pula essa guarda e
    // faz o panner seguir bomb.group a cada frame, como devia desde o início.
    source.hasPlaybackControl = false;
    source.setRefDistance(REF_DISTANCE);
    source.setRolloffFactor(ROLLOFF_FACTOR);
    source.setDistanceModel('exponential');
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
  function pulseTone(source, frequency, peakGain) {
    const ctx = source.context;
    if (ctx.state === 'suspended') ctx.resume();
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = frequency;
    envelope.gain.setValueAtTime(0.0001, ctx.currentTime);
    envelope.gain.exponentialRampToValueAtTime(peakGain, ctx.currentTime + 0.015);
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
        const holdingController = grabSystem.getHoldingController(bomb.group);
        pulseTone(alarm.source, frequency, holdingController ? GAIN_HELD : GAIN_IDLE);

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
