// Fluxo de bombas contínuo — substitui o antigo bombManager.js (spawn ramp
// de dificuldade + estações fixas ocupadas). Não existem mais FASES DE
// RODADA (ondas/estações fixas de bomba): o dispenser fica pronto para
// soltar uma bomba em intervalo fixo (ou quando o jogador entrega a
// anterior na esteira), mas quem solta de fato agora é a alavanca física do
// dispenser (dispenser.js) — este módulo só controla QUANDO uma bomba fica
// pronta (`onReady`, arma o indicador do dispenser) e garante que ela sai de
// qualquer jeito depois de `leverGraceSeconds` mesmo que o jogador ignore a
// alavanca. Isso é um conceito diferente da progressão de FASE DE
// DIFICULDADE persistente entre sessões (game-3d/src/difficulty.js) — essa
// sim existe, e é o que parametriza `spawnIntervalSeconds`/`leverGraceSeconds`/
// `maxPending` abaixo.
export function createBombFlow({
  onSpawn,
  onReady,
  getPendingCount,
  onQueueFull,
  spawnIntervalSeconds = 12,
  leverGraceSeconds = 6,
  maxPending = 5,
}) {
  let spawnTimer = spawnIntervalSeconds;
  let ready = false;
  let graceTimer = 0;

  function markReady() {
    if (ready) return;
    // Teto de segurança (não faz parte do CLAUDE.md): evita empilhar bombas
    // infinitamente se o jogador ignorar a caixa de coleta por muito tempo.
    // onQueueFull avisa quem estiver ouvindo (game.js) que o dispenser
    // parou de armar por causa do teto, não porque "ainda não é hora" —
    // sem isso o jogador não tinha nenhum jeito de distinguir os dois casos
    // (achado do playtest via IWER, ver game-3d/instrucao.md).
    if (getPendingCount() >= maxPending) {
      onQueueFull?.();
      return;
    }
    ready = true;
    graceTimer = leverGraceSeconds;
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
      spawnTimer = spawnIntervalSeconds;
    }

    if (ready) {
      graceTimer -= dt;
      if (graceTimer <= 0) doSpawn();
    }
  }

  function notifyDelivered() {
    markReady();
    spawnTimer = spawnIntervalSeconds;
  }

  function start() {
    markReady();
  }

  return { start, update, notifyDelivered, confirmSpawn };
}
