// Identidade do jogador no dispositivo — o playerId funciona como
// credencial de fato pra scores/progress/settings (ver api/instrucao.md,
// seção 2). game-3d/src/main.js lê a mesma chave "defuse:playerId" pra
// decidir se libera a entrada na cena — é o único contrato entre as duas
// pastas, por isso o nome da chave não pode mudar sem atualizar as duas.
const PLAYER_ID_KEY = 'defuse:playerId';
const PLAYER_NAME_KEY = 'defuse:playerName';

export function getSession() {
  const playerId = localStorage.getItem(PLAYER_ID_KEY);
  const name = localStorage.getItem(PLAYER_NAME_KEY);
  return playerId ? { playerId, name } : null;
}

export function setSession(playerId, name) {
  localStorage.setItem(PLAYER_ID_KEY, playerId);
  localStorage.setItem(PLAYER_NAME_KEY, name);
}

export function clearSession() {
  localStorage.removeItem(PLAYER_ID_KEY);
  localStorage.removeItem(PLAYER_NAME_KEY);
}
