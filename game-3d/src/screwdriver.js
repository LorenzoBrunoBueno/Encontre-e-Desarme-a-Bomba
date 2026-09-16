import * as THREE from 'three';

// Chave de fenda: ferramenta pegável (grip) do cinto utilitário (anchor
// esquerdo, ver utilityBelt.js/game.js), usada na etapa traseira da mesa de
// desarme (rearPanelModule.js) pra remover os 4 parafusos — aproximar a
// ponta de um parafuso e girar o pulso, diferente do alicate (que usa o
// gatilho pra cortar).
export function createScrewdriver() {
  const group = new THREE.Group();

  const handleMaterial = new THREE.MeshStandardMaterial({ color: 0xffaa00, roughness: 0.7, metalness: 0.1 });
  const shaftMaterial = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.3, metalness: 0.8 });

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.11, 12), handleMaterial);
  handle.position.set(0, -0.06, 0);
  group.add(handle);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.13, 8), shaftMaterial);
  shaft.position.set(0, 0.055, 0);
  group.add(shaft);

  // Ponta: marcador invisível, mesma técnica de pincers.js — usado só pro
  // cálculo de proximidade em rearPanelModule.js.
  const tip = new THREE.Object3D();
  tip.position.set(0, 0.12, 0);
  group.add(tip);

  function getTipPosition() {
    const p = new THREE.Vector3();
    tip.getWorldPosition(p);
    return p;
  }

  function dispose() {
    handle.geometry.dispose();
    handleMaterial.dispose();
    shaft.geometry.dispose();
    shaftMaterial.dispose();
  }

  return { group, getTipPosition, dispose };
}
