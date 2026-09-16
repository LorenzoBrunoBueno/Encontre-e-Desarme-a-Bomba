import { test, expect } from '@playwright/test';
import {
  enterXR,
  moveControllerTo,
  pressTrigger,
  readDebugState,
  keyWorldPosition,
  confirmWorldPosition,
} from './support/iwerControls.js';

// Cobre o caso de uso principal pedido em tarefa.md: digitar um PIN no
// teclado virtual da mesa de desarme usando controllers emulados pelo
// IWER, com posição real (aproximar) + gatilho real (selectstart), contra
// o código de produção de keypadModule.js sem nenhuma alteração de lógica
// (só getters de leitura foram adicionados para o teste observar estado).

async function gotoHarness(page) {
  await page.goto('/tests/e2e/webxr/keypad-harness.html');
  await page.waitForFunction(() => window.__harnessReady === true);
  await enterXR(page);
}

async function typeDigit(page, digit) {
  const position = await keyWorldPosition(page, digit);
  await moveControllerTo(page, 'right', { position });
  await pressTrigger(page, 'right');
}

async function touchConfirm(page) {
  // O botão "OK" confirma por proximidade (toque), não por gatilho — ver
  // keypadModule.js: pressConfirm() dispara quando a ponta do controller
  // cruza o threshold, sem precisar de selectstart.
  const position = await confirmWorldPosition(page);
  await moveControllerTo(page, 'right', { position });
}

test.describe('Teclado de PIN — mesa de desarme (via IWER)', () => {
  test('PIN correto: mirar cada tecla do código real e confirmar reconhece a senha', async ({ page }) => {
    await gotoHarness(page);
    const { code } = await readDebugState(page);

    for (const char of code) {
      await typeDigit(page, Number(char));
    }
    await touchConfirm(page);

    const state = await readDebugState(page);
    expect(state.inputBuffer).toBe(code);
    expect(state.solved).toBe(true);
  });

  test('PIN incorreto: confirmar com senha errada não resolve e limpa o buffer', async ({ page }) => {
    await gotoHarness(page);
    const { code } = await readDebugState(page);
    const wrongCode = code
      .split('')
      .map((char) => String((Number(char) + 1) % 10))
      .join('');

    for (const char of wrongCode) {
      await typeDigit(page, Number(char));
    }
    await touchConfirm(page);

    const state = await readDebugState(page);
    expect(state.solved).toBe(false);
    expect(state.inputBuffer).toBe('');
  });

  test('gatilho longe de qualquer tecla (fora da hitbox) não digita nada', async ({ page }) => {
    await gotoHarness(page);

    await moveControllerTo(page, 'right', { position: { x: 0, y: 5, z: -0.4 } });
    await pressTrigger(page, 'right');

    const state = await readDebugState(page);
    expect(state.inputBuffer).toBe('');
    expect(state.solved).toBe(false);
  });
});
