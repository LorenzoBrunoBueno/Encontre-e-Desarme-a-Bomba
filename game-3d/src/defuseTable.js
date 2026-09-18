import * as THREE from 'three';

const SLOT_RADIUS = 0.35;
const BUTTON_TOUCH_THRESHOLD = 0.09;
const TABLE_TOP_LOCAL_Y = 0.78;
const SNAP_DURATION = 0.18;
const SNAP_SCALE = 1.15;
const ROTATE_DURATION = 0.4;
// Mesma técnica de "inverted hull" do fio/botão/parafuso (wireCuttingModule.js/
// buttonChoiceModule.js/rearPanelModule.js): casca branca por dentro
// (BackSide), só visível enquanto a ponta do controller estiver perto do
// botão. Os dois botões da mesa (modo/rotação) eram acionados só por
// proximidade (encostar já disparava a ação) — mudado pra "proximidade
// destaca, gatilho confirma", igual a todo o resto do jogo: mais fácil de
// testar com mouse (que não empurra um objeto contra outro de forma
// confiável) e dá um indicador visual que antes não existia.
const OUTLINE_SCALE = 1.6;

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

  const modeButtonOutline = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045 * OUTLINE_SCALE, 0.045 * OUTLINE_SCALE, 0.02, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide })
  );
  modeButtonOutline.visible = false;
  modeButtonMesh.add(modeButtonOutline);

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

  const rotateButtonOutline = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04 * OUTLINE_SCALE, 0.04 * OUTLINE_SCALE, 0.018, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide })
  );
  rotateButtonOutline.visible = false;
  rotateButtonMesh.add(rotateButtonOutline);

  let mode = false;
  let currentBomb = null;
  // Hover (proximidade) dos dois botões — a ação de verdade só dispara no
  // gatilho (handleTrigger), lendo o estado mais recente destas flags.
  let hoveringModeButton = false;
  let hoveringRotateButton = false;
  // Bomba encostada no slot, recalculada a cada frame só quando fora do
  // modo — cacheada aqui porque handleTrigger (chamado por um evento de
  // controller, não por update) não recebe `bombs`.
  let bombOnTable = null;
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
    // Passa `bomb` também (não só o booleano) — o tutorial guiado da
    // primeira bomba (game.js#showTutorialStep) precisa saber SE é a bomba
    // que está acompanhando, não só que "alguma bomba" entrou no modo.
    onModeChange?.(true, bomb);
  }

  function exitMode() {
    mode = false;
    if (currentBomb) {
      currentBomb.deactivateModules();
      // Tirar a bomba da mesa é a única forma de perder o progresso dos
      // parafusos da etapa traseira (ver rearPanelModule.js#resetProgress) —
      // perder o alcance da chave de fenda enquanto a bomba ainda está na
      // mesa não reseta mais nada.
      currentBomb.rearPanelModule.resetProgress();
      currentBomb.group.scale.setScalar(1);
      // BUG achado no playtest via IWER (repetível em toda partida real, não
      // só no teste): enterMode() chama grabSystem.unregister(bomb.group)
      // (linha ~137) e essa chamada aqui re-registrava SEM `{ throwable:
      // true }`, perdendo a flag que dispenser.js dava à bomba ao pousar na
      // caixa de coleta (game.js#onBombLanded). Resultado: nenhuma bomba
      // conseguia ser arremessada na esteira depois de passar pela mesa de
      // desarme — ou seja, NUNCA, já que toda bomba passa por aqui. Isso
      // explica (pelo menos em parte) o "0 acertos em várias tentativas" dos
      // playtests anteriores, não só o raio/velocidade do carrinho.
      grabSystem.register(currentBomb.group, { throwable: true });
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

      currentBomb.update(dt, tipPositions, cutterTip, screwdriverTip, screwdriverQuaternion, screwdriverController);

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

    // Só recalcula a bomba encostada no slot fora do modo — é o único
    // momento em que o botão de modo precisa dela (pra entrar), e evita
    // custo (bombs.find) todo frame enquanto já se está desarmando.
    if (!mode) bombOnTable = findBombOnTable(bombs);

    const touchingMode = isTouchingModeButton(tipPositions);
    if (touchingMode !== hoveringModeButton) {
      hoveringModeButton = touchingMode;
      modeButtonOutline.visible = touchingMode;
    }

    const touchingRotate = isTouchingRotateButton(tipPositions);
    if (touchingRotate !== hoveringRotateButton) {
      hoveringRotateButton = touchingRotate;
      rotateButtonOutline.visible = touchingRotate;
    }
  }

  function handleTrigger(controller) {
    // Botões da mesa: proximidade só destaca (ver update() acima), o
    // gatilho confirma — igual ao fio/botão/teclado/parafuso, mais fácil de
    // testar com mouse (que não empurra um objeto contra outro de forma
    // confiável).
    if (hoveringModeButton) {
      if (mode) {
        exitMode();
      } else if (bombOnTable) {
        enterMode(bombOnTable);
      }
      return;
    }

    if (hoveringRotateButton) {
      if (mode && currentBomb && !rotationAnim) {
        rotationAnim = { fromX: currentBomb.group.rotation.x, toX: currentBomb.group.rotation.x + Math.PI, elapsed: 0 };
      }
      return;
    }

    if (!mode || !currentBomb) return;
    // Só o corte de fio precisa da ponta do alicate (e só existe se ele
    // estiver na mão); botão colorido e teclado ignoram esse ponto — eles
    // confirmam o que já estava destacado por proximidade (ver update()
    // de cada módulo), então funcionam mesmo sem o alicate na mão.
    const point = grabSystem.isHeld(pincers.group) ? pincers.getTipPosition() : null;
    // `controller` só serve pra haptics (pulseHaptic em cada módulo, ver
    // wireCuttingModule.js/buttonChoiceModule.js/keypadModule.js) — a lógica
    // de qual fio/botão/tecla foi acionado nunca depende de qual mão apertou
    // o gatilho.
    currentBomb.handleTrigger(point, controller);
  }

  return {
    group,
    update,
    handleTrigger,
    // Exposto pra game.js#resetRound poder forçar a saída do modo de
    // desarme (loop contínuo entre fases — ver game-3d/instrucao.md) se o
    // timer da rodada zerar com uma bomba ainda ativa na mesa — mesmo
    // caminho que o botão físico já usa, então já cuida de destravar o
    // teleporte e reverter o registro no grab system.
    exitMode,
    get isActive() {
      return mode;
    },
    // Usado pelo tutorial guiado da primeira bomba (game.js#showTutorialStep)
    // pra apontar a seta no botão de entrar/sair do modo.
    getModeButtonPosition: () => group.localToWorld(modeButtonLocalPos.clone()),
  };
}
