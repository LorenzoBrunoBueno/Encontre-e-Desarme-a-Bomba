import * as THREE from 'three';
import { createStripeTexture } from './stripeTexture.js';

const BELT_SPEED = 0.4;
const CART_RANGE = 0.32; // percurso do carrinho-alvo ao longo do eixo local X
const CART_CYCLE_SPEED = 0.5; // ciclos por segundo do vaivém
const CART_HIT_RADIUS = 0.18;
const DUCT_RADIUS = 0.22;

// Esteira de entrega: substituiu o antigo botão de "enviar" por um alvo
// físico — um carrinho que desliza em vaivém sobre a esteira — que o
// jogador precisa ACERTAR arremessando a bomba (documento de especificação,
// Estação 4; arremesso real vem de grab.js#registerThrowTarget, Fase A1).
// O resultado (certo/errado) é calculado aqui, mas NUNCA exibido ao jogador
// nesse momento — só entra no relatório final (scoreManager.js e
// game.on('roundEnd', ...)).
//
// Também abriga o duto de descarte do núcleo/bateria retirado na etapa
// traseira da bancada (rearPanelModule.js/defuseTable.js) — aceita tanto
// arremesso (mesmo mecanismo do carrinho) quanto simplesmente colocar por
// perto (watchCore, chamado por game.js quando um núcleo é exposto).
// Descartar o núcleo não afeta pontuação — o documento não liga isso a
// pontos, é só tarefa física extra (suposição documentada, igual à etapa
// traseira em si).
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

  // Carrinho-alvo: desliza em vaivém sobre a esteira (Math.sin em update) —
  // o jogador precisa acertá-lo arremessando a bomba, não mais tocar um
  // botão parado.
  const cart = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.1, 0.32),
    new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.5, metalness: 0.3 })
  );
  cart.position.set(0, 0.58, 0);
  group.add(cart);
  let cartPhase = 0;

  // Duto de descarte do núcleo/bateria retirado na etapa traseira da
  // bancada — aceita arremesso (registerThrowTarget) e colocar por perto
  // (watchedCores, checado por proximidade em update).
  const duct = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, 0.28, 16),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6, metalness: 0.3 })
  );
  duct.position.set(-0.45, 0.14, -0.15);
  group.add(duct);

  // `latestBombs` guarda a referência mais recente pra que os callbacks de
  // registerThrowTarget (disparados de dentro de grabSystem.update, DEPOIS
  // de conveyor.update no mesmo frame — ver ordem em game.js#animate)
  // consigam mapear o object3D arremessado de volta pra uma bomba.
  let latestBombs = [];
  const watchedCores = [];

  function watchCore(coreObject) {
    watchedCores.push(coreObject);
  }

  function ductWorldPosition() {
    const p = new THREE.Vector3();
    duct.getWorldPosition(p);
    return p;
  }

  function deliver(bomb) {
    const wasCorrect = bomb.isFullyCorrect();
    bomb.delivered = true;
    grabSystem.unregister(bomb.group);
    scene.remove(bomb.group);
    bomb.dispose();
    onDeliver?.(bomb.id, wasCorrect);
  }

  function discardCore(coreObject) {
    grabSystem.unregister(coreObject);
    scene.remove(coreObject);
    const index = watchedCores.indexOf(coreObject);
    if (index !== -1) watchedCores.splice(index, 1);
  }

  grabSystem.registerThrowTarget(cart, CART_HIT_RADIUS, (object3D) => {
    const bomb = latestBombs.find((b) => b.group === object3D);
    if (bomb) deliver(bomb);
  });

  grabSystem.registerThrowTarget(duct, DUCT_RADIUS, (object3D) => {
    // O duto não aceita bombas, só o núcleo/bateria — ignora qualquer outro
    // objeto arremessado que caia por perto por acidente.
    if (latestBombs.some((b) => b.group === object3D)) return;
    if (watchedCores.includes(object3D)) discardCore(object3D);
  });

  function update(dt, tipPositions, bombs) {
    latestBombs = bombs;
    beltTexture.offset.x -= dt * BELT_SPEED;

    cartPhase += dt * CART_CYCLE_SPEED;
    cart.position.x = Math.sin(cartPhase * Math.PI * 2) * CART_RANGE;

    // Descarte do núcleo por proximidade (sem precisar arremessar) — só
    // considera núcleos soltos, não os que ainda estão na mão.
    const ductPos = ductWorldPosition();
    for (let i = watchedCores.length - 1; i >= 0; i--) {
      const core = watchedCores[i];
      if (grabSystem.isHeld(core)) continue;
      const corePos = new THREE.Vector3();
      core.getWorldPosition(corePos);
      if (corePos.distanceTo(ductPos) <= DUCT_RADIUS) discardCore(core);
    }
  }

  return { group, update, watchCore };
}
