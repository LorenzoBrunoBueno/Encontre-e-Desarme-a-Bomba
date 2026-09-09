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
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
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
