import * as THREE from 'three';
import { XRDevice, metaQuest3 } from 'iwer';
import { createKeypadModule } from '../../../src/keypadModule.js';

// Harness de teste E2E — NÃO faz parte do jogo real (main.js/game.js).
// Monta só o módulo de teclado de PIN (código de produção, sem nenhuma
// alteração de lógica) numa cena Three.js mínima, com o IWER (Immersive
// Web Emulation Runtime — a mesma engine usada pela extensão "Immersive
// Web Emulator") no lugar do headset/controllers físicos. Objetivo:
// validar o fluxo de input (mirar tecla por proximidade + gatilho digita/
// confirma) de ponta a ponta num navegador headless, sem depender do IWE
// manual nem do Quest 3 físico. Ver game-3d/tarefa.md.
//
// Escopo deliberadamente isolado: não sobe o dispenser/scanner/mesa de
// desarme reais (isso exigiria automatizar o grab system inteiro só para
// chegar até o teclado). Um teste de fluxo completo fica como próximo
// passo, documentado no resumo entregue junto com este setup.

const xrDevice = new XRDevice(metaQuest3);
// forceInstall: o Chromium do Playwright já expõe um navigator.xr "nativo"
// (sem nenhum runtime XR de verdade por trás) — sem forceInstall, o IWER
// detecta esse navigator.xr existente e recua (só avisa no console),
// deixando requestSession('immersive-vr') falhar com NotSupportedError.
xrDevice.installRuntime({ forceInstall: true });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.6, 0.4);

const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));

const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
controllers.forEach((controller) => scene.add(controller));

const keypad = createKeypadModule({ onSolved: () => {} });

// Sem a rotação/escala que bomb.js aplica pra deitar o painel sobre o
// corpo da bomba — aqui o painel fica em pé, vertical, do jeito que
// keypadModule.js já desenha nativamente (ver comentário em bomb.js sobre
// os módulos serem "pensados pra ser visto de frente, em pé").
keypad.padGroup.position.set(-0.2, 1.2, -0.4);
keypad.displayGroup.position.set(0.25, 1.2, -0.4);
scene.add(keypad.padGroup, keypad.displayGroup);

controllers.forEach((controller) => {
  controller.addEventListener('selectstart', () => keypad.handleTrigger());
});

const tipPositions = controllers.map(() => new THREE.Vector3());

function animate() {
  controllers.forEach((controller, index) => controller.getWorldPosition(tipPositions[index]));
  keypad.update(1 / 60, tipPositions);
  renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

async function enterXR() {
  const session = await navigator.xr.requestSession('immersive-vr', {
    optionalFeatures: ['local-floor'],
  });
  await renderer.xr.setSession(session);
}

// Exposto só para o teste Playwright: `enterXR` inicia a sessão emulada
// (equivalente a clicar o VRButton do jogo real, sem precisar de UI);
// `xrDevice` é o mesmo objeto que os helpers em support/iwerControls.js
// usam para mover controllers e simular gatilho. window.__debugState lê o
// estado do PIN digitado e calcula as coordenadas mundiais reais de cada
// tecla (via localToWorld), pra o teste nunca precisar inventar/duplicar
// as constantes de layout do keypadModule.js. Nenhum destes globals existe
// no jogo de verdade — são exclusivos deste harness de teste.
window.__iwer = { xrDevice, enterXR };
window.__debugState = {
  get inputBuffer() {
    return keypad.inputBuffer;
  },
  get solved() {
    return keypad.solved;
  },
  code: keypad.code,
  keyWorldPosition(digit) {
    const button = keypad.buttons.find((b) => b.digit === digit);
    return keypad.padGroup.localToWorld(button.position.clone());
  },
  confirmWorldPosition() {
    return keypad.displayGroup.localToWorld(keypad.confirmLocalPos.clone());
  },
};

window.__harnessReady = true;
