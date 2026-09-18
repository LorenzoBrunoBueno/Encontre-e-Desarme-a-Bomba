import { test, expect } from '@playwright/test';
import { waitFrames, moveControllerTo, pressTrigger, squeezeDown, squeezeUp, throwTo } from './support/iwerControls.js';

// Playtest E2E do LOOP COMPLETO contra o jogo real (src/main.js/game.js,
// sem reimplementação — diferente de keypad-harness.js), pedido como
// "próximo passo natural" em game-3d/instrucao.md, seção 5: rodar o roteiro
// inteiro (dispenser → alavanca; scanner; bancada → frente; esteira) no
// Immersive Web Emulator antes de validar no Quest 3 real.
//
// Todas as coordenadas mundiais abaixo são calculadas manualmente a partir
// das constantes de produção (roomLayout.js/dispenser.js/scanner.js/
// defuseTable.js/conveyor.js/bomb.js) — não existe nenhum hook de debug no
// jogo real, de propósito (não altera src/), então o teste "joga" só com o
// que um humano teria: posição/proximidade dos controllers. Isso significa
// que fio/botão/senha são exercitados de forma agnóstica à resposta CERTA
// (o objetivo aqui é validar que os mecanismos respondem e nada quebra, não
// validar pontuação — isso já é coberto por keypad.spec.js de forma
// determinística/isolada).

const DISPENSER_LEVER_HANDLE = { x: -0.2, y: 0.4, z: -1.7 }; // dispenser.js: leverPosition + HANDLE_REST_Y
const BOMB_LANDING = { x: -0.6, y: 0.4, z: -2.05 }; // game.js: landingPosition (dispenser station)
const SCANNER_SLOT = { x: 0.6, y: 0.92, z: -2.05 }; // scanner.js: slot local (0,0.92,0), rotationY=0
const TABLE_DROP = { x: 2.25, y: 0.86, z: 0 }; // defuseTable.js: tableTop world ~(2.25,0.75,0), SLOT_RADIUS 0.35
const TABLE_MODE_BUTTON = { x: 1.85, y: 0.815, z: 0 }; // defuseTable.js: modeButtonLocalPos rotated -90° (east wall)
// Centros dos 4 quadrantes da bomba já travada na mesa (bomb.js QUADRANTS,
// rotacionados pela parede leste da mesa) — qual peça (fio/botão/teclado)
// cai em qual quadrante é sorteado por bomba, então visitamos os 4.
const TABLE_QUADRANTS = [
  { x: 2.4, y: 1.03, z: -0.15 },
  { x: 2.4, y: 1.03, z: 0.15 },
  { x: 2.1, y: 1.03, z: -0.15 },
  { x: 2.1, y: 1.03, z: 0.15 },
];
const CONVEYOR_CART_REST = { x: -2.5, y: 0.58, z: 0 }; // conveyor.js: cart local (0,0.58,0) quando cartPhase≈inteiro (sin≈0)
// Fase 1 (difficulty.js, a que main.js usa por padrão sem localStorage
// 'defuse:currentPhase') usa cartCycleSpeed=0.4 e cartHitRadius=0.24 — mais
// generoso que o valor único que o repo tinha antes (0.5 Hz / 0.18), achado
// do playtest anterior (0 acertos em 5 tentativas). sin(2π·0.4·t) cruza 0 a
// cada 1/(2·0.4)=1.25s — essa é a janela (CART_HALF_PERIOD_MS) usada pro
// jitter aleatório do retry loop logo abaixo.
const CART_HALF_PERIOD_MS = 1250;

async function gotoHarness(page) {
  await page.goto('/tests/e2e/webxr/full-loop-harness.html');
  await page.waitForFunction(() => window.__harnessReady === true);
}

async function enterRealVR(page) {
  // Clica o VRButton DE VERDADE criado por game.js (VRButton.createButton),
  // em vez de chamar requestSession direto — exercita o mesmo caminho que
  // um jogador clicando no Quest percorreria.
  const button = page.locator('#VRButton');
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click();
  await expect(button).toHaveText('EXIT VR', { timeout: 5_000 });
  await waitFrames(page, 5);
}

// Prever o instante exato em que o carrinho cruza o centro a partir do
// wall-clock do processo do teste não funciona de forma confiável aqui: o
// `cartPhase` da esteira começa a correr assim que main.js chama
// game.start() (dentro de gotoHarness/page.goto, antes até do harness ficar
// pronto), não no momento em que ESTE teste chama Date.now() — o offset real
// entre os dois é desconhecido e varia por execução (tempo de carregar o
// bundle Vite/Three.js). Em vez de tentar acertar esse offset, cada
// tentativa espera um atraso ALEATÓRIO dentro de uma janela-alvo — com
// tentativas suficientes, a chance de pelo menos uma cair dentro da janela
// real de acerto (~27% do meio-período na fase 1) fica alta o bastante sem
// precisar conhecer o offset.
function randomJitterMs() {
  return Math.random() * CART_HALF_PERIOD_MS;
}

test.describe('Loop completo (dispenser → scanner → mesa → esteira) via IWER', () => {
  test('joga uma bomba inteira sem erros de console e confirma os eventos do contrato', async ({ page }) => {
    test.setTimeout(120_000);

    const consoleErrors = [];
    const pageErrors = [];
    const gameLogs = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (msg.type() === 'error') consoleErrors.push(text);
      if (/^Bomba \d+/.test(text)) gameLogs.push(text);
    });
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    await gotoHarness(page);
    await enterRealVR(page);
    await page.screenshot({ path: 'test-results/full-loop-01-entered-vr.png' });

    // 1) Alavanca do dispenser: aproxima (não precisa de gatilho/squeeze,
    // ver leverSwitch.js) e puxa pra baixo o suficiente pra contar o puxão.
    await moveControllerTo(page, 'right', { position: DISPENSER_LEVER_HANDLE });
    await moveControllerTo(page, 'right', {
      position: { ...DISPENSER_LEVER_HANDLE, y: DISPENSER_LEVER_HANDLE.y - 0.2 },
    });
    await waitFrames(page, 5);
    // dropBomb() anima a queda por FALL_DURATION (0.6s) antes de pousar.
    await page.waitForTimeout(900);
    await page.screenshot({ path: 'test-results/full-loop-02-bomb-dropped.png' });

    // 2) Pega a bomba na caixa de coleta (squeeze por proximidade).
    await moveControllerTo(page, 'right', { position: BOMB_LANDING });
    await squeezeDown(page, 'right');

    // 3) Leva até o slot do scanner e solta — a inserção sozinha dispara o
    // scan (scanner.js: findBombInSlot exige a bomba SOLTA, não segurada).
    await moveControllerTo(page, 'right', { position: SCANNER_SLOT });
    await squeezeUp(page, 'right');
    await page.waitForTimeout(5_600); // SCAN_DURATION = 5s + folga
    await page.screenshot({ path: 'test-results/full-loop-03-scanned.png' });

    // 4) Pega a bomba (agora com panfleto anexado) de volta no slot e leva
    // até a mesa de desarme.
    await moveControllerTo(page, 'right', { position: SCANNER_SLOT });
    await squeezeDown(page, 'right');
    await moveControllerTo(page, 'right', { position: TABLE_DROP });
    await squeezeUp(page, 'right');
    await waitFrames(page, 3);

    // 5) Toca o botão de modo (proximidade) para ENTRAR no modo de desarme.
    await moveControllerTo(page, 'right', { position: TABLE_MODE_BUTTON });
    await waitFrames(page, 3);
    // Sai da hitbox do botão antes de tentar tocar os quadrantes, senão a
    // MESMA aproximação persistente nunca conta como uma nova borda de
    // toque (touchingButton fica true) — mais realista: o jogador afasta a
    // mão do botão depois de apertar.
    await moveControllerTo(page, 'right', { position: { x: 1.85, y: 1.4, z: 0 } });
    await page.screenshot({ path: 'test-results/full-loop-04-defuse-mode.png' });

    // 6) Visita os 4 quadrantes da bomba (fio/botão/teclado, ordem
    // sorteada por bomba) e aperta o gatilho em cada um — sem o alicate na
    // mão, o módulo de fio ignora com segurança (precisa de cutterTip);
    // botão e teclado reagem só por proximidade dos controllers, sem
    // precisar de nenhuma ferramenta (ver buttonChoiceModule.js/
    // keypadModule.js). Objetivo: exercitar os 3 handleTrigger sem crash,
    // não necessariamente acertar a resposta certa (isso já é coberto
    // deterministicamente por keypad.spec.js).
    for (const quadrant of TABLE_QUADRANTS) {
      await moveControllerTo(page, 'right', { position: quadrant });
      await pressTrigger(page, 'right');
    }
    await page.screenshot({ path: 'test-results/full-loop-05-modules-poked.png' });

    // 7) Sai do modo de desarme (mesmo botão, nova borda de toque).
    await moveControllerTo(page, 'right', { position: { x: 1.85, y: 1.4, z: 0 } });
    await moveControllerTo(page, 'right', { position: TABLE_MODE_BUTTON });
    await waitFrames(page, 3);
    await moveControllerTo(page, 'right', { position: { x: 1.85, y: 1.4, z: 0 } });

    // 8) Pega a bomba de volta e leva até a esteira, mirando o carrinho —
    // precisa de velocidade >0.5 m/s NO FRAME em que squeezeend dispara pro
    // grab system contar como arremesso de verdade (ver throwTo() em
    // support/iwerControls.js). Ver randomJitterMs() acima pra por que a
    // espera antes de cada tentativa é aleatória, não calculada.
    const throwFrom = { ...CONVEYOR_CART_REST, x: CONVEYOR_CART_REST.x - 0.4 };
    await moveControllerTo(page, 'right', { position: TABLE_DROP });
    await squeezeDown(page, 'right');
    await moveControllerTo(page, 'right', { position: throwFrom });

    let delivered = false;
    for (let attempt = 0; attempt < 8 && !delivered; attempt++) {
      await page.waitForTimeout(randomJitterMs());
      await throwTo(page, 'right', { from: throwFrom, to: CONVEYOR_CART_REST });
      await page.waitForTimeout(400); // EXIT_TRAVEL_DURATION (0.7s) só conta depois de acertar o carrinho
      delivered = gameLogs.some((line) => /entregue/.test(line));
      if (!delivered) {
        // Errou o carrinho: a bomba cai no chão perto da esteira, mas
        // continua pegável (registro no grab system não é removido em
        // updateThrownObjects ao pousar) — pega de novo pra tentar de novo.
        await page.waitForTimeout(150);
        await moveControllerTo(page, 'right', { position: CONVEYOR_CART_REST });
        await squeezeDown(page, 'right');
        await moveControllerTo(page, 'right', { position: throwFrom });
      }
    }
    await page.screenshot({ path: 'test-results/full-loop-06-conveyor.png' });

    console.log('[full-loop] eventos do contrato observados:', gameLogs);
    console.log('[full-loop] carrinho da esteira acertado:', delivered);

    expect(pageErrors, `Erros não tratados na página: ${pageErrors.join('\n')}`).toEqual([]);
    expect(consoleErrors, `console.error durante o loop: ${consoleErrors.join('\n')}`).toEqual([]);
    expect(gameLogs.some((line) => /liberada pelo dispenser/.test(line))).toBe(true);
    expect(gameLogs.some((line) => /escaneada/.test(line))).toBe(true);
    // Entregar no carrinho é sensível ao timing real do vaivém (não é o
    // foco deste smoke test) — não falha o teste sozinho, só reporta.
  });
});
