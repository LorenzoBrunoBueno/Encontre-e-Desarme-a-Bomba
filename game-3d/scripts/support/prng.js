// PRNG determinístico (mulberry32) — a gravação de demo precisa ser
// reproduzível (mesmo roteiro, mesmo vídeo, requisito do tarefa.md sobre
// "seed fixa"), o que exclui Math.random() (não-determinístico entre
// execuções). mulberry32 é um PRNG minúsculo o suficiente pra não precisar
// de dependência externa, e bom o bastante pra ruído/variação de timing
// (não é usado pra nada que exija qualidade criptográfica).
const DEFAULT_SEED = 0xdefdefde;

export function createRng(seed = DEFAULT_SEED) {
  let state = seed >>> 0;
  // Gera um float em [0, 1) — mesma forma padrão de mulberry32.
  function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // [-1, 1)
  function signed() {
    return next() * 2 - 1;
  }
  // Aplica variação de ±ratio (ex.: ratio=0.15 → ±15%) em cima de `base`.
  function jitter(base, ratio) {
    return base * (1 + signed() * ratio);
  }
  return { next, signed, jitter };
}
