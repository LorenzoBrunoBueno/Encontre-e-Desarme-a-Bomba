import * as THREE from 'three';
import { createBomb } from './bomb.js';
import { createStripeTexture } from './stripeTexture.js';

const CEILING_HEIGHT = 2.6;
const CHUTE_EXIT_HEIGHT = CEILING_HEIGHT - 0.56;
const FALL_DURATION = 0.6;

// Dispenser de teto: solta bombas (bomb.js) que caem até a caixa de coleta.
// Quem decide QUANDO soltar é bombFlow.js — este módulo só sabe animar a
// queda e avisar quando a bomba pousa (onBombLanded).
export function createDispenser({ scene, position, rotationY = 0, landingPosition, onBombLanded }) {
  const group = new THREE.Group();
  group.position.set(position.x, CEILING_HEIGHT, position.z);
  group.rotation.y = rotationY;
  scene.add(group);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.4, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.6, metalness: 0.2 })
  );
  group.add(body);

  // Faixa de alerta industrial na face frontal — decal via textura procedural
  // (mesma técnica de canvas de textPanel.js), sem precisar de imagem externa.
  const stripeTexture = createStripeTexture();
  stripeTexture.repeat.set(4, 1);
  const warningStripe = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.07),
    new THREE.MeshBasicMaterial({ map: stripeTexture })
  );
  warningStripe.position.set(0, 0.05, 0.251);
  group.add(warningStripe);

  // Funil de transição entre a base quadrada do corpo e a calha circular —
  // antes a calha "grudava" abruptamente no fundo plano do corpo.
  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.12, 0.12, 16),
    new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.6, metalness: 0.2 })
  );
  funnel.position.y = -0.26;
  group.add(funnel);

  const chute = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.16, 0.24, 16),
    new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.6, metalness: 0.2 })
  );
  chute.position.y = -0.44;
  group.add(chute);

  const falling = [];

  function dropBomb() {
    const bomb = createBomb();
    const from = new THREE.Vector3(position.x, CHUTE_EXIT_HEIGHT, position.z);
    bomb.group.position.copy(from);
    scene.add(bomb.group);
    falling.push({ bomb, elapsed: 0, from, to: landingPosition.clone() });
    return bomb;
  }

  function update(dt) {
    for (let i = falling.length - 1; i >= 0; i--) {
      const drop = falling[i];
      drop.elapsed += dt;
      const t = Math.min(drop.elapsed / FALL_DURATION, 1);
      drop.bomb.group.position.lerpVectors(drop.from, drop.to, t);
      if (t >= 1) {
        falling.splice(i, 1);
        onBombLanded(drop.bomb);
      }
    }
  }

  return { group, dropBomb, update };
}
