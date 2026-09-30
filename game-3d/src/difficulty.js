// Config de dificuldade por fase — única peça nova pra suportar a
// progressão persistente entre sessões (`currentPhase`/`highestPhaseUnlocked`,
// ver CLAUDE.md "Contrato de API com o Backend" e api/instrucao.md). Até
// agora "fase" só existia como um número guardado na API: game-3d não lia
// nem influenciava nada com ele (createGame() não tinha parâmetro nenhum) e
// cada módulo (bombFlow.js, conveyor.js, buttonChoiceModule.js/
// keypadModule.js, scanner.js, bomb.js) guardava suas próprias constantes
// privadas de dificuldade, sem nenhum lugar central.
//
// Os valores abaixo são um PONTO DE PARTIDA pra playtesting real, não
// tuning final. Duas correções deliberadas em relação ao que existia antes
// deste arquivo (achadas no playtest via IWER, ver game-3d/instrucao.md):
// - A fase 1 (baseline, o que todo jogador vive primeiro) fica MAIS FÁCIL
//   que os valores únicos que existiam no repo — em especial a esteira
//   (cartHitRadius/cartCycleSpeed), que se mostrou frustrante mesmo com
//   mira calculada matematicamente (0 acertos em 5 tentativas).
// - Os valores que existiam no repo antes deste arquivo viram o TETO de
//   dificuldade (fase 3), não a experiência padrão.
const PHASES = [
  null, // índice 0 não usado — fases são 1-based, como currentPhase da API
  {
    // spawnIntervalSeconds/leverGraceSeconds aumentados (playtest real no
    // Quest 3, 2026-09-30): o valor antigo (12s) fazia bombas se acumularem
    // e explodirem em sequência mesmo desarmando num ritmo razoável.
    spawnIntervalSeconds: 18,
    leverGraceSeconds: 8,
    maxPending: 5,
    scanOverheatInterval: 3,
    bombFuseSeconds: 90,
    wireButtonTouchThreshold: 0.05,
    keypadTouchThreshold: 0.045,
    cartHitRadius: 0.24,
    cartCycleSpeed: 0.4,
    scoreToAdvance: 200,
  },
  {
    spawnIntervalSeconds: 15,
    leverGraceSeconds: 7,
    maxPending: 5,
    scanOverheatInterval: 3,
    bombFuseSeconds: 90,
    wireButtonTouchThreshold: 0.045,
    keypadTouchThreshold: 0.04,
    cartHitRadius: 0.2,
    cartCycleSpeed: 0.45,
    scoreToAdvance: 500,
  },
  {
    // Teto de dificuldade — ainda o ritmo mais apertado do jogo, só que
    // também revisado pra cima junto com as fases 1-2 acima (ver comentário
    // na fase 1).
    spawnIntervalSeconds: 13,
    leverGraceSeconds: 6,
    maxPending: 5,
    scanOverheatInterval: 3,
    bombFuseSeconds: 90,
    wireButtonTouchThreshold: 0.04,
    keypadTouchThreshold: 0.035,
    cartHitRadius: 0.18,
    cartCycleSpeed: 0.5,
    scoreToAdvance: null, // não avança mais — teto de dificuldade
  },
];

export const MAX_PHASE = PHASES.length - 1;

// Usado tanto por getDifficultyConfig quanto por game.js (pra saber qual
// número de fase "de verdade" está em uso, já validado, antes de comparar
// contra scoreToAdvance e decidir se emite `phaseUnlocked`).
export function clampPhase(phase) {
  const numeric = Math.trunc(phase);
  return Math.min(Math.max(Number.isFinite(numeric) && numeric > 0 ? numeric : 1, 1), MAX_PHASE);
}

export function getDifficultyConfig(phase = 1) {
  return PHASES[clampPhase(phase)];
}
