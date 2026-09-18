const PULSE_INTERVAL_MS = 500;

// Música de tensão dos últimos ~15s — hoje é um "batimento" sintetizado via
// Web Audio API, já que o projeto ainda não tem um asset de música
// definitivo. Quando houver um arquivo real, trocar esta implementação por
// THREE.Audio/THREE.AudioLoader carregando de game-3d/public/audio/.
export function createTensionCue() {
  let audioContext = null;
  let intervalId = null;

  function ensureContext() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContextClass();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    return audioContext;
  }

  function pulse() {
    const ctx = ensureContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 220;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    // Era 0.15 — reduzido pra sobrar espaço pro ambiente contínuo de fundo
    // (backgroundMusic.js), que agora toca junto durante essa mesma janela
    // final de ~15s.
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.3);
  }

  function start() {
    stop();
    pulse();
    intervalId = window.setInterval(pulse, PULSE_INTERVAL_MS);
  }

  function stop() {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
  }

  return { start, stop };
}

// Som de entrega da esteira (RoomRefactor item 3) — um "clang" curto tocado
// exatamente no momento em que a bomba cruza a cortina PVC no vão de saída,
// mesma técnica de osciladores acima. Isolado e mínimo de propósito: a
// passada completa de SFX por estação (scanner, corte de fio, teclado etc.)
// continua pendente, documentada em game-3d/instrucao.md seção 3.2 — não é
// escopo deste refactor de sala.
// Feedback sonoro por estação (game-3d/instrucao.md seção 3.2, pendência até
// aqui) — um único AudioContext compartilhado, criado sob demanda no
// primeiro som e reaproveitado por todas as chamadas. Isso importa porque,
// diferente de createTensionCue/createDeliveryChime (instanciados uma vez só
// por partida, em game.js/conveyor.js), este player é passado pra dentro de
// createBomb() e recriado a cada bomba (dispenser.js) — repetir o padrão
// "um AudioContext por instância" aqui multiplicaria contexts a cada bomba
// dispensada, o que os navegadores limitam e o Quest 3 não precisa pagar.
//
// Todo som de resultado de desafio (fio/botão) usa a MESMA intensidade pro
// caso certo e o errado — mesma regra já seguida pelo feedback visual e por
// haptics.js, pra não vazar o resultado antes do relatório final. O teclado
// é a exceção: errar a senha já é visualmente revelado hoje (o visor limpa
// e deixa tentar de novo, ver keypadModule.js#pressConfirm), então soar
// diferente pra "tentativa errada" vs. "senha certa" não é um vazamento novo.
export function createSfxPlayer() {
  let audioContext = null;

  function ensureContext() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContextClass();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    return audioContext;
  }

  function tone({ type = 'sine', freqFrom, freqTo = freqFrom, peakGain = 0.15, duration = 0.12 }) {
    const ctx = ensureContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(freqFrom, ctx.currentTime);
    if (freqTo !== freqFrom) {
      oscillator.frequency.exponentialRampToValueAtTime(freqTo, ctx.currentTime + duration);
    }
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(peakGain, ctx.currentTime + Math.min(0.02, duration / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);
  }

  return {
    // Impacto surdo da bomba pousando na caixa de coleta (dispenser.js).
    playBombLand: () => tone({ type: 'triangle', freqFrom: 90, freqTo: 55, peakGain: 0.2, duration: 0.15 }),
    // Bip curto quando o scan termina (scanner.js#finishScan).
    playScanDone: () => tone({ type: 'square', freqFrom: 660, peakGain: 0.1, duration: 0.09 }),
    // Corte de fio — neutro, mesmo som pro fio certo e o errado.
    playWireCut: () => tone({ type: 'sawtooth', freqFrom: 300, freqTo: 120, peakGain: 0.18, duration: 0.1 }),
    // Clique de botão colorido — neutro, mesmo som pro botão certo e errado.
    playButtonPress: () => tone({ type: 'square', freqFrom: 420, peakGain: 0.12, duration: 0.06 }),
    // Tecla do teclado numérico.
    playKeyPress: () => tone({ type: 'sine', freqFrom: 500, peakGain: 0.1, duration: 0.05 }),
    // Confirmar a senha — som diferente pra acerto/tentativa errada (ver
    // comentário no topo do arquivo sobre por que isso não é um vazamento).
    playKeyConfirm: (success) =>
      success
        ? tone({ type: 'sine', freqFrom: 440, freqTo: 880, peakGain: 0.18, duration: 0.2 })
        : tone({ type: 'sawtooth', freqFrom: 200, freqTo: 140, peakGain: 0.12, duration: 0.15 }),
  };
}

export function createDeliveryChime() {
  let audioContext = null;

  function ensureContext() {
    if (!audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioContextClass();
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    return audioContext;
  }

  function play() {
    const ctx = ensureContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(520, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.3);
  }

  return { play };
}
