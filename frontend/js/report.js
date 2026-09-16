import { api } from './api.js';
import { getSession } from './session.js';

// Chave gravada por game-3d/src/main.js no evento roundEnd — ver seção 4 do
// plano de implementação do frontend (frontend/instrucao.md). Só o nome da
// chave é o contrato entre as duas pastas.
const PENDING_RESULT_KEY = 'defuse:pendingResult';

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

function renderResult(finalScore, deathsCaused) {
  const positive = finalScore >= 0;
  stateEl.innerHTML = `
    <p class="eyebrow">Fim de turno</p>
    <div class="result-score ${positive ? 'positive' : 'negative'}">${finalScore} pts</div>
    <div class="result-row">
      <p>Mortes causadas</p>
      <p><b style="color:var(--ink)">${deathsCaused}</b></p>
    </div>
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
    renderResult(pending.finalScore, pending.deathsCaused);
  } catch (err) {
    renderError(`Não foi possível registrar a pontuação (${err.message}).`);
  }
}

main();
