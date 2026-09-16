import { api } from './api.js';
import { setSession } from './session.js';

// Modal de cadastro/login por nome+PIN (ver CLAUDE.md, "Identidade"). Não é
// um sistema de sessão real — só resolve name+pin -> playerId, que fica
// guardado no localStorage a partir daí (session.js).
export function setupAuthModal({ onAuthenticated }) {
  const scrim = document.getElementById('auth-scrim');
  const form = document.getElementById('auth-form');
  const nameInput = document.getElementById('auth-name');
  const pinInput = document.getElementById('auth-pin');
  const pillWrap = document.getElementById('auth-pill-wrap');
  const errorText = document.getElementById('auth-error');
  const tabRegister = document.getElementById('auth-tab-register');
  const tabLogin = document.getElementById('auth-tab-login');
  const submitBtn = document.getElementById('auth-submit');

  let mode = 'register';

  function setMode(next) {
    mode = next;
    tabRegister.setAttribute('aria-pressed', String(mode === 'register'));
    tabLogin.setAttribute('aria-pressed', String(mode === 'login'));
    submitBtn.textContent = mode === 'register' ? 'Criar conta' : 'Entrar';
    setError('');
  }

  function setError(message) {
    errorText.textContent = message;
    pillWrap.dataset.state = message ? 'erro' : '';
  }

  function open() {
    scrim.hidden = false;
    nameInput.focus();
  }
  function close() {
    scrim.hidden = true;
  }

  tabRegister.addEventListener('click', () => setMode('register'));
  tabLogin.addEventListener('click', () => setMode('login'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    const pin = pinInput.value.trim();
    setError('');
    submitBtn.disabled = true;
    try {
      const player = mode === 'register' ? await api.register(name, pin) : await api.login(name, pin);
      setSession(player.playerId, player.name);
      close();
      onAuthenticated(player);
    } catch (err) {
      setError(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });

  setMode('register');
  return { open, close };
}
