import * as THREE from 'three';
import { createStripeTexture } from './stripeTexture.js';

const SLOT_RADIUS = 0.35;
const BUTTON_TOUCH_THRESHOLD = 0.09;
const BELT_SPEED = 0.4;

// Esteira de entrega: o jogador solta a bomba no slot (desarmada ou não) e
// toca no botão de "enviar". O resultado (certo/errado) é calculado aqui,
// mas NUNCA exibido ao jogador nesse momento — só entra no relatório final
// (ver scoreManager.js e game.on('roundEnd', ...)).
export function createConveyor({ scene, position, rotationY = 0, grabSystem, onDeliver }) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  scene.add(group);

  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.5, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.6, metalness: 0.2 })
  );
  belt.position.y = 0.25;
  group.add(belt);

  // Textura de listras animada (offset deslocado em update) simula o
  // movimento contínuo da esteira sem precisar de geometria/física real.
  const beltTexture = createStripeTexture({ colorA: '#3a3a3a', colorB: '#161616' });
  beltTexture.repeat.set(6, 1);
  const surface = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.04, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x333333, map: beltTexture, roughness: 0.7 })
  );
  surface.position.y = 0.52;
  group.add(surface);

  // Trilhos laterais — reforça a leitura de "canal" por onde a bomba desliza.
  const railGeometry = new THREE.BoxGeometry(0.9, 0.03, 0.03);
  const railMaterial = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.4, metalness: 0.6 });
  [-1, 1].forEach((sz) => {
    const rail = new THREE.Mesh(railGeometry, railMaterial);
    rail.position.set(0, 0.555, sz * 0.185);
    group.add(rail);
  });

  const buttonMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.03, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x8899aa })
  );
  buttonMesh.position.set(0.4, 0.56, 0.15);
  group.add(buttonMesh);
  const buttonLocalPos = buttonMesh.position.clone();

  let touchingButton = false;

  function slotWorldPosition() {
    const p = new THREE.Vector3();
    surface.getWorldPosition(p);
    return p;
  }

  function findBombOnBelt(bombs) {
    const slotPos = slotWorldPosition();
    return bombs.find((bomb) => {
      if (bomb.delivered) return false;
      if (grabSystem.isHeld(bomb.group)) return false;
      const bombPos = new THREE.Vector3();
      bomb.group.getWorldPosition(bombPos);
      return bombPos.distanceTo(slotPos) <= SLOT_RADIUS;
    });
  }

  function deliver(bomb) {
    const wasCorrect = bomb.isFullyCorrect();
    bomb.delivered = true;
    grabSystem.unregister(bomb.group);
    scene.remove(bomb.group);
    bomb.dispose();
    onDeliver?.(bomb.id, wasCorrect);
  }

  function update(dt, tipPositions, bombs) {
    beltTexture.offset.x -= dt * BELT_SPEED;

    let touching = false;
    for (const tip of tipPositions) {
      if (group.localToWorld(buttonLocalPos.clone()).distanceTo(tip) <= BUTTON_TOUCH_THRESHOLD) {
        touching = true;
        break;
      }
    }
    if (touching && !touchingButton) {
      const bomb = findBombOnBelt(bombs);
      if (bomb) deliver(bomb);
    }
    touchingButton = touching;
  }

  return { group, update };
}
