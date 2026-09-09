import { randomInt } from './random.js';

const CORRECT_POINTS = 100;
const INCORRECT_POINTS = -100;

// Pontuação e histórico de entregas — usados só no relatório final
// (game.on('roundEnd', ...)). Nada disso é exibido ao jogador durante a
// partida: o resultado de cada bomba fica oculto até o fim do turno.
export function createScoreManager() {
  let score = 0;
  let deathsCaused = 0;
  const bombLog = [];

  function recordDelivery(bombId, wasCorrect) {
    if (wasCorrect) {
      score += CORRECT_POINTS;
    } else {
      score += INCORRECT_POINTS;
      deathsCaused += randomInt(1, 6);
    }
    bombLog.push({ bombId, wasCorrect });
  }

  return {
    recordDelivery,
    get score() {
      return score;
    },
    get deathsCaused() {
      return deathsCaused;
    },
    get bombLog() {
      return bombLog;
    },
  };
}
