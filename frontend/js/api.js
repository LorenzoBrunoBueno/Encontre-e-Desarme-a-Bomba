import { API_BASE } from './config.js';

// Cliente da API — contrato completo em CLAUDE.md ("Contrato de API com o
// Backend") e api/instrucao.md. Todo request é relativo a /api: mesmo
// domínio do frontend em produção (Azure Static Web Apps), sem CORS.
async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Erro ${res.status}`);
  }
  return data;
}

export const api = {
  register: (name, pin) =>
    request('/settings/register', { method: 'POST', body: { name, pin } }),
  login: (name, pin) => request('/settings/login', { method: 'POST', body: { name, pin } }),
  getSettings: (playerId) => request(`/settings/${playerId}`),
  patchSettings: (playerId, patch) =>
    request(`/settings/${playerId}`, { method: 'PATCH', body: patch }),
  postScore: (playerId, score, deathsCaused) =>
    request('/scores', { method: 'POST', body: { playerId, score, deathsCaused } }),
  getLeaderboard: () => request('/leaderboard'),
};
