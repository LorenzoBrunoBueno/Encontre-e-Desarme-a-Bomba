import { api } from './api.js';

// Precisa espelhar MAX_PHASE de game-3d/src/difficulty.js — /frontend e
// /game-3d são bundlers separados sem módulo compartilhado real (ver
// frontend/instrucao.md, seção 2), então esse número é duplicado
// deliberadamente aqui, não importado.
const MAX_PHASE = 3;

// Modal de seleção de fase, aberto ao clicar "Entrar em VR" (antes do
// tutorial). Progresso vem de GET /api/progress/{playerId}
// (currentPhase/highestPhaseUnlocked) — a fase escolhida aqui não precisa
// ser a currentPhase salva: o jogador pode voltar a jogar qualquer fase já
// desbloqueada (highestPhaseUnlocked nunca diminui), só não pode pular pra
// uma fase ainda não alcançada.
// Mensagem exata devolvida pelas Functions quando o playerId salvo não
// existe mais em `players` (ver api/src/functions/progress.js) — acontece
// na prática quando o Azurite local é reiniciado sem persistência entre uma
// sessão de teste e outra: o backend esquece o jogador, mas o localStorage
// do navegador continua "logado" com esse id órfão.
const STALE_PLAYER_ERROR = 'playerId não encontrado';

export function setupPhaseSelectModal({ getSession, onPhaseChosen, onSessionInvalid }) {
  const scrim = document.getElementById('phase-scrim');
  const listEl = document.getElementById('phase-list');
  const errorText = document.getElementById('phase-error');
  const closeBtn = document.getElementById('phase-close');

  function renderLoading() {
    listEl.innerHTML = '<p class="empty-state">Carregando progresso…</p>';
    errorText.textContent = '';
  }

  function renderError(message) {
    listEl.innerHTML = '';
    errorText.textContent = message;
  }

  function renderPhases(currentPhase, highestPhaseUnlocked) {
    errorText.textContent = '';
    const cards = [];
    for (let phase = 1; phase <= MAX_PHASE; phase++) {
      const locked = phase > highestPhaseUnlocked;
      let status;
      if (locked) status = '🔒 Bloqueada';
      else if (phase === currentPhase) status = 'Continuar';
      else if (phase < highestPhaseUnlocked) status = 'Concluída — jogar de novo';
      else status = 'Nova';
      cards.push(`
        <button type="button" class="phase-card${locked ? ' locked' : ''}" data-phase="${phase}" ${locked ? 'disabled' : ''}>
          <span class="phase-num">Fase ${phase}</span>
          <span class="phase-status">${status}</span>
        </button>
      `);
    }
    listEl.innerHTML = cards.join('');
    listEl.querySelectorAll('.phase-card:not(.locked)').forEach((card) => {
      card.addEventListener('click', () => {
        const phase = Number(card.dataset.phase);
        close();
        onPhaseChosen(phase);
      });
    });
  }

  async function open() {
    scrim.hidden = false;
    renderLoading();
    const session = getSession();
    try {
      const progress = await api.getProgress(session.playerId);
      renderPhases(progress.currentPhase, progress.highestPhaseUnlocked);
    } catch (err) {
      if (err.message === STALE_PLAYER_ERROR) {
        close();
        onSessionInvalid();
        return;
      }
      renderError(`Não foi possível carregar seu progresso (${err.message}).`);
    }
  }

  function close() {
    scrim.hidden = true;
  }

  closeBtn.addEventListener('click', close);

  return { open, close };
}
