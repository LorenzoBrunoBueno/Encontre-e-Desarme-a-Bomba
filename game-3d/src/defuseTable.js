import * as THREE from 'three';
import { createPincers } from './pincers.js';

const SLOT_RADIUS = 0.35;
const BUTTON_TOUCH_THRESHOLD = 0.09;
const TABLE_TOP_LOCAL_Y = 0.78;

// Mesa de desarme: o jogador coloca a bomba no slot e toca no botão para
// entrar no "modo de desarme" — locomoção travada (teleport.lock()), bomba
// centralizada e estática, panfleto à esquerda (se a bomba foi escaneada) e
// alicate à direita. Os 3 desafios (fio, botão, senha) são ativados juntos,
// sempre presentes em toda bomba (CLAUDE.md não sorteia um subconjunto).
export function createDefuseTable({ scene, position, rotationY = 0, grabSystem, teleport, onModeChange }) {
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

  const pincers = createPincers();
  pincers.group.position.set(0.42, TABLE_TOP_LOCAL_Y + 0.08, 0.32);
  group.add(pincers.group);
  // Alicate sempre "nasce" na mão com a lâmina apontando pra frente
  // (-Z local do controller), não importa o ângulo em que foi pego —
  // rotação de -90° em X leva o eixo +Y do alicate (direção da ponta,
  // ver pincers.js) para -Z.
  const pincersGrabRotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-Math.PI / 2, 0, 0)
  );
  grabSystem.register(pincers.group, { grabRotation: pincersGrabRotation });

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

  let mode = false;
  let currentBomb = null;
  let touchingButton = false;

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
      grabSystem.register(currentBomb.group);
    }
    currentBomb = null;
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

  function update(dt, tipPositions, bombs) {
    if (mode) {
      // Ponta do alicate só importa se ele estiver na mão — usada pro fio
      // saber em qual está mirando (destaque) mesmo antes de puxar o gatilho.
      const cutterTip = grabSystem.isHeld(pincers.group) ? pincers.getTipPosition() : null;
      currentBomb?.update(dt, tipPositions, cutterTip);
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
