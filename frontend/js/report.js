import { api } from './api.js';
import { getSession } from './session.js';

// Chaves gravadas por game-3d/src/main.js no evento roundEnd — ver seção 4
// do plano de implementação do frontend (frontend/instrucao.md). Só o nome
// das chaves é o contrato entre as duas pastas.
const PENDING_RESULT_KEY = 'defuse:pendingResult';
// Gravada só quando game.js emite 'phaseUnlocked' (score do turno bateu o
// scoreToAdvance da fase atual, ver game-3d/src/difficulty.js) — ausente na
// maioria dos turnos, então readPendingPhase() volta null com frequência.
const PENDING_PHASE_KEY = 'defuse:pendingPhase';

const stateEl = document.getElementById('report-state');

function readPendingResult() {
  const raw = localStorage.getItem(PENDING_RESULT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readPendingPhase() {
  const raw = localStorage.getItem(PENDING_PHASE_KEY);
  if (raw === null) return null;
  const phase = parseInt(raw, 10);
  return Number.isFinite(phase) ? phase : null;
}

function renderEmpty() {
  stateEl.innerHTML = `
    <p class="empty-state">Nenhum resultado de partida pendente.</p>
    <div class="modal-actions"><a class="btn primary" href="index.html">Voltar ao menu</a></div>
  `;
}

function renderError(message) {
  stateEl.innerHTML = `
    <p class="pill-error-text" style="margin-top:0">${message}</p>
    <div class="modal-actions"><a class="btn primary" href="index.html">Voltar ao menu</a></div>
  `;
}

function renderResult(finalScore, deathsCaused, unlockedPhase) {
  const positive = finalScore >= 0;
  const phaseNotice = unlockedPhase
    ? `<p class="pill-success-text">Fase ${unlockedPhase} desbloqueada!</p>`
    : '';
  stateEl.innerHTML = `
    <p class="eyebrow">Fim de turno</p>
    <div class="result-score ${positive ? 'positive' : 'negative'}">${finalScore} pts</div>
    <div class="result-row">
      <p>Mortes causadas</p>
      <p><b style="color:var(--ink)">${deathsCaused}</b></p>
    </div>
    ${phaseNotice}
    <div class="modal-actions"><a class="btn primary" href="index.html">Voltar ao menu</a></div>
  `;
}

async function main() {
  const pending = readPendingResult();
  if (!pending) {
    renderEmpty();
    return;
  }

  const session = getSession();
  if (!session) {
    renderError('Nenhum jogador identificado — não foi possível registrar a pontuação.');
    return;
  }

  try {
    await api.postScore(session.playerId, pending.finalScore, pending.deathsCaused);
    localStorage.removeItem(PENDING_RESULT_KEY);

    let unlockedPhase = null;
    const pendingPhase = readPendingPhase();
    if (pendingPhase !== null) {
      try {
        const progress = await api.getProgress(session.playerId);
        await api.patchProgress(session.playerId, {
          currentPhase: pendingPhase,
          highestPhaseUnlocked: Math.max(progress.highestPhaseUnlocked, pendingPhase),
        });
        unlockedPhase = pendingPhase;
      } catch (err) {
        // Não bloqueia a exibição do resultado — a pontuação já foi salva
        // acima; perder um avanço de fase é recuperável (o jogador bate o
        // threshold de novo na próxima partida), diferente de perder score.
        console.warn('Não foi possível salvar o avanço de fase:', err);
      } finally {
        localStorage.removeItem(PENDING_PHASE_KEY);
      }
    }

    renderResult(pending.finalScore, pending.deathsCaused, unlockedPhase);
  } catch (err) {
    renderError(`Não foi possível registrar a pontuação (${err.message}).`);
  }
}

main();
