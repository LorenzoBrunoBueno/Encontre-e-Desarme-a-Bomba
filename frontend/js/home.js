import { GAME_URL } from './config.js';
import { getSession } from './session.js';
import { renderLeaderboard } from './leaderboard.js';
import { setupAuthModal } from './auth.js';
import { setupSettingsModal } from './settings.js';

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

const settings = setupSettingsModal({
  getSession,
  onRenamed: () => {
    refreshSessionUI();
    renderLeaderboard(leaderboardEl);
  },
});

enterVrBtn.addEventListener('click', () => {
  if (!getSession()) return;
  window.location.href = GAME_URL;
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
