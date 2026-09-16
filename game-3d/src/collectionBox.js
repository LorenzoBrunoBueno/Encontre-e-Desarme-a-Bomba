import * as THREE from 'three';

// Fase 1: só geometria posicionada no chão, sob o dispenser. Vira o ponto
// de onde o jogador pega bombas (grabbable) na Fase 2.
export function createCollectionBox({ scene, position, rotationY = 0 }) {
  const group = new THREE.Group();
  group.position.set(position.x, 0, position.z);
  group.rotation.y = rotationY;
  scene.add(group);

  // Caixote de paredes finas + fundo, em vez de um bloco maciço — lê como
  // "receptáculo aberto" onde a bomba cai dentro, não como um caixote fechado.
  // Alargada de 0.6 pra 0.72 (RoomRefactor item 2): o corpo da bomba
  // (0.56×0.56, ver bomb.js) quase tomava a caixa inteira, sem folga pro
  // jitter de posição que dispenser.js agora aplica a cada queda.
  const material = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.85, metalness: 0.05 });
  const wallThickness = 0.04;
  const wallHeight = 0.3;
  const boxSize = 0.72;

  const bottom = new THREE.Mesh(new THREE.BoxGeometry(boxSize, wallThickness, boxSize), material);
  bottom.position.y = wallThickness / 2;
  bottom.receiveShadow = true;
  group.add(bottom);

  const sideWallGeometry = new THREE.BoxGeometry(wallThickness, wallHeight, boxSize);
  [-1, 1].forEach((sx) => {
    const wall = new THREE.Mesh(sideWallGeometry, material);
    wall.position.set(sx * (boxSize / 2 - wallThickness / 2), wallThickness + wallHeight / 2, 0);
    group.add(wall);
  });

  const endWallGeometry = new THREE.BoxGeometry(boxSize - wallThickness * 2, wallHeight, wallThickness);
  [-1, 1].forEach((sz) => {
    const wall = new THREE.Mesh(endWallGeometry, material);
    wall.position.set(0, wallThickness + wallHeight / 2, sz * (boxSize / 2 - wallThickness / 2));
    group.add(wall);
  });

  return { group };
}
