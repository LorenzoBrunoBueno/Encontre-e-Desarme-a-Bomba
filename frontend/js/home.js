import { GAME_URL } from './config.js';
import { getSession, cacheCurrentPhase } from './session.js';
import { renderLeaderboard } from './leaderboard.js';
import { setupAuthModal } from './auth.js';
import { setupSettingsModal } from './settings.js';
import { setupTutorialModal } from './tutorial.js';
import { setupPhaseSelectModal } from './phaseSelect.js';

const enterVrBtn = document.getElementById('enter-vr-btn');
const sessionBadge = document.getElementById('session-badge');
const sessionActionBtn = document.getElementById('session-action-btn');
const leaderboardEl = document.getElementById('leaderboard');

function refreshSessionUI() {
  const session = getSession();
  if (session) {
    sessionBadge.textContent = `Jogando como ${session.name}`;
    sessionActionBtn.textContent = 'Configurações';
    enterVrBtn.disabled = false;
    enterVrBtn.title = '';
  } else {
    sessionBadge.textContent = 'Nenhum jogador logado';
    sessionActionBtn.textContent = 'Entrar / cadastrar';
    enterVrBtn.disabled = true;
    enterVrBtn.title = 'Cadastre-se ou entre com seu PIN antes de jogar';
  }
}

const auth = setupAuthModal({
  onAuthenticated: () => {
    refreshSessionUI();
    renderLeaderboard(leaderboardEl);
  },
});

// Compartilhado entre "Sair da conta" (settings.js) e a recuperação
// automática de um playerId órfão (phaseSelect.js#onSessionInvalid, ver
// abaixo) — os dois casos terminam do mesmo jeito: sessão local limpa, UI
// atualizada, modal de identificação aberto de novo.
function handleLoggedOut() {
  refreshSessionUI();
  renderLeaderboard(leaderboardEl);
  auth.open();
}

const settings = setupSettingsModal({
  getSession,
  onRenamed: () => {
    refreshSessionUI();
    renderLeaderboard(leaderboardEl);
  },
  onLoggedOut: handleLoggedOut,
});

// Fase escolhida no modal de seleção, repassada pro game-3d só depois do
// tutorial (mesma ordem que já existia: escolher -> tutorial -> VR).
// game-3d/src/main.js lê "defuse:currentPhase" do localStorage pra nascer
// com a config de dificuldade certa (game-3d/src/difficulty.js).
let chosenPhase = 1;

const tutorial = setupTutorialModal({
  onDone: () => {
    cacheCurrentPhase(chosenPhase);
    window.location.href = GAME_URL;
  },
});

const phaseSelect = setupPhaseSelectModal({
  getSession,
  onPhaseChosen: (phase) => {
    chosenPhase = phase;
    tutorial.open();
  },
  // playerId salvo no localStorage não existe mais no backend (ex.: Azurite
  // local reiniciado sem persistência entre sessões de teste) — sem isso o
  // jogador ficava travado numa "conta" fantasma, vendo só um erro dentro
  // do modal, sem nenhum jeito de sair dela pela UI.
  onSessionInvalid: handleLoggedOut,
});

enterVrBtn.addEventListener('click', () => {
  if (!getSession()) return;
  phaseSelect.open();
});

sessionActionBtn.addEventListener('click', () => {
  if (getSession()) {
    settings.open();
  } else {
    auth.open();
  }
});
document.getElementById('settings-close').addEventListener('click', () => settings.close());
document.getElementById('auth-close').addEventListener('click', () => auth.close());

refreshSessionUI();
renderLeaderboard(leaderboardEl);

if (!getSession()) {
  auth.open();
}
