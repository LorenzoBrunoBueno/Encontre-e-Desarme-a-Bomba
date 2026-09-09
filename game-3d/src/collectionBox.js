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
  const material = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.85, metalness: 0.05 });
  const wallThickness = 0.04;
  const wallHeight = 0.3;

  const bottom = new THREE.Mesh(new THREE.BoxGeometry(0.6, wallThickness, 0.6), material);
  bottom.position.y = wallThickness / 2;
  group.add(bottom);

  const sideWallGeometry = new THREE.BoxGeometry(wallThickness, wallHeight, 0.6);
  [-1, 1].forEach((sx) => {
    const wall = new THREE.Mesh(sideWallGeometry, material);
    wall.position.set(sx * (0.3 - wallThickness / 2), wallThickness + wallHeight / 2, 0);
    group.add(wall);
  });

  const endWallGeometry = new THREE.BoxGeometry(0.6 - wallThickness * 2, wallHeight, wallThickness);
  [-1, 1].forEach((sz) => {
    const wall = new THREE.Mesh(endWallGeometry, material);
    wall.position.set(0, wallThickness + wallHeight / 2, sz * (0.3 - wallThickness / 2));
    group.add(wall);
  });

  return { group };
}
