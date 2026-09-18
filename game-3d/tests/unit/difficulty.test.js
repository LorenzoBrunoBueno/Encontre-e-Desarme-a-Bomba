// Teste unitário puro (sem THREE/DOM) — mesma convenção do runner já usado
// em api/test/api.test.js (node:test + node:assert/strict), evita introduzir
// Vitest/Jest só pra isso.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getDifficultyConfig, clampPhase, MAX_PHASE } from '../../src/difficulty.js';

describe('difficulty.js', () => {
  test('fase fora do intervalo faz clamp em vez de lançar', () => {
    assert.doesNotThrow(() => getDifficultyConfig(0));
    assert.doesNotThrow(() => getDifficultyConfig(-5));
    assert.doesNotThrow(() => getDifficultyConfig(99));
    assert.doesNotThrow(() => getDifficultyConfig(undefined));
    assert.doesNotThrow(() => getDifficultyConfig(Number.NaN));

    assert.equal(clampPhase(0), 1);
    assert.equal(clampPhase(-5), 1);
    assert.equal(clampPhase(99), MAX_PHASE);
    assert.equal(clampPhase(Number.NaN), 1);
  });

  test('getDifficultyConfig(phase) usa a mesma fase clampada de clampPhase', () => {
    for (const phase of [1, 2, 3, 4, 0, -1]) {
      const config = getDifficultyConfig(phase);
      const expected = getDifficultyConfig(clampPhase(phase));
      assert.deepEqual(config, expected);
    }
  });

  test('scoreToAdvance só é null na última fase (teto de dificuldade)', () => {
    for (let phase = 1; phase < MAX_PHASE; phase++) {
      assert.notEqual(
        getDifficultyConfig(phase).scoreToAdvance,
        null,
        `fase ${phase} deveria ter um threshold pra avançar`
      );
    }
    assert.equal(getDifficultyConfig(MAX_PHASE).scoreToAdvance, null);
  });

  test('thresholds de toque ficam mais apertados (ou iguais) a cada fase', () => {
    for (let phase = 1; phase < MAX_PHASE; phase++) {
      const current = getDifficultyConfig(phase);
      const next = getDifficultyConfig(phase + 1);
      assert.ok(
        next.wireButtonTouchThreshold <= current.wireButtonTouchThreshold,
        `wireButtonTouchThreshold deveria diminuir ou igualar da fase ${phase} pra ${phase + 1}`
      );
      assert.ok(
        next.keypadTouchThreshold <= current.keypadTouchThreshold,
        `keypadTouchThreshold deveria diminuir ou igualar da fase ${phase} pra ${phase + 1}`
      );
    }
  });

  test('esteira fica mais difícil (raio menor, ciclo mais rápido) a cada fase', () => {
    for (let phase = 1; phase < MAX_PHASE; phase++) {
      const current = getDifficultyConfig(phase);
      const next = getDifficultyConfig(phase + 1);
      assert.ok(next.cartHitRadius <= current.cartHitRadius);
      assert.ok(next.cartCycleSpeed >= current.cartCycleSpeed);
    }
  });
});
