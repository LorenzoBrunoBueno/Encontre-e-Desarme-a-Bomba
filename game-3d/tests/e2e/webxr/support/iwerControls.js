// Helpers Node-side (rodam no processo do Playwright, não na página) para
// dirigir o headset/controllers emulados pelo IWER a partir de um teste.
// Cada helper recebe o `page` do Playwright e delega para window.__iwer
// (exposto pelo harness em keypad-harness.js) via page.evaluate — o teste
// nunca chama xrDevice diretamente.
//
// IMPORTANTE sobre timing: XRController.updateButtonValue() só marca um
// "pendingValue" (ver node_modules/iwer/lib/device/XRController.js) — o
// valor efetivo, e o disparo de selectstart/selectend, só acontece quando a
// sessão XR processa o próximo frame. Por isso todo helper que mexe em
// pose/botão espera alguns requestAnimationFrame antes de seguir, do jeito
// que a tarefa.md pediu ("aguarda o(s) frame(s) necessário(s)").

async function waitFrames(page, count = 2) {
  await page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let remaining = n;
        function tick() {
          remaining -= 1;
          if (remaining <= 0) resolve();
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }),
    count
  );
}

// Entra na sessão WebXR emulada — equivalente a clicar o VRButton do jogo
// real, mas direto, sem precisar localizar/clicar um elemento de DOM.
async function enterXR(page) {
  await page.evaluate(() => window.__iwer.enterXR());
  await waitFrames(page, 3);
}

// pose = { position: {x,y,z}, quaternion?: {x,y,z,w} } — quaternion é
// opcional porque a maioria das interações do jogo (proximidade) não
// depende da orientação do controller, só da posição da ponta.
async function moveControllerTo(page, handedness, pose) {
  await page.evaluate(
    ({ handedness, pose }) => {
      const controller = window.__iwer.xrDevice.controllers[handedness];
      controller.position.set(pose.position.x, pose.position.y, pose.position.z);
      if (pose.quaternion) {
        controller.quaternion.set(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
      }
    },
    { handedness, pose }
  );
  // Dá tempo do WebXRManager do three.js propagar a nova pose pro
  // Object3D do controller (getWorldPosition) antes do próximo assert.
  await waitFrames(page, 2);
}

// Dispara um clique de gatilho completo (selectstart → selectend), do
// jeito que o binding real do jogo escuta em game.js/defuseTable.js.
async function pressTrigger(page, handedness) {
  await page.evaluate(
    (handedness) => window.__iwer.xrDevice.controllers[handedness].updateButtonValue('trigger', 1),
    handedness
  );
  await waitFrames(page, 2); // processa o pendingValue → dispara selectstart
  await page.evaluate(
    (handedness) => window.__iwer.xrDevice.controllers[handedness].updateButtonValue('trigger', 0),
    handedness
  );
  await waitFrames(page, 2); // dispara selectend
}

async function readDebugState(page) {
  return page.evaluate(() => ({
    inputBuffer: window.__debugState.inputBuffer,
    solved: window.__debugState.solved,
    code: window.__debugState.code,
  }));
}

async function keyWorldPosition(page, digit) {
  return page.evaluate((digit) => window.__debugState.keyWorldPosition(digit), digit);
}

async function confirmWorldPosition(page) {
  return page.evaluate(() => window.__debugState.confirmWorldPosition());
}

export {
  waitFrames,
  enterXR,
  moveControllerTo,
  pressTrigger,
  readDebugState,
  keyWorldPosition,
  confirmWorldPosition,
};
