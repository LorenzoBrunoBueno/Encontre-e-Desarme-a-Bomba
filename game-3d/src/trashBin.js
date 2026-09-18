import * as THREE from 'three';

const BIN_RADIUS_TOP = 0.18;
const BIN_RADIUS_BOTTOM = 0.15;
const BIN_HEIGHT = 0.5;
// Raio de aceite, tanto pro arremesso (registerThrowTarget) quanto pra
// aproximação (checada em update) — mesma folga que o antigo duto da
// esteira (DUCT_RADIUS em conveyor.js) tinha.
const ACCEPT_RADIUS = 0.24;

// Lixeira de descarte do núcleo/bateria retirado na etapa traseira da
// bancada (rearPanelModule.js/defuseTable.js) — antes vivia dentro do duto
// da esteira (conveyor.js); migrada pra uma estação própria ao lado da mesa
// de desarme, pra deixar a esteira só com a entrega de bombas (arremesso
// contra o carrinho-alvo). Aceita o núcleo de dois jeitos, igual o duto
// antigo aceitava:
// - Arremesso (mesmo mecanismo do carrinho, via registerThrowTarget).
// - Só aproximar, sem precisar arremessar (watchedCores, checado por
//   proximidade em update() — não depende do jogador soltar/lançar nada).
// Descartar o núcleo não afeta pontuação — tarefa física extra, mesma
// suposição documentada em rearPanelModule.js.
export function createTrashBin({ scene, position, rotationY = 0, grabSystem }) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  scene.add(group);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(BIN_RADIUS_TOP, BIN_RADIUS_BOTTOM, BIN_HEIGHT, 16),
    new THREE.MeshStandardMaterial({ color: 0x33422f, roughness: 0.75, metalness: 0.15 })
  );
  body.position.y = BIN_HEIGHT / 2;
  group.add(body);

  // Boca escura no topo — só leitura de "abertura" (a detecção usa `body`,
  // não esta peça).
  const opening = new THREE.Mesh(
    new THREE.CylinderGeometry(BIN_RADIUS_TOP - 0.02, BIN_RADIUS_TOP - 0.02, 0.01, 16),
    new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.9 })
  );
  opening.position.y = BIN_HEIGHT + 0.005;
  group.add(opening);

  // Aro reforçado na borda — greeble barato, mesma técnica dos parafusos
  // decorativos da bomba (bomb.js).
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(BIN_RADIUS_TOP, 0.012, 8, 20),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.5 })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = BIN_HEIGHT;
  group.add(rim);

  const watchedCores = [];

  function watchCore(coreObject) {
    watchedCores.push(coreObject);
  }

  function binWorldPosition() {
    const p = new THREE.Vector3();
    body.getWorldPosition(p);
    return p;
  }

  function discardCore(coreObject) {
    grabSystem.unregister(coreObject);
    scene.remove(coreObject);
    const index = watchedCores.indexOf(coreObject);
    if (index !== -1) watchedCores.splice(index, 1);
  }

  grabSystem.registerThrowTarget(body, ACCEPT_RADIUS, (object3D) => {
    // Só aceita núcleos observados (watchCore) — qualquer outra coisa
    // arremessada que caia perto por acidente é ignorada.
    if (watchedCores.includes(object3D)) discardCore(object3D);
  });

  // Descarte por proximidade (sem precisar arremessar) — só considera
  // núcleos soltos, não os que ainda estão na mão.
  function update() {
    if (watchedCores.length === 0) return;
    const binPos = binWorldPosition();
    for (let i = watchedCores.length - 1; i >= 0; i--) {
      const core = watchedCores[i];
      if (grabSystem.isHeld(core)) continue;
      const corePos = new THREE.Vector3();
      core.getWorldPosition(corePos);
      if (corePos.distanceTo(binPos) <= ACCEPT_RADIUS) discardCore(core);
    }
  }

  // Reinicia pra uma nova rodada em memória (game.js#resetRound, loop
  // contínuo entre fases) — núcleos da rodada anterior já foram
  // descartados/dispostos por resetRound diretamente, então só precisa
  // esvaziar a lista de observação.
  function reset() {
    watchedCores.length = 0;
  }

  return { group, update, watchCore, reset };
}
