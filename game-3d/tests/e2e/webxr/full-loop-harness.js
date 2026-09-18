import { XRDevice, metaQuest3 } from 'iwer';

// Harness E2E — diferente de keypad-harness.js (que remonta só um módulo
// isolado), este aqui sobe o JOGO REAL sem nenhuma reimplementação: importa
// src/main.js tal como o Quest 3 carregaria via index.html. A única
// diferença do fluxo real é o runtime WebXR por trás de navigator.xr — aqui
// é o IWER (mesma engine da extensão "Immersive Web Emulator"), instalado
// ANTES de main.js rodar, pra VRButton.createButton() (chamado dentro de
// game.js) already enxergar isSessionSupported()=true.
//
// Import DINÂMICO de main.js é necessário aqui: imports estáticos são
// hoisted e rodariam antes da linha installRuntime() abaixo, deixando
// main.js criar o VRButton contra um navigator.xr ainda não instalado.
const xrDevice = new XRDevice(metaQuest3);
xrDevice.installRuntime({ forceInstall: true });

// Exposto só para o teste Playwright (support/iwerControls.js) — nenhum
// destes globals existe no jogo de verdade.
window.__iwer = { xrDevice };
window.__harnessReady = true;

await import('../../../src/main.js');
