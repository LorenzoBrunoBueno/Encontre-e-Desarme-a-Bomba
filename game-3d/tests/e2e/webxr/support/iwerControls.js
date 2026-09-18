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

// Segura o grip (squeeze) — diferente de pressTrigger, fica "down" até
// squeezeUp ser chamado explicitamente, porque grab.js reage a
// squeezestart/squeezeend como um hold (pegar e carregar), não um toque
// único como o gatilho.
async function squeezeDown(page, handedness) {
  await page.evaluate(
    (handedness) => window.__iwer.xrDevice.controllers[handedness].updateButtonValue('squeeze', 1),
    handedness
  );
  await waitFrames(page, 2); // processa o pendingValue → dispara squeezestart
}

async function squeezeUp(page, handedness) {
  await page.evaluate(
    (handedness) => window.__iwer.xrDevice.controllers[handedness].updateButtonValue('squeeze', 0),
    handedness
  );
  await waitFrames(page, 2); // dispara squeezeend
}

// Arremesso de verdade: grab.js só entra em thrownObjects (velocidade
// herdada, ver grab.js#updateControllerVelocities/squeezeend) se a
// velocidade do controller no EXATO frame em que squeezeend dispara ainda
// for > 0.5 m/s. Uma sequência de moveControllerTo()/squeezeUp() (cada uma
// um round-trip Node↔página separado) não garante isso: entre um passo e o
// próximo o controller fica PARADO por 1-2 frames antes do salto seguinte, e
// como updateControllerVelocities roda a cada frame (grabSystem.update, fora
// do `if (running)` de game.js), a velocidade calculada nos frames parados
// decai de volta pra ~0 — squeezeend pode acabar disparando bem nesse
// intervalo parado, sem nenhum arremesso de verdade acontecer.
//
// Este helper roda a animação INTEIRA (posição a cada frame + a liberação do
// squeeze no meio) num único page.evaluate, com seu próprio loop de
// requestAnimationFrame — sem round-trips Node↔página entre frames — pra
// garantir velocidade constante em TODO frame do movimento, não só nos
// instantes em que o Node decide reposicionar.
async function throwTo(page, handedness, { from, to, releaseAtFrame = 3, totalFrames = 8 } = {}) {
  await page.evaluate(
    ({ handedness, from, to, releaseAtFrame, totalFrames }) =>
      new Promise((resolve) => {
        const controller = window.__iwer.xrDevice.controllers[handedness];
        let frame = 0;
        function tick() {
          const t = Math.min(frame / totalFrames, 1);
          controller.position.set(
            from.x + (to.x - from.x) * t,
            from.y + (to.y - from.y) * t,
            from.z + (to.z - from.z) * t
          );
          if (frame === releaseAtFrame) {
            controller.updateButtonValue('squeeze', 0);
          }
          frame += 1;
          // +3 frames de margem no fim, parado no destino, pra garantir que
          // o squeezeend (que só processa no PRÓXIMO frame depois do
          // pendingValue) já disparou antes deste evaluate resolver.
          if (frame <= totalFrames + 3) requestAnimationFrame(tick);
          else resolve();
        }
        requestAnimationFrame(tick);
      }),
    { handedness, from, to, releaseAtFrame, totalFrames }
  );
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
  squeezeDown,
  squeezeUp,
  throwTo,
  readDebugState,
  keyWorldPosition,
  confirmWorldPosition,
};
