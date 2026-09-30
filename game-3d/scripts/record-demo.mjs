// Script de gravação de demo (utilitário reaproveitável, não faz parte da
// suite de testes automatizados) — roda o jogo real (main.js, via
// full-loop-harness.js) num Chromium headless do Playwright com o IWER
// instalado direto, e grava a passagem completa de uma bomba pelo fluxo
// (dispenser → scanner → mesa de desarme → esteira) com movimento
// "humanizado" (HumanRig, ver scripts/support/humanRig.js) em vez de
// teleporte cru de coordenadas: minimum-jerk, arcos com overshoot, cabeça
// antecipando a mão, ruído contínuo, trigger/botões com rampa+pausa, seed
// fixa, relógio virtual de 60fps e captura frame a frame de uma câmera
// espectadora — ver game-3d/instrucao.md pra o detalhamento de cada
// requisito.
//
// Rodar a partir de game-3d/: `node scripts/record-demo.mjs` (precisa do
// dev server já rodando em https://localhost:5173/, ver `npm run dev` —
// porta fixa em vite.config.js, strictPort:true).
// Produz game-3d/../test-results/gif-recording/demo.mp4 (via ffmpeg, se
// disponível no PATH — ver support/frameSink.js) e marks.json com os
// timestamps virtuais de cada fase, pra cortar em GIFs depois.
import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import { HumanRig } from './support/humanRig.js';
import { createFrameSink } from './support/frameSink.js';

const OUT_DIR = path.resolve('../test-results/gif-recording');
fs.mkdirSync(OUT_DIR, { recursive: true });

const DEMO_SEED = 20260929; // seed fixa (requisito 7) — mesmo roteiro, mesmo vídeo sempre.

// --- Constantes de mundo das estações (geometria fixa da sala, não
// sorteada por bomba — mesmos valores já usados/derivados em
// full-loop.spec.js) ---
const DISPENSER_LEVER_HANDLE = { x: -0.2, y: 0.4, z: -1.7 };
const BOMB_LANDING = { x: -0.6, y: 0.4, z: -2.05 };
const SCANNER_SLOT = { x: 0.6, y: 0.92, z: -2.05 };
const TABLE_DROP = { x: 2.25, y: 0.86, z: 0 };
const TABLE_MODE_BUTTON = { x: 1.85, y: 0.815, z: 0 };
const TABLE_ROTATE_BUTTON = { x: 1.93, y: 0.808, z: 0.42 };
const PINCERS_HOME = { x: 0.18, y: 0.95, z: -0.12 };
const SCREWDRIVER_HOME = { x: -0.18, y: 0.95, z: -0.12 };
const TRASH_BIN = { x: 2.25, y: 0.25, z: 1.05 };
const CONVEYOR_CART_REST = { x: -2.5, y: 0.58, z: 0 };
const CONVEYOR_THROW_FROM = { x: -2.1, y: 0.9, z: 0.5 };

// Poses da câmera espectadora por fase — plano de "making of" fixo,
// independente da cabeça do jogador (ver window.__test.createSpectatorView
// em game.js). Valores calibrados de olho pro tamanho real da sala
// (ROOM_HALF_X=3, ROOM_HALF_Z=2.6, ver roomLayout.js); ajuste livre se o
// enquadramento não agradar.
const SHOTS = {
  dispenserScanner: { pos: { x: 1.7, y: 2.1, z: -0.5 }, look: { x: -0.2, y: 0.9, z: -1.9 } },
  table: { pos: { x: 3.6, y: 2.0, z: 1.4 }, look: { x: 2.0, y: 1.0, z: 0 } },
  conveyor: { pos: { x: -3.6, y: 2.0, z: 1.2 }, look: { x: -2.2, y: 0.8, z: 0 } },
};

// --- Leituras de estado do jogo (posições que SÃO sorteadas por bomba —
// qual fio/botão/senha é o certo) — mesma técnica do script antigo, via
// window.__iwerDebug (hook de depuração, só existe em modo de gravação). ---
async function readBombTargets(page) {
  return page.evaluate(() => {
    const d = window.__iwerDebug;
    const bomb = d.bombs[0];
    const wire = bomb.wireModule.wires[0];
    const wireWorld = d.localToWorld(bomb.wireModule.group, wire.localSamples[6]);
    const btn = bomb.buttonModule.buttons[0];
    const btnWorld = d.localToWorld(bomb.buttonModule.group, btn.position);
    const digitTargets = [1, 2, 3, 4].map((digit) => {
      const b = bomb.keypadModule.buttons.find((x) => x.digit === digit);
      return d.localToWorld(bomb.keypadModule.padGroup, b.position);
    });
    const confirmWorld = d.localToWorld(bomb.keypadModule.displayGroup, bomb.keypadModule.confirmLocalPos);
    return { wireWorld, btnWorld, digitTargets, confirmWorld };
  });
}

async function readScrewTargets(page) {
  return page.evaluate(() => {
    const d = window.__iwerDebug;
    return d.bombs[0].rearPanelModule.screws.map((s) => d.worldPos(s.mesh));
  });
}

async function readCoreWorld(page) {
  return page.evaluate(() => window.__iwerDebug.worldPos(window.__iwerDebug.bombs[0].rearPanelModule.coreObject));
}

function readToolTip(tool) {
  return (page) =>
    page.evaluate((t) => {
      const d = window.__iwerDebug;
      return t === 'pincers' ? d.pincers.getTipPosition() : d.screwdriver.getTipPosition();
    }, tool);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('[pageerror]', String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[console.error]', msg.text());
  });
  page.on('crash', () => console.error('[FATAL] a aba do Chromium travou (crash) — provável esgotamento de memória/GPU depois de muitos frames com dois WebGLRenderers ativos (headset + espectador). Considere baixar spectatorWidth/spectatorHeight ou a qualidade do JPEG em captureSpectatorFrame.'));

  await page.goto('https://localhost:5173/tests/e2e/webxr/full-loop-harness.html');
  // Instala o relógio fake ANTES de main.js carregar (ver comentário em
  // HumanRig#init sobre por que a ORDEM importa: qualquer THREE.Timer criado
  // antes do install captura um _startTime em tempo real, e trocar pra fake
  // depois produz um delta gigante/negativo no primeiro frame seguinte,
  // quebrando o AudioListener interno do three.js). `install()` sozinho não
  // pausa nada — o tempo continua fluindo normalmente (1:1 com o real) até
  // rig.init() chamar pauseAt(), então o boot da página (harness ready,
  // clique no VRButton, negociação da sessão XR) funciona normalmente.
  await page.clock.install({ time: 0 });
  await page.waitForFunction(() => window.__harnessReady === true, undefined, { polling: 100 });

  const button = page.locator('#VRButton');
  await button.waitFor({ state: 'visible', timeout: 30_000 });
  await button.click();
  await page.waitForFunction(() => document.querySelector('#VRButton')?.textContent === 'EXIT VR', undefined, {
    polling: 100,
  });

  // A partir daqui, tempo vira 100% controlado pelo HumanRig (requisitos
  // 8/9) — rig.init() congela o relógio (pauseAt) e dali em diante só anda
  // via runFor(), um frame de cada vez.
  const rig = new HumanRig(page, { seed: DEMO_SEED, onFrame: undefined });
  await rig.init();

  const sink = await createFrameSink({
    outPath: path.join(OUT_DIR, 'demo.mp4'),
    frameDir: path.join(OUT_DIR, 'frames'),
    fps: 60,
  });
  rig.onFrame = (dataUrl) => sink.write(dataUrl);

  const t0 = rig.virtualNowMs;
  const marks = [];
  function mark(label) {
    marks.push({ label, virtualMs: rig.virtualNowMs - t0 });
    console.log(`MARK ${label} ${((rig.virtualNowMs - t0) / 1000).toFixed(2)}s (virtual)`);
  }

  // Neutraliza o fusível de qualquer bomba que não seja a que o roteiro
  // está acompanhando (mesmo raciocínio do script antigo: o dispenser pode
  // soltar bombas extras via fallback de graça enquanto o roteiro ainda
  // está ocupado em outra estação, e um fusível zerado mata o jogador
  // independente de proximidade). Roda como setInterval de verdade — mas
  // agora "de verdade" quer dizer "a cada 1s de tempo VIRTUAL", já que
  // page.clock também fakeia setInterval.
  await page.evaluate(() => {
    window.__ourBombId = null;
    setInterval(() => {
      window.__iwerDebug.bombs.forEach((bomb) => {
        if (bomb.id !== window.__ourBombId) bomb.startTimer(999999);
      });
    }, 1000);
  });

  // ---------------------------------------------------------------------
  // Roteiro — lista de ações de alto nível (requisito 8), não keyframes.
  // Cada entrada é {label, run}; `run` pode chamar tanto os verbos do
  // HumanRig ("apontar para X" = pointAt, "clicar" = click, "olhar para Y"
  // = lookAt) quanto leituras/bookkeeping simples via `page` direto.
  // ---------------------------------------------------------------------
  const steps = [];
  const step = (label, run) => steps.push({ label, run });

  step('câmera: plano dispenser/scanner', () => rig.setSpectatorPose(SHOTS.dispenserScanner.pos, SHOTS.dispenserScanner.look));
  step('teleportar para dispenser/scanner', () => rig.teleportTo('dispenser_scanner'));

  step('mark dispenser:start', () => mark('dispenser:start'));
  step('puxar alavanca do dispenser', () => rig.pullLever('right', DISPENSER_LEVER_HANDLE, { pulls: 1 }));
  step('aguardar bomba cair (FALL_DURATION)', () => rig.wait(0.9));
  step('pegar bomba na caixa de coleta', () => rig.grab('right', BOMB_LANDING, 'bomb'));
  step('registrar id da bomba acompanhada', () =>
    page.evaluate(() => {
      const bombs = window.__iwerDebug.bombs;
      window.__ourBombId = bombs[bombs.length - 1].id;
    })
  );

  step('mark scanner:start', () => mark('scanner:start'));
  step('levar bomba até o scanner', () => rig.pointAt('right', SCANNER_SLOT));
  step('inserir bomba no slot (dispara o scan)', () => rig.release('right'));
  step('aguardar leitura do scanner (SCAN_DURATION)', () => rig.wait(5.6));

  step('mark table_front:start', () => mark('table_front:start'));
  // Pega a bomba ANTES de teleportar (ela vira filha do controller no grab
  // system — carregar através de um teleporte funciona porque o teleporte
  // só translada o rig inteiro, ver teleport.js, então tudo que já está
  // preso na mão anda junto automaticamente).
  step('pegar bomba escaneada no scanner', () => rig.grab('right', SCANNER_SLOT, 'bomb'));
  step('câmera: plano da mesa de desarme', () => rig.setSpectatorPose(SHOTS.table.pos, SHOTS.table.look));
  step('teleportar para a mesa de desarme', () => rig.teleportTo('defuse_table'));
  step('colocar bomba na mesa de desarme', async () => {
    await rig.pointAt('right', TABLE_DROP);
    await rig.release('right');
  });
  step('entrar no modo de desarme', () => rig.click('right', TABLE_MODE_BUTTON));

  step('cortar o fio certo (alicate)', async () => {
    const targets = await readBombTargets(page);
    await rig.grab('right', PINCERS_HOME, 'pincers');
    await rig.click('right', targets.wireWorld, { readTip: readToolTip('pincers') });
    rig.__targets = targets; // reaproveitado pelos próximos 2 steps
  });
  step('apertar o botão certo', async () => {
    await rig.click('right', rig.__targets.btnWorld);
  });
  step('digitar a senha de 4 dígitos', async () => {
    for (const digitPos of rig.__targets.digitTargets) await rig.click('right', digitPos);
    await rig.click('right', rig.__targets.confirmWorld);
  });

  step('mark table_rear:start', () => mark('table_rear:start'));
  step('devolver alicate ao cinto', () => rig.release('right'));
  step('girar a bomba 180°', () => rig.click('right', TABLE_ROTATE_BUTTON));
  step('aguardar a rotação (ROTATE_DURATION)', () => rig.wait(0.6));

  step('remover os 4 parafusos (chave de fenda)', async () => {
    const screws = await readScrewTargets(page);
    await rig.grab('left', SCREWDRIVER_HOME, 'screwdriver');
    for (const screwPos of screws) {
      await rig.clickRepeat('left', screwPos, 3, { readTip: readToolTip('screwdriver') });
    }
  });
  step('pegar o núcleo/bateria exposto', async () => {
    const core = await readCoreWorld(page);
    await rig.grab('right', core, 'core');
  });
  step('descartar o núcleo no duto', () => rig.throwTo('right', TRASH_BIN, { releaseAt: 0.5 }));

  step('mark conveyor:start', () => mark('conveyor:start'));
  step('devolver chave de fenda ao cinto', () => rig.release('left'));
  step('sair do modo de desarme', () => rig.click('left', TABLE_MODE_BUTTON));
  step('pegar bomba desarmada na mesa', () => rig.grab('left', TABLE_DROP, 'bomb'));
  step('câmera: plano da esteira', () => rig.setSpectatorPose(SHOTS.conveyor.pos, SHOTS.conveyor.look));
  step('teleportar para a esteira', () => rig.teleportTo('conveyor'));
  step('levar a bomba até a posição de arremesso', () => rig.pointAt('left', CONVEYOR_THROW_FROM));
  step('arremessar a bomba contra o carrinho', () => rig.throwTo('left', CONVEYOR_CART_REST, { releaseAt: 0.55 }));
  step('mark conveyor:end', () => mark('conveyor:end'));

  for (const { label, run } of steps) {
    console.log(`STEP ${label}`);
    await run();
  }

  await rig.wait(0.8);

  console.log('total de frames capturados:', rig.frameIndex);
  fs.writeFileSync(`${OUT_DIR}/marks.json`, JSON.stringify(marks, null, 2));

  await sink.close();
  await page.close();
  await context.close();
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
