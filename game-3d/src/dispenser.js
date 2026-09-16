import * as THREE from 'three';
import { createBomb, BOMB_FUSE_SECONDS } from './bomb.js';
import { createStripeTexture } from './stripeTexture.js';
import { createLeverSwitch } from './leverSwitch.js';

const CEILING_HEIGHT = 2.6;
const CHUTE_EXIT_HEIGHT = CEILING_HEIGHT - 0.56;
const FALL_DURATION = 0.6;
const BLINK_SPEED = 6;

// Dispenser de teto: o corpo fica fora de alcance (montado no teto), então
// a interação física mora numa alavanca separada, ao nível do chão, perto
// da caixa de coleta (Estação 1 do documento de especificação) — o jogador
// puxa a alavanca (leverSwitch.js) para soltar a bomba armada. QUANDO uma
// bomba fica pronta pra ser solta continua sendo decisão do bombFlow.js
// (`onReady`/`setArmed`); este módulo só anima a queda, avisa quando pousa
// (onBombLanded) e expõe a alavanca + o indicador luminoso de "pronto".
export function createDispenser({ scene, position, rotationY = 0, landingPosition, onBombLanded, onLeverPulled }) {
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

  // Alavanca + indicador ficam no chão, perto da caixa de coleta — não no
  // corpo do dispenser (que está no teto, fora de alcance). Offset local
  // (0.4 pra "direita", 0.35 "pra frente" do jogador) rotacionado pelo mesmo
  // rotationY da estação, pra funcionar em qualquer um dos 4 ângulos fixos
  // do roomLayout.
  const floorOffset = new THREE.Vector3(0.4, 0, 0.35).applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    rotationY
  );
  const leverPosition = new THREE.Vector3(
    position.x + floorOffset.x,
    0,
    position.z + floorOffset.z
  );
  const lever = createLeverSwitch({
    scene,
    position: leverPosition,
    rotationY,
    requiredPulls: 1,
    onComplete: () => onLeverPulled?.(),
  });

  const armedIndicator = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 0 })
  );
  armedIndicator.position.set(leverPosition.x, 0.55, leverPosition.z);
  scene.add(armedIndicator);

  let armed = false;
  let blinkPhase = 0;

  function setArmed(value) {
    armed = value;
    if (!armed) armedIndicator.material.emissiveIntensity = 0;
  }

  const falling = [];

  function dropBomb() {
    const bomb = createBomb();
    // Fusível começa a correr assim que a bomba sai do dispenser (documento
    // de especificação, Estação 1) — não quando ela pousa na caixa.
    bomb.startTimer(BOMB_FUSE_SECONDS);
    const from = new THREE.Vector3(position.x, CHUTE_EXIT_HEIGHT, position.z);
    bomb.group.position.copy(from);
    scene.add(bomb.group);
    falling.push({ bomb, elapsed: 0, from, to: landingPosition.clone() });
    return bomb;
  }

  function update(dt, tipPositions) {
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

    lever.update(dt, tipPositions);

    if (armed) {
      blinkPhase += dt * BLINK_SPEED;
      armedIndicator.material.emissiveIntensity = 0.5 + 0.5 * Math.sin(blinkPhase);
    }
  }

  return { group, dropBomb, update, setArmed };
}
