import * as THREE from 'three';

const HANDLE_TOUCH_RADIUS = 0.14;
const HANDLE_RELEASE_RADIUS = HANDLE_TOUCH_RADIUS * 2;
const PULL_DOWN_DISTANCE = 0.15;
const PULL_RESET_DISTANCE = 0.05;
const HANDLE_TRAVEL = 0.12;
const HANDLE_RETURN_SPEED = 8;

// Alavanca física genérica de N puxões — usada pelo dispenser (1 puxão,
// Estação 1) e pela alavanca de purga do scanner (3 puxões, Estação 2/crise
// de superaquecimento). Detecção por PROXIMIDADE, mesmo padrão dos botões do
// resto do projeto (scanner/mesa/esteira): a ponta do controller precisa
// ficar perto da empunhadura. O gesto de "puxar" é medido pelo deslocamento
// vertical do controller enquanto ele permanece nesse alcance — não é um
// evento de grab (o grip fica livre para carregar objetos) nem depende do
// gatilho (já sobrecarregado por teleporte/força-puxão/desarme).
export function createLeverSwitch({ scene, position, rotationY = 0, requiredPulls = 1, onComplete }) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  scene.add(group);

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.28, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.6, metalness: 0.3 })
  );
  base.position.y = 0.14;
  group.add(base);

  const HANDLE_REST_Y = 0.4;
  const handle = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.025, 0.2, 4, 8),
    new THREE.MeshStandardMaterial({ color: 0xcc2222, roughness: 0.4, metalness: 0.4 })
  );
  handle.position.y = HANDLE_REST_Y;
  group.add(handle);

  let pullCount = 0;
  let trackingIndex = null;
  let startY = null;
  let pulledThisCycle = false;

  function handleWorldPosition() {
    const p = new THREE.Vector3();
    handle.getWorldPosition(p);
    return p;
  }

  function reset() {
    pullCount = 0;
    trackingIndex = null;
    pulledThisCycle = false;
  }

  function update(dt, tipPositions) {
    const handlePos = handleWorldPosition();

    if (trackingIndex === null) {
      for (let i = 0; i < tipPositions.length; i++) {
        if (tipPositions[i].distanceTo(handlePos) <= HANDLE_TOUCH_RADIUS) {
          trackingIndex = i;
          startY = tipPositions[i].y;
          pulledThisCycle = false;
          break;
        }
      }
    }

    if (trackingIndex !== null) {
      const tip = tipPositions[trackingIndex];
      if (tip.distanceTo(handlePos) > HANDLE_RELEASE_RADIUS) {
        trackingIndex = null;
      } else {
        const downward = startY - tip.y;
        const travel = THREE.MathUtils.clamp(downward, 0, HANDLE_TRAVEL);
        handle.position.y = HANDLE_REST_Y - travel;

        if (!pulledThisCycle && downward >= PULL_DOWN_DISTANCE) {
          pulledThisCycle = true;
          pullCount += 1;
          if (pullCount >= requiredPulls) {
            pullCount = 0;
            onComplete?.();
          }
        } else if (pulledThisCycle && downward <= PULL_RESET_DISTANCE) {
          // exigir voltar quase ao topo antes de contar outro puxão — sem
          // isso, tremer a mão perto do limiar contaria vários puxões de uma
          // vez só.
          pulledThisCycle = false;
        }
        return;
      }
    }

    // Sem ninguém puxando: empunhadura volta suavemente ao repouso.
    handle.position.y = THREE.MathUtils.lerp(handle.position.y, HANDLE_REST_Y, Math.min(dt * HANDLE_RETURN_SPEED, 1));
  }

  return {
    group,
    update,
    reset,
    get pullsRemaining() {
      return requiredPulls - pullCount;
    },
  };
}
