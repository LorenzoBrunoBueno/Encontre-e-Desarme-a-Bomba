import * as THREE from 'three';
import backgroundMusicUrl from './assets/background/monument_music-the-dangerous-game-horror-trailer-147662.mp3';

// Ambiente contínuo de fundo (game-3d/src/assets/background) — toca em loop
// desde o início da sessão até o fim, em volume baixo, sem reagir a
// nenhum evento de jogo (diferente de createTensionCue em audio.js, que só
// liga nos últimos ~15s da rodada — os dois tocam juntos nessa janela final,
// por isso VOLUME aqui fica bem abaixo do pico do bip de tensão).
const VOLUME = 0.12;

// Não é POSICIONAL (THREE.PositionalAudio) de propósito: é ambiente da sala
// inteira, não som de um objeto específico — mesmo raciocínio de
// bombExplosion.js (THREE.Audio comum, preso ao AudioListener global).
export function createBackgroundMusic({ listener }) {
  const sound = new THREE.Audio(listener);
  sound.setLoop(true);
  sound.setVolume(VOLUME);

  let buffer = null;
  // O asset carrega de forma assíncrona (AudioLoader) mas start() pode ser
  // chamado antes dele terminar (ex.: sessão WebXR entrando rápido) — guarda
  // a intenção e dispara o play() sozinho quando o buffer chegar.
  let wantsToPlay = false;

  const loader = new THREE.AudioLoader();
  loader.load(backgroundMusicUrl, (loadedBuffer) => {
    buffer = loadedBuffer;
    sound.setBuffer(buffer);
    if (wantsToPlay && !sound.isPlaying) sound.play();
  });

  function start() {
    wantsToPlay = true;
    // Contexto pode nascer suspenso até um gesto real do usuário (mesma
    // guarda usada em audio.js#ensureContext) — sem isso o loop poderia
    // nunca começar a tocar de fato, mesmo com buffer já carregado.
    if (listener.context.state === 'suspended') listener.context.resume();
    if (buffer && !sound.isPlaying) sound.play();
  }

  function stop() {
    wantsToPlay = false;
    if (sound.isPlaying) sound.stop();
  }

  return { start, stop };
}
