const SPAWN_INTERVAL_FIXED = 12;
const MAX_PENDING = 5;
// Janela extra para o jogador ir até o dispenser puxar a alavanca antes do
// fallback automático soltar a bomba sozinho — preserva a regra do
// CLAUDE.md de que ele não pode "pausar" a pressão do jogo ficando parado,
// agora que soltar a bomba passou a exigir uma ação física (Estação 1 do
// documento de especificação).
const LEVER_GRACE_SECONDS = 6;

// Fluxo de bombas contínuo — substitui o antigo bombManager.js (spawn ramp
// de dificuldade + estações fixas ocupadas). Não existem mais fases: o
// dispenser fica pronto para soltar uma bomba em intervalo fixo (ou quando
// o jogador entrega a anterior na esteira), mas quem solta de fato agora é
// a alavanca física do dispenser (dispenser.js) — este módulo só controla
// QUANDO uma bomba fica pronta (`onReady`, arma o indicador do dispenser) e
// garante que ela sai de qualquer jeito depois de `LEVER_GRACE_SECONDS`
// mesmo que o jogador ignore a alavanca.
export function createBombFlow({ onSpawn, onReady, getPendingCount }) {
  let spawnTimer = SPAWN_INTERVAL_FIXED;
  let ready = false;
  let graceTimer = 0;

  function markReady() {
    if (ready) return;
    // Teto de segurança (não faz parte do CLAUDE.md): evita empilhar bombas
    // infinitamente se o jogador ignorar a caixa de coleta por muito tempo.
    if (getPendingCount() >= MAX_PENDING) return;
    ready = true;
    graceTimer = LEVER_GRACE_SECONDS;
    onReady?.();
  }

  function doSpawn() {
    ready = false;
    onSpawn();
  }

  // Chamado pelo dispenser (game.js) quando o jogador completa o puxão da
  // alavanca — só solta de fato se havia uma bomba armada esperando.
  function confirmSpawn() {
    if (!ready) return;
    doSpawn();
  }

  function update(dt) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      markReady();
      spawnTimer = SPAWN_INTERVAL_FIXED;
    }

    if (ready) {
      graceTimer -= dt;
      if (graceTimer <= 0) doSpawn();
    }
  }

  function notifyDelivered() {
    markReady();
    spawnTimer = SPAWN_INTERVAL_FIXED;
  }

  function start() {
    markReady();
  }

  return { start, update, notifyDelivered, confirmSpawn };
}
