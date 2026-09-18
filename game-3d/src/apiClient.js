// Cliente HTTP mínimo — só as duas chamadas que o loop contínuo entre fases
// precisa fazer sem sair da sessão WebXR (POST /api/scores,
// GET/PATCH /api/progress), usado por main.js#roundContinue (ver
// game-3d/instrucao.md). Duplicado de propósito de frontend/js/api.js: os
// dois bundlers não compartilham módulo (mesma decisão já documentada em
// difficulty.js sobre MAX_PHASE), e aqui só uma fração do client completo é
// necessária — nenhuma tela deste projeto (login/leaderboard/settings) vive
// dentro da sessão WebXR.
const API_BASE = '/api';

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

export const apiClient = {
  postScore: (playerId, score, deathsCaused) =>
    request('/scores', { method: 'POST', body: { playerId, score, deathsCaused } }),
  getProgress: (playerId) => request(`/progress/${playerId}`),
  patchProgress: (playerId, patch) =>
    request(`/progress/${playerId}`, { method: 'PATCH', body: patch }),
};
