import * as THREE from 'three';

// Alicate de corte: ferramenta pegável (grip) da mesa de desarme. Enquanto
// estiver na mão, o gatilho corta o fio mais próximo da ponta (jaw) — quem
// roteia o evento de trigger para o desafio de fio ativo é defuseTable.js.
//
// Formato: cabo (+Y para -Y, empunhadura) em V convergindo para um pivô no
// meio, com a mandíbula (jaw) formada por duas lâminas finas que se
// encontram na ponta (+Y) — bem diferente do bloco+cone genérico anterior,
// que não lia como "ferramenta de corte" em nenhum ângulo.
export function createPincers() {
  const group = new THREE.Group();

  const gripMaterial = new THREE.MeshStandardMaterial({ color: 0xcc2200, roughness: 0.9, metalness: 0.05 });
  const metalMaterial = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.35, metalness: 0.75 });

  // Cabos: dois braços levemente abertos em V a partir do pivô central (y=0),
  // terminando na empunhadura (extremidade em -Y).
  const handleGeometry = new THREE.BoxGeometry(0.022, 0.16, 0.022);
  [-1, 1].forEach((side) => {
    const handle = new THREE.Mesh(handleGeometry, gripMaterial);
    handle.position.set(side * 0.018, -0.09, 0);
    handle.rotation.z = side * 0.16;
    group.add(handle);
  });

  // Pivô: parafuso visível ligando cabo e mandíbula.
  const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.02, 12), metalMaterial);
  pivot.rotation.x = Math.PI / 2;
  group.add(pivot);

  // Mandíbula: duas lâminas finas convergindo na ponta de corte (+Y).
  const jawGeometry = new THREE.BoxGeometry(0.01, 0.09, 0.022);
  [-1, 1].forEach((side) => {
    const jaw = new THREE.Mesh(jawGeometry, metalMaterial);
    jaw.position.set(side * 0.006, 0.05, 0);
    jaw.rotation.z = -side * 0.07;
    group.add(jaw);
  });

  // Ponta de corte: marcador invisível na geometria (usado só para o cálculo
  // de proximidade em wireCuttingModule.js), posicionado onde as duas
  // lâminas se encontram.
  const tip = new THREE.Object3D();
  tip.position.set(0, 0.095, 0);
  group.add(tip);

  function getTipPosition() {
    const p = new THREE.Vector3();
    tip.getWorldPosition(p);
    return p;
  }

  function dispose() {
    handleGeometry.dispose();
    gripMaterial.dispose();
    pivot.geometry.dispose();
    metalMaterial.dispose();
    jawGeometry.dispose();
  }

  return { group, getTipPosition, dispose };
}
