import * as THREE from 'three';

const SLOT_RADIUS = 0.35;
const BUTTON_TOUCH_THRESHOLD = 0.09;
const TABLE_TOP_LOCAL_Y = 0.78;
const SNAP_DURATION = 0.18;
const SNAP_SCALE = 1.15;
const ROTATE_DURATION = 0.4;

// Mesa de desarme: o jogador coloca a bomba no slot e toca no botão para
// entrar no "modo de desarme" — locomoção travada (teleport.lock()), bomba
// centralizada e estática (com um pequeno "snap" visual ao travar), panfleto
// à esquerda (se a bomba foi escaneada). Os 3 desafios frontais (fio, botão,
// senha) são ativados juntos, sempre presentes em toda bomba (CLAUDE.md não
// sorteia um subconjunto).
//
// Botão de rotação: gira a bomba 180° em torno do eixo X (não Y — um giro
// no eixo vertical só rearranjaria os módulos frontais sem escondê-los; um
// giro deitando a bomba de cabeça pra baixo é o que expõe a face de baixo,
// onde mora a etapa traseira — rearPanelModule.js, dentro de bomb.js).
//
// O alicate (`pincers`) e a chave de fenda (`screwdriver`) nascem no cinto
// utilitário do jogador (utilityBelt.js, criado e registrado em game.js),
// não fixos num ponto da mesa — esta função só recebe as instâncias prontas
// para consumir sua lógica (getTipPosition/isHeld), não é dona de criá-las.
export function createDefuseTable({
  scene,
  position,
  rotationY = 0,
  grabSystem,
  teleport,
  pincers,
  screwdriver,
  onModeChange,
  onCoreExposed,
}) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  scene.add(group);

  // Mesa aumentada na horizontal (era 0.9x0.6) — a bomba cresceu (0.56x0.56)
  // em fases anteriores e já tomava quase todo o tampo, sem sobrar espaço
  // de verdade para o panfleto e o alicate ao lado dela.
  const top = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 0.06, 0.95),
    new THREE.MeshStandardMaterial({ color: 0x5d4037, roughness: 0.75, metalness: 0.05 })
  );
  top.position.y = 0.75;
  group.add(top);

  // 4 pernas nos cantos, não uma única perna central (lia como "cogumelo").
  const legGeometry = new THREE.BoxGeometry(0.07, 0.75, 0.07);
  const legMaterial = new THREE.MeshStandardMaterial({ color: 0x3e2723, roughness: 0.8, metalness: 0.05 });
  [-1, 1].forEach((sx) => {
    [-1, 1].forEach((sz) => {
      const leg = new THREE.Mesh(legGeometry, legMaterial);
      leg.position.set(sx * 0.58, 0.375, sz * 0.42);
      group.add(leg);
    });
  });

  // Rebaixo circular marcando onde a bomba deve ser colocada — antes não
  // havia nenhuma indicação visual do "alvo" na mesa.
  const bombPad = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.004, 24),
    new THREE.MeshStandardMaterial({ color: 0x3d3128, roughness: 0.8, metalness: 0.05 })
  );
  bombPad.position.y = TABLE_TOP_LOCAL_Y + 0.001;
  group.add(bombPad);

  // Botão de modo estilo "cogumelo de emergência" — base cilíndrica + tampa
  // vermelha mais larga, para se destacar dos botões genéricos de scanner/
  // esteira à distância. Fica no lado da mesa MAIS PERTO do jogador
  // (mesmo lado do alicate/panfleto, z positivo): do outro lado, a bomba —
  // mais alta que o botão — ficava na frente dele e o escondia visualmente.
  const modeButtonBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.025, 12),
    new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4, metalness: 0.6 })
  );
  modeButtonBase.position.set(0, TABLE_TOP_LOCAL_Y + 0.0125, 0.4);
  group.add(modeButtonBase);

  const modeButtonMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16),
    new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.4, metalness: 0.2 })
  );
  modeButtonMesh.position.set(0, TABLE_TOP_LOCAL_Y + 0.035, 0.4);
  group.add(modeButtonMesh);
  const modeButtonLocalPos = modeButtonMesh.position.clone();

  // Botão de rotação — ocupa o ponto onde o alicate ficava fixo antes da
  // Fase A3 (cinto utilitário), já livre nesse canto da mesa.
  const rotateButtonBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12),
    new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4, metalness: 0.6 })
  );
  rotateButtonBase.position.set(0.42, TABLE_TOP_LOCAL_Y + 0.01, 0.32);
  group.add(rotateButtonBase);

  const rotateButtonMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.018, 16),
    new THREE.MeshStandardMaterial({ color: 0x3388cc, roughness: 0.4, metalness: 0.2 })
  );
  rotateButtonMesh.position.set(0.42, TABLE_TOP_LOCAL_Y + 0.028, 0.32);
  group.add(rotateButtonMesh);
  const rotateButtonLocalPos = rotateButtonMesh.position.clone();

  let mode = false;
  let currentBomb = null;
  let touchingButton = false;
  let touchingRotateButton = false;
  let snapAnim = null; // { elapsed }
  let rotationAnim = null; // { fromX, toX, elapsed }

  function tableTopWorldPosition() {
    const p = new THREE.Vector3();
    top.getWorldPosition(p);
    return p;
  }

  function findBombOnTable(bombs) {
    const tablePos = tableTopWorldPosition();
    return bombs.find((bomb) => {
      if (bomb.delivered) return false;
      if (grabSystem.isHeld(bomb.group)) return false;
      const bombPos = new THREE.Vector3();
      bomb.group.getWorldPosition(bombPos);
      return bombPos.distanceTo(tablePos) <= SLOT_RADIUS;
    });
  }

  function enterMode(bomb) {
    mode = true;
    currentBomb = bomb;
    teleport.lock();
    grabSystem.unregister(bomb.group);

    group.add(bomb.group);
    bomb.group.position.set(0, TABLE_TOP_LOCAL_Y + 0.08, 0);
    bomb.group.rotation.set(0, 0, 0);
    // "Snap" magnético: pulso de escala rápido ao travar na mesa — só efeito
    // visual, a lógica de reparenting/posição acima não muda.
    bomb.group.scale.setScalar(SNAP_SCALE);
    snapAnim = { elapsed: 0 };
    rotationAnim = null;

    if (bomb.hasPamphlet && bomb.pamphletGroup && !grabSystem.isHeld(bomb.pamphletGroup)) {
      group.add(bomb.pamphletGroup);
      bomb.pamphletGroup.position.set(-0.42, TABLE_TOP_LOCAL_Y + 0.05, 0.32);
      bomb.pamphletGroup.rotation.set(-Math.PI / 2, 0, 0);
    }

    bomb.activateModules();
    onModeChange?.(true);
  }

  function exitMode() {
    mode = false;
    if (currentBomb) {
      currentBomb.deactivateModules();
      currentBomb.group.scale.setScalar(1);
      grabSystem.register(currentBomb.group);
    }
    currentBomb = null;
    snapAnim = null;
    rotationAnim = null;
    teleport.unlock();
    onModeChange?.(false);
  }

  function isTouchingModeButton(tipPositions) {
    for (const tip of tipPositions) {
      if (group.localToWorld(modeButtonLocalPos.clone()).distanceTo(tip) <= BUTTON_TOUCH_THRESHOLD) {
        return true;
      }
    }
    return false;
  }

  function isTouchingRotateButton(tipPositions) {
    for (const tip of tipPositions) {
      if (group.localToWorld(rotateButtonLocalPos.clone()).distanceTo(tip) <= BUTTON_TOUCH_THRESHOLD) {
        return true;
      }
    }
    return false;
  }

  function update(dt, tipPositions, bombs) {
    if (mode && currentBomb) {
      // Ponta do alicate só importa se ele estiver na mão — usada pro fio
      // saber em qual está mirando (destaque) mesmo antes de puxar o gatilho.
      const cutterTip = grabSystem.isHeld(pincers.group) ? pincers.getTipPosition() : null;

      // Idem pra chave de fenda + orientação do controller que a segura —
      // rearPanelModule.js (dentro de bomb.js) usa isso pra medir o gesto
      // de girar o pulso em cada parafuso. getHoldingController devolve null
      // se ela estiver no cinto (ninguém segurando), então ambos ficam null
      // juntos nesse caso.
      let screwdriverTip = null;
      let screwdriverQuaternion = null;
      const screwdriverController = grabSystem.getHoldingController(screwdriver.group);
      if (screwdriverController) {
        screwdriverTip = screwdriver.getTipPosition();
        screwdriverQuaternion = screwdriverController.getWorldQuaternion(new THREE.Quaternion());
      }

      currentBomb.update(dt, tipPositions, cutterTip, screwdriverTip, screwdriverQuaternion);

      if (currentBomb.rearPanelModule.coverOpen && !currentBomb.coreExposed) {
        currentBomb.markCoreExposed();
        grabSystem.register(currentBomb.rearPanelModule.coreObject, { throwable: true });
        onCoreExposed?.(currentBomb.rearPanelModule.coreObject);
      }
    }

    if (snapAnim) {
      snapAnim.elapsed += dt;
      const t = Math.min(snapAnim.elapsed / SNAP_DURATION, 1);
      if (currentBomb) currentBomb.group.scale.setScalar(THREE.MathUtils.lerp(SNAP_SCALE, 1, t));
      if (t >= 1) snapAnim = null;
    }

    if (rotationAnim) {
      rotationAnim.elapsed += dt;
      const t = Math.min(rotationAnim.elapsed / ROTATE_DURATION, 1);
      if (currentBomb) {
        currentBomb.group.rotation.x = THREE.MathUtils.lerp(rotationAnim.fromX, rotationAnim.toX, t);
      }
      if (t >= 1) rotationAnim = null;
    }

    const touching = isTouchingModeButton(tipPositions);
    if (touching && !touchingButton) {
      if (mode) {
        exitMode();
      } else {
        const bomb = findBombOnTable(bombs);
        if (bomb) enterMode(bomb);
      }
    }
    touchingButton = touching;

    const touchingRotate = isTouchingRotateButton(tipPositions);
    if (touchingRotate && !touchingRotateButton && mode && currentBomb && !rotationAnim) {
      rotationAnim = { fromX: currentBomb.group.rotation.x, toX: currentBomb.group.rotation.x + Math.PI, elapsed: 0 };
    }
    touchingRotateButton = touchingRotate;
  }

  function handleTrigger() {
    if (!mode || !currentBomb) return;
    // Só o corte de fio precisa da ponta do alicate (e só existe se ele
    // estiver na mão); botão colorido e teclado ignoram esse ponto — eles
    // confirmam o que já estava destacado por proximidade (ver update()
    // de cada módulo), então funcionam mesmo sem o alicate na mão.
    const point = grabSystem.isHeld(pincers.group) ? pincers.getTipPosition() : null;
    currentBomb.handleTrigger(point);
  }

  return {
    group,
    update,
    handleTrigger,
    get isActive() {
      return mode;
    },
  };
}
