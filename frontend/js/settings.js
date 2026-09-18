import { api } from './api.js';
import { setSession, clearSession } from './session.js';

// Modal de configurações — hoje expõe renomear o jogador (única operação que
// o backend e o jogo de fato usam; settings é um objeto livre no schema, mas
// nada em game-3d lê nenhuma chave dele ainda) e sair da conta — não havia
// nenhum jeito de trocar de jogador numa máquina já logada antes disso (o
// playerId simplesmente ficava preso no localStorage pra sempre); também é a
// única saída manual pra quando o playerId salvo fica órfão (ex.: Azurite
// local reiniciado sem persistência entre uma sessão de teste e outra —
// zera a tabela `players`, mas não o localStorage do navegador).
export function setupSettingsModal({ getSession, onRenamed, onLoggedOut }) {
  const scrim = document.getElementById('settings-scrim');
  const form = document.getElementById('settings-form');
  const nameInput = document.getElementById('settings-name');
  const pillWrap = document.getElementById('settings-pill-wrap');
  const errorText = document.getElementById('settings-error');
  const submitBtn = document.getElementById('settings-submit');
  const logoutBtn = document.getElementById('settings-logout');

  function setError(message) {
    errorText.textContent = message;
    pillWrap.dataset.state = message ? 'erro' : '';
  }

  function open() {
    const session = getSession();
    nameInput.value = session ? session.name : '';
    setError('');
    scrim.hidden = false;
    nameInput.focus();
  }
  function close() {
    scrim.hidden = true;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const session = getSession();
    if (!session) return;
    const name = nameInput.value.trim();
    setError('');
    submitBtn.disabled = true;
    try {
      const player = await api.patchSettings(session.playerId, { name });
      setSession(player.playerId, player.name);
      close();
      onRenamed(player);
    } catch (err) {
      setError(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });

  logoutBtn.addEventListener('click', () => {
    clearSession();
    close();
    onLoggedOut();
  });

  return { open, close };
}
