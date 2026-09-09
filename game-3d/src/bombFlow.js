const SPAWN_INTERVAL_FIXED = 12;
const MAX_PENDING = 5;

// Fluxo de bombas contínuo — substitui o antigo bombManager.js (spawn ramp
// de dificuldade + estações fixas ocupadas). Não existem mais fases: o
// dispenser solta uma bomba em intervalo fixo, e cada entrega na esteira
// repõe o "estoque" imediatamente, resetando o intervalo para não duplicar
// spawns logo em seguida.
export function createBombFlow({ onSpawn, getPendingCount }) {
  let spawnTimer = SPAWN_INTERVAL_FIXED;

  function trySpawn() {
    // Teto de segurança (não faz parte do CLAUDE.md): evita empilhar bombas
    // infinitamente se o jogador ignorar a caixa de coleta por muito tempo.
    if (getPendingCount() >= MAX_PENDING) return;
    onSpawn();
  }

  function update(dt) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      trySpawn();
      spawnTimer = SPAWN_INTERVAL_FIXED;
    }
  }

  function notifyDelivered() {
    trySpawn();
    spawnTimer = SPAWN_INTERVAL_FIXED;
  }

  function start() {
    trySpawn();
  }

  return { start, update, notifyDelivered };
}
