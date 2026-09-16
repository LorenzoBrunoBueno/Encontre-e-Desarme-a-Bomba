import { api } from './api.js';
import { setSession } from './session.js';

// Modal de configurações — hoje só expõe renomear o jogador, porque é a
// única operação que o backend e o jogo de fato usam (settings é um objeto
// livre no schema, mas nada em game-3d lê nenhuma chave dele ainda).
export function setupSettingsModal({ getSession, onRenamed }) {
  const scrim = document.getElementById('settings-scrim');
  const form = document.getElementById('settings-form');
  const nameInput = document.getElementById('settings-name');
  const pillWrap = document.getElementById('settings-pill-wrap');
  const errorText = document.getElementById('settings-error');
  const submitBtn = document.getElementById('settings-submit');

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

  return { open, close };
}
