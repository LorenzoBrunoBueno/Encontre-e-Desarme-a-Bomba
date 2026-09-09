const ROUND_DURATION_SECONDS = 300;
const TENSION_WARNING_SECONDS = 15;

// Timer de partida fixo, mas OCULTO do jogador — sem contagem regressiva
// visível em nenhum lugar da cena (CLAUDE.md). A música de tensão nos
// últimos ~15s é o único aviso de que o tempo está acabando; ao zerar, a
// partida termina.
export function createRoundTimer({
  durationSeconds = ROUND_DURATION_SECONDS,
  onTensionStart,
  onRoundEnd,
}) {
  let elapsed = 0;
  let tensionTriggered = false;
  let ended = false;

  function update(dt) {
    if (ended) return;
    elapsed += dt;
    const remaining = durationSeconds - elapsed;

    if (!tensionTriggered && remaining <= TENSION_WARNING_SECONDS) {
      tensionTriggered = true;
      onTensionStart?.();
    }
    if (remaining <= 0) {
      ended = true;
      onRoundEnd?.();
    }
  }

  function reset() {
    elapsed = 0;
    tensionTriggered = false;
    ended = false;
  }

  return {
    update,
    reset,
    get ended() {
      return ended;
    },
  };
}
