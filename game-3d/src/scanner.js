import * as THREE from 'three';
import { createPamphlet } from './pamphlet.js';
import { createTextPanel } from './textPanel.js';

const SLOT_RADIUS = 0.35;
const BUTTON_TOUCH_THRESHOLD = 0.09;
const SCAN_DURATION = 2;
const BLINK_SPEED = 8;

// Scanner: o jogador coloca a bomba no slot, toca no botão de "iniciar
// scan" (mesmo padrão de toque por proximidade dos outros módulos), uma
// luz verde "lê" a bomba por alguns segundos, e ao final ejeta um panfleto
// anexado à bomba com as instruções de desarme (pamphlet.js).
export function createScanner({ scene, position, rotationY = 0, grabSystem, onScanned }) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  scene.add(group);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.9, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.5, metalness: 0.3 })
  );
  body.position.y = 0.45;
  group.add(body);

  // Pés — separa visualmente o console do chão, evita leitura de "bloco
  // pousado direto no piso".
  const footGeometry = new THREE.CylinderGeometry(0.05, 0.06, 0.06, 12);
  const footMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.6, metalness: 0.2 });
  [-1, 1].forEach((sx) => {
    [-1, 1].forEach((sz) => {
      const foot = new THREE.Mesh(footGeometry, footMaterial);
      foot.position.set(sx * 0.28, 0.03, sz * 0.18);
      group.add(foot);
    });
  });

  // Grelhas de ventilação na face frontal — greeble barato via caixas finas.
  const ventMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.8, metalness: 0.1 });
  const ventGeometry = new THREE.BoxGeometry(0.36, 0.012, 0.006);
  for (let i = 0; i < 4; i++) {
    const vent = new THREE.Mesh(ventGeometry, ventMaterial);
    vent.position.set(0, 0.62 - i * 0.03, 0.253);
    group.add(vent);
  }

  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.06, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.6, metalness: 0.2 })
  );
  slot.position.set(0, 0.92, 0);
  group.add(slot);

  // Moldura da janela de scan — dá a leitura de "câmara/abertura" ao redor
  // do plano de luz verde, que antes flutuava sozinho sobre o slot.
  const rimMaterial = new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: 0.5, metalness: 0.4 });
  const rimSideGeometry = new THREE.BoxGeometry(0.54, 0.015, 0.02);
  const rimEndGeometry = new THREE.BoxGeometry(0.02, 0.015, 0.39);
  [-1, 1].forEach((sz) => {
    const rim = new THREE.Mesh(rimSideGeometry, rimMaterial);
    rim.position.set(0, 0.955, sz * 0.185);
    group.add(rim);
  });
  [-1, 1].forEach((sx) => {
    const rim = new THREE.Mesh(rimEndGeometry, rimMaterial);
    rim.position.set(sx * 0.26, 0.955, 0);
    group.add(rim);
  });

  // Painel de status — texto grande via canvas (mesma técnica do panfleto),
  // mostra o estado atual do scanner para quem está de longe.
  const statusPanel = createTextPanel({ width: 0.3, height: 0.1, fontSize: 34 });
  statusPanel.mesh.position.set(0, 0.68, 0.251);
  statusPanel.setText('PRONTO', '#33ff66', '#111111');
  group.add(statusPanel.mesh);

  // Botão de "iniciar scan": base + tampa saltando pra FORA da face frontal
  // do corpo (que vai até z=0.25) — antes ficava quase embutido na carcaça
  // (só ~1cm de fora), praticamente invisível encostado nas grelhas ao lado.
  const scanButtonBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, 0.02, 16),
    new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.5, metalness: 0.4 })
  );
  scanButtonBase.rotation.x = Math.PI / 2;
  scanButtonBase.position.set(0.3, 0.62, 0.26);
  group.add(scanButtonBase);

  const buttonMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16),
    new THREE.MeshStandardMaterial({ color: 0x33cc66, roughness: 0.4, metalness: 0.2 })
  );
  buttonMesh.rotation.x = Math.PI / 2;
  buttonMesh.position.set(0.3, 0.62, 0.29);
  group.add(buttonMesh);
  const buttonPosition = buttonMesh.position.clone();

  const scanLight = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.35),
    new THREE.MeshBasicMaterial({
      color: 0x33ff66,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    })
  );
  scanLight.rotation.x = -Math.PI / 2;
  scanLight.position.set(0, 0.95, 0);
  group.add(scanLight);

  let scanning = false;
  let scanTimer = 0;
  let currentBomb = null;
  let touchingButton = false;
  let blinkPhase = 0;

  function slotWorldPosition() {
    const p = new THREE.Vector3();
    slot.getWorldPosition(p);
    return p;
  }

  function findBombInSlot(bombs) {
    const slotPos = slotWorldPosition();
    return bombs.find((bomb) => {
      if (bomb.delivered) return false;
      if (grabSystem.isHeld(bomb.group)) return false;
      const bombPos = new THREE.Vector3();
      bomb.group.getWorldPosition(bombPos);
      return bombPos.distanceTo(slotPos) <= SLOT_RADIUS;
    });
  }

  function startScan(bomb) {
    scanning = true;
    scanTimer = SCAN_DURATION;
    currentBomb = bomb;
    statusPanel.setText('ESCANEANDO...', '#ffcc33', '#111111');
  }

  function finishScan() {
    scanning = false;
    scanLight.material.opacity = 0;
    statusPanel.setText('PRONTO', '#33ff66', '#111111');
    if (currentBomb && !currentBomb.hasPamphlet) {
      const pamphlet = createPamphlet(currentBomb);
      pamphlet.group.position.set(0.18, 0.05, 0);
      currentBomb.group.add(pamphlet.group);
      grabSystem.register(pamphlet.group);
      currentBomb.pamphletGroup = pamphlet.group;
      currentBomb.markScanned();
      onScanned?.(currentBomb.id);
    }
    currentBomb = null;
  }

  function update(dt, tipPositions, bombs) {
    if (scanning) {
      scanTimer -= dt;
      blinkPhase += dt * BLINK_SPEED;
      scanLight.material.opacity = 0.4 + 0.3 * Math.sin(blinkPhase);
      if (scanTimer <= 0) finishScan();
      return;
    }

    let touching = false;
    for (const tip of tipPositions) {
      if (group.localToWorld(buttonPosition.clone()).distanceTo(tip) <= BUTTON_TOUCH_THRESHOLD) {
        touching = true;
        break;
      }
    }

    if (touching && !touchingButton) {
      const bomb = findBombInSlot(bombs);
      if (bomb) startScan(bomb);
    }
    touchingButton = touching;
  }

  return { group, update };
}
