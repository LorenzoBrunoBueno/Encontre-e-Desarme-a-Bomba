import * as THREE from 'three';

// Os 3 efeitos de explosão (game-3d/src/assets/bombSounds) — import estático
// de cada arquivo (não import.meta.glob): só 3 arquivos fixos, e nomes
// explícitos aqui já documentam quais sons existem, sem depender de
// descoberta automática de bundler pra uma lista tão pequena.
import explosionUrlA from './assets/bombSounds/ElevenLabs_Impacto_de_míssil,_explosão_massiva_com_destroços_em_chamas.mp3';
import explosionUrlB from './assets/bombSounds/freesound_community-hq-explosion-6288.mp3';
import explosionUrlC from './assets/bombSounds/professionalsfx-nuclear-explosion-507442.mp3';

const EXPLOSION_URLS = [explosionUrlA, explosionUrlB, explosionUrlC];

// Volume baixo + filtro passa-baixa simulam a explosão acontecendo do OUTRO
// LADO da parede (documento de especificação: a bomba entregue incorretamente
// "estoura fora da sala") — a bomba some pra sempre ao cruzar a cortina da
// esteira (conveyor.js#completeDelivery), então o único jeito de vender "ela
// estourou lá fora" é o som chegando abafado/distante, nunca perto do ouvido
// do jogador.
const VOLUME = 0.35;
const LOWPASS_FREQUENCY = 450;

// Som de explosão da bomba entregue incorretamente — disparado por
// conveyor.js (onIncorrectDelivery) via game.js. Cicla ALEATORIAMENTE entre
// os 3 arquivos de bombSounds a cada disparo, em vez de sempre tocar o
// mesmo. Não é POSICIONAL (THREE.PositionalAudio, como proximityAlarm.js) de
// propósito: a explosão acontece fora da sala, sem nenhum Object3D físico
// dentro dela pra ancorar a fonte — um THREE.Audio comum, preso ao
// AudioListener global, já entrega a sensação de "distante" via volume/
// filtro, sem precisar fingir uma posição 3D que não existe.
export function createBombExplosionSfx({ listener }) {
  const loader = new THREE.AudioLoader();
  const buffers = [];

  // Carrega os 3 em paralelo, best-effort: se um falhar (ex.: asset ausente
  // num build futuro), os outros continuam disponíveis pro sorteio em play().
  EXPLOSION_URLS.forEach((url) => {
    loader.load(url, (buffer) => buffers.push(buffer));
  });

  function play() {
    if (buffers.length === 0) return; // ainda carregando, ou todos falharam
    const buffer = buffers[Math.floor(Math.random() * buffers.length)];

    const sound = new THREE.Audio(listener);
    sound.setVolume(VOLUME);
    const lowpass = listener.context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = LOWPASS_FREQUENCY;
    sound.setFilter(lowpass);
    sound.setBuffer(buffer);
    // Cada disparo cria uma THREE.Audio nova (explosões são raras, não vale
    // manter um pool, mesmo raciocínio de createDeliveryChime em audio.js) —
    // sem desconectar ao terminar, o GainNode/BiquadFilter ficariam
    // pendurados no grafo do AudioContext pra sempre.
    sound.onEnded = () => sound.disconnect();
    sound.play();
  }

  return { play };
}
