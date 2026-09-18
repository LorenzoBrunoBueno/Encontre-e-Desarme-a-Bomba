import * as THREE from 'three';
import { pulseHaptic } from './haptics.js';

const GRAB_RADIUS = 0.35;
const INDICATOR_RADIUS = 0.02;
const COLOR_IDLE = 0x888888;
const COLOR_IN_RANGE = 0x44ff88;

// Force pull ("O Puxão"): resgata objetos fora do alcance normal de grab —
// jogador aponta, segura o gatilho e puxa o pulso pra trás; o objeto some
// mirado e voa até a mão. Ver README da mecânica no CLAUDE.md/documento de
// especificação, seção 1.
const PULL_MAX_RANGE = 6;
// Tolerância de mira: distância perpendicular máxima entre o objeto e o raio
// do controller — objetos não são todos do mesmo tamanho/raycastable de
// forma consistente, então mede-se a distância à LINHA do raio, não uma
// interseção de geometria real.
const PULL_TARGET_RADIUS = 0.12;
// Deslocamento "para trás" (relativo à orientação do controller no início da
// mira) necessário pra confirmar o gesto de puxão, dentro da janela abaixo.
const PULL_GESTURE_DISTANCE = 0.15;
const PULL_GESTURE_WINDOW = 0.5;
const PULL_FLIGHT_DURATION = 0.35;
const PULL_RAY_COLOR = 0xff8800;

// Arremesso ("throw"): ao soltar o grip, objetos registrados como
// `throwable` herdam a velocidade do controller nos últimos frames, em vez
// de simplesmente cair no lugar. Física simples (gravidade + integração
// linear), sem motor de física de verdade — consistente com o resto do
// projeto (CLAUDE.md proíbe Cannon.js/Rapier).
const GRAVITY = 9.8;
const MAX_THROW_SPEED = 8; // clamp — evita arremessos absurdos por jitter de tracking
const THROW_LAND_RADIUS = 0.05; // "raio" aproximado do objeto para pousar no chão

// Sistema genérico de pegar/carregar objetos (bomba, panfleto, alicate) via
// grip (squeeze) — sem motor de física, usando reparenting no scene graph
// (Object3D.attach preserva a transform mundial), igual ao padrão dos
// exemplos oficiais WebXR do three.js.
//
// Diferente do teleporte (mira por raycast), pegar é por PROXIMIDADE: a
// ponta do controller precisa estar a até GRAB_RADIUS de um objeto
// registrado. Cada controller ganha uma pequena esfera indicadora (mesma
// linguagem visual do raio do teleporte) que acende quando há algo pegável
// ao alcance, já que não existe um raio para dar esse feedback aqui.
//
// register(object3D, { grabRotation, throwable, homeAnchor, homePosition,
// homeQuaternion }) aceita um THREE.Quaternion opcional (grabRotation): se
// presente, o objeto sempre assume essa rotação (local, relativa à mão) ao
// ser pego, em vez de manter a rotação em que estava — usado pelo alicate
// para sempre "nascer" com a lâmina apontando pra frente da mão, não importa
// o ângulo em que foi pego. `throwable` (default false) habilita o objeto a
// herdar velocidade do controller ao ser solto (ver seção de arremesso
// abaixo) — bombas usam isso.
//
// `homeAnchor` (opcional, um Object3D): se presente, o objeto NUNCA fica
// "flutuando" onde a mão soltou — ao soltar o grip, ele é reparentado direto
// pra esse anchor e sua posição/rotação local é forçada para
// `homePosition`/`homeQuaternion` (default: origem/identidade), ignorando
// throwable/velocidade. Usado pelas ferramentas do cinto (alicate/chave de
// fenda, ver game.js): sem isso, soltar o grip fora do cinto deixava a
// ferramenta parada no ar pra sempre (scene.attach preserva a posição
// mundial, e elas não são throwable, então nunca caem/pousam em lugar
// nenhum).
//
// isLocked() (opcional) reflete o mesmo travamento de locomoção do modo de
// desarme (teleport.lock()) — force pull fica desativado nesse estado, já
// que o jogador está sentado/parado fazendo tarefas de motricidade fina, não
// circulando pela sala resgatando objetos.
export function createGrabSystem({ scene, controllers, isLocked = () => false }) {
  const grabbables = [];
  const heldByController = new Map(); // controller -> { object3D, throwable }
  // Puxões em andamento (mirando, ainda sem confirmar o gesto) e em voo
  // (gesto confirmado, objeto animando até a mão) — mantidos separados dos
  // grabs normais porque não passam por squeezestart/squeezeend.
  const pullStates = new Map(); // controller -> { entry, startPos, startQuaternion, elapsed }
  const flyingPulls = []; // { object3D, controller, from, elapsed, grabRotation }

  // Velocidade estimada de cada controller (posição atual - posição do
  // frame anterior, dividido por dt) — amostrada a cada update() e lida no
  // momento do squeezeend para decidir a velocidade de arremesso.
  const controllerVelocities = new Map(); // controller -> Vector3
  const controllerLastPositions = new Map(); // controller -> Vector3

  // Objetos arremessados em voo livre (gravidade + velocidade inicial),
  // ainda não pousaram nem acertaram um alvo registrado (registerThrowTarget).
  const thrownObjects = []; // { object3D, velocity }
  const throwTargets = []; // { mesh, radius, onHit }

  const indicators = controllers.map((controller) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(INDICATOR_RADIUS, 12, 12),
      new THREE.MeshBasicMaterial({ color: COLOR_IDLE, transparent: true, opacity: 0.8 })
    );
    controller.add(mesh);
    return mesh;
  });

  // Raio visual só enquanto o jogador está "mirando" um puxão — sem isso não
  // haveria nenhum feedback de que o gesto foi reconhecido antes de puxar o
  // pulso, difícil de testar/ajustar os limiares.
  const pullLines = controllers.map((controller) => {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    const material = new THREE.LineBasicMaterial({ color: PULL_RAY_COLOR, transparent: true, opacity: 0.7 });
    const line = new THREE.Line(geometry, material);
    line.visible = false;
    controller.add(line);
    return line;
  });

  function register(
    object3D,
    { grabRotation = null, throwable = false, homeAnchor = null, homePosition = null, homeQuaternion = null } = {}
  ) {
    grabbables.push({ object3D, grabRotation, throwable, homeAnchor, homePosition, homeQuaternion });
  }

  function unregister(object3D) {
    const index = grabbables.findIndex((entry) => entry.object3D === object3D);
    if (index !== -1) grabbables.splice(index, 1);
  }

  function isHeld(object3D) {
    for (const held of heldByController.values()) {
      if (held.object3D === object3D) return true;
    }
    // Objeto em voo (puxão confirmado ou arremesso em trânsito) já está "em
    // uso" — estações (scanner/mesa/esteira) devem tratá-lo como
    // indisponível, do mesmo jeito que tratam um objeto já segurado.
    for (const flight of flyingPulls) {
      if (flight.object3D === object3D) return true;
    }
    for (const thrown of thrownObjects) {
      if (thrown.object3D === object3D) return true;
    }
    return false;
  }

  // Qual controller está segurando um objeto específico (ou null) — usado
  // pela etapa traseira da bancada (rearPanelModule.js) pra ler a orientação
  // da mão que segura a chave de fenda, sem precisar duplicar o rastreamento
  // de "quem segura o quê" que o grab system já mantém.
  function getHoldingController(object3D) {
    for (const [controller, held] of heldByController.entries()) {
      if (held.object3D === object3D) return controller;
    }
    return null;
  }

  function isTargetedForPull(object3D) {
    for (const state of pullStates.values()) {
      if (state.entry.object3D === object3D) return true;
    }
    return isHeld(object3D);
  }

  function findNearestGrabbable(controller) {
    const tip = new THREE.Vector3();
    controller.getWorldPosition(tip);

    let nearest = null;
    let nearestDistance = GRAB_RADIUS;
    grabbables.forEach((entry) => {
      if (isHeld(entry.object3D)) return;
      const objectPosition = new THREE.Vector3();
      entry.object3D.getWorldPosition(objectPosition);
      const distance = objectPosition.distanceTo(tip);
      if (distance <= nearestDistance) {
        nearest = entry;
        nearestDistance = distance;
      }
    });
    return nearest;
  }

  // Mira do puxão: acha o grabbable mais alinhado com a direção que o
  // controller aponta (-Z local), dentro do alcance máximo — mesma ideia do
  // raycast do teleporte, mas medindo distância à linha em vez de exigir
  // interseção de geometria (os objetos pegáveis não são todos raycastable
  // de forma consistente).
  function findPullTarget(controller) {
    const origin = new THREE.Vector3();
    controller.getWorldPosition(origin);
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(
      controller.getWorldQuaternion(new THREE.Quaternion())
    );

    let best = null;
    let bestPerpendicular = PULL_TARGET_RADIUS;
    grabbables.forEach((entry) => {
      if (isTargetedForPull(entry.object3D)) return;
      const objectPosition = new THREE.Vector3();
      entry.object3D.getWorldPosition(objectPosition);
      const toObject = objectPosition.clone().sub(origin);
      const along = toObject.dot(direction);
      if (along <= 0 || along > PULL_MAX_RANGE) return;
      const perpendicular = toObject.clone().addScaledVector(direction, -along).length();
      if (perpendicular <= bestPerpendicular) {
        bestPerpendicular = perpendicular;
        best = entry;
      }
    });
    return best;
  }

  function completeGrab(descriptor, controller) {
    // Segurança: se a mão já pegou outra coisa (grab normal) enquanto o
    // objeto estava em voo, o puxão simplesmente não completa o attach — o
    // objeto fica parado onde chegou, ainda pegável normalmente depois.
    if (heldByController.has(controller)) return;
    controller.attach(descriptor.object3D);
    if (descriptor.grabRotation) descriptor.object3D.quaternion.copy(descriptor.grabRotation);
    heldByController.set(controller, {
      object3D: descriptor.object3D,
      throwable: descriptor.throwable,
      homeAnchor: descriptor.homeAnchor,
      homePosition: descriptor.homePosition,
      homeQuaternion: descriptor.homeQuaternion,
    });
  }

  controllers.forEach((controller) => {
    controller.addEventListener('squeezestart', () => {
      if (heldByController.has(controller)) return;
      const entry = findNearestGrabbable(controller);
      if (!entry) return;
      completeGrab(entry, controller);
      pulseHaptic(controller, 0.25, 30);
    });

    controller.addEventListener('squeezeend', () => {
      const held = heldByController.get(controller);
      if (!held) return;
      heldByController.delete(controller);

      // Ferramentas do cinto: voltam direto pro anchor, ignorando
      // throwable/velocidade — nunca ficam soltas em voo ou paradas no ar.
      if (held.homeAnchor) {
        held.homeAnchor.add(held.object3D);
        held.object3D.position.copy(held.homePosition ?? new THREE.Vector3());
        held.object3D.quaternion.copy(held.homeQuaternion ?? new THREE.Quaternion());
        return;
      }

      scene.attach(held.object3D);

      const velocity = controllerVelocities.get(controller);
      if (held.throwable && velocity && velocity.length() > 0.5) {
        const clamped = velocity.clone();
        if (clamped.length() > MAX_THROW_SPEED) clamped.setLength(MAX_THROW_SPEED);
        thrownObjects.push({ object3D: held.object3D, velocity: clamped });
      }
    });

    controller.addEventListener('selectstart', () => {
      if (isLocked()) return;
      if (heldByController.has(controller)) return;
      const entry = findPullTarget(controller);
      if (!entry) return;
      const startPos = new THREE.Vector3();
      controller.getWorldPosition(startPos);
      const startQuaternion = controller.getWorldQuaternion(new THREE.Quaternion());
      pullStates.set(controller, { entry, startPos, startQuaternion, elapsed: 0 });
    });

    controller.addEventListener('selectend', () => {
      pullStates.delete(controller);
    });
  });

  function startFlight(entry, controller) {
    // Reparenta pra scene ANTES de animar — o objeto pode estar preso a
    // outra coisa (ex.: panfleto é filho da bomba), então "position" só vira
    // comparável com a posição mundial da mão depois de sair desse pai.
    scene.attach(entry.object3D);
    flyingPulls.push({
      object3D: entry.object3D,
      controller,
      from: entry.object3D.position.clone(),
      elapsed: 0,
      grabRotation: entry.grabRotation,
      throwable: entry.throwable,
      homeAnchor: entry.homeAnchor,
      homePosition: entry.homePosition,
      homeQuaternion: entry.homeQuaternion,
    });
  }

  function updatePullGestures(dt) {
    pullStates.forEach((state, controller) => {
      state.elapsed += dt;
      const currentPos = new THREE.Vector3();
      controller.getWorldPosition(currentPos);
      const displacement = currentPos.clone().sub(state.startPos);
      // "Pra trás" = eixo +Z LOCAL do controller no instante em que a mira
      // começou (não o atual — puxar o pulso já muda a orientação, então
      // reprojetar a cada frame faria o limiar nunca fechar).
      const backward = new THREE.Vector3(0, 0, 1).applyQuaternion(state.startQuaternion);
      const backwardAmount = displacement.dot(backward);

      if (backwardAmount >= PULL_GESTURE_DISTANCE) {
        startFlight(state.entry, controller);
        pulseHaptic(controller, 0.4, 50);
        pullStates.delete(controller);
      } else if (state.elapsed >= PULL_GESTURE_WINDOW) {
        pullStates.delete(controller);
      }
    });
  }

  function updateFlyingPulls(dt) {
    for (let i = flyingPulls.length - 1; i >= 0; i--) {
      const flight = flyingPulls[i];
      flight.elapsed += dt;
      const t = Math.min(flight.elapsed / PULL_FLIGHT_DURATION, 1);
      const handPosition = new THREE.Vector3();
      flight.controller.getWorldPosition(handPosition);
      flight.object3D.position.lerpVectors(flight.from, handPosition, t);
      if (t >= 1) {
        flyingPulls.splice(i, 1);
        completeGrab(flight, flight.controller);
      }
    }
  }

  // Amostra a velocidade linear de cada controller (posição atual menos a
  // do frame anterior, sobre dt) — lida no squeezeend para decidir a
  // velocidade inicial de um arremesso.
  function updateControllerVelocities(dt) {
    if (dt <= 0) return;
    controllers.forEach((controller) => {
      const current = new THREE.Vector3();
      controller.getWorldPosition(current);
      const last = controllerLastPositions.get(controller);
      if (last) {
        controllerVelocities.set(controller, current.clone().sub(last).divideScalar(dt));
      }
      controllerLastPositions.set(controller, current);
    });
  }

  // Retorna o próprio registro (não só void) — conveyor.js guarda essa
  // referência pra poder mudar `radius` depois (cartHitRadius muda por fase,
  // ver game.js#resetRound), sem precisar desregistrar/registrar de novo.
  function registerThrowTarget(mesh, radius, onHit) {
    const target = { mesh, radius, onHit };
    throwTargets.push(target);
    return target;
  }

  // Solta imediatamente tudo que estiver na mão de algum controller, sem
  // física de arremesso — usado só ao reiniciar a rodada em memória (game.js
  // #resetRound, ver game-3d/instrucao.md) pra garantir que nenhuma bomba
  // fique "presa" à mão do jogador entre uma rodada e a próxima. Ferramentas
  // do cinto (homeAnchor) voltam pro anchor, igual ao squeezeend normal;
  // qualquer outra coisa segurada só reparenta pra scene, sem herdar
  // velocidade (diferente do squeezeend, que joga na física de arremesso).
  // Também cancela puxões/arremessos em andamento — casos raros (só
  // acontecem se o timer da rodada zerar no exato frame de um gesto em
  // curso), aceitável simplesmente congelar no lugar.
  function releaseAll() {
    heldByController.forEach((held) => {
      if (held.homeAnchor) {
        held.homeAnchor.add(held.object3D);
        held.object3D.position.copy(held.homePosition ?? new THREE.Vector3());
        held.object3D.quaternion.copy(held.homeQuaternion ?? new THREE.Quaternion());
      } else {
        scene.attach(held.object3D);
      }
    });
    heldByController.clear();
    pullStates.clear();
    flyingPulls.length = 0;
    thrownObjects.length = 0;
  }

  // Física simples de projétil (gravidade + integração linear) para objetos
  // arremessados — sem motor de física real, mesma filosofia do resto do
  // projeto. Cada frame testa contra os alvos registrados
  // (registerThrowTarget, ex.: o carrinho da esteira) antes de checar o chão.
  function updateThrownObjects(dt) {
    for (let i = thrownObjects.length - 1; i >= 0; i--) {
      const thrown = thrownObjects[i];
      thrown.velocity.y -= GRAVITY * dt;
      thrown.object3D.position.addScaledVector(thrown.velocity, dt);

      // Lê `.position` direto, não getWorldPosition(): o objeto foi
      // reparentado pra `scene` (raiz, sem transform própria) antes de virar
      // "thrown" — getWorldPosition() usaria matrixWorld, que só é
      // recalculada no próximo render e ficaria um frame atrasada em relação
      // ao position.addScaledVector acima de acabou de rodar (erro visível
      // em velocidades altas, perto do limite de MAX_THROW_SPEED).
      const objectPosition = thrown.object3D.position;

      const target = throwTargets.find((candidate) => {
        const targetPosition = new THREE.Vector3();
        candidate.mesh.getWorldPosition(targetPosition);
        return targetPosition.distanceTo(objectPosition) <= candidate.radius;
      });
      if (target) {
        thrownObjects.splice(i, 1);
        target.onHit(thrown.object3D);
        continue;
      }

      if (thrown.object3D.position.y <= THROW_LAND_RADIUS) {
        thrown.object3D.position.y = THROW_LAND_RADIUS;
        thrownObjects.splice(i, 1);
      }
    }
  }

  function update(dt = 0) {
    updateControllerVelocities(dt);
    controllers.forEach((controller, index) => {
      const indicator = indicators[index];
      if (heldByController.has(controller)) {
        indicator.visible = false;
        return;
      }
      indicator.visible = true;
      const inRange = !!findNearestGrabbable(controller);
      indicator.material.color.set(inRange ? COLOR_IN_RANGE : COLOR_IDLE);
    });

    pullLines.forEach((line, index) => {
      line.visible = pullStates.has(controllers[index]);
    });

    updatePullGestures(dt);
    updateFlyingPulls(dt);
    updateThrownObjects(dt);
  }

  return { register, unregister, isHeld, update, registerThrowTarget, getHoldingController, releaseAll };
}
