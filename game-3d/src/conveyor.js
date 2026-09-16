import * as THREE from 'three';
import { createStripeTexture } from './stripeTexture.js';
import { createDeliveryChime } from './audio.js';

const BELT_SPEED = 0.4;
// Percurso do carrinho-alvo ao longo do eixo local Z — RoomRefactor girou o
// eixo de transporte de X pra Z (antes a esteira "andava" paralela à
// parede; agora anda EM DIREÇÃO a ela, pra terminar num vão de saída de
// verdade, não num beco sem saída lateral).
const CART_RANGE = 0.32;
const CART_CYCLE_SPEED = 0.5; // ciclos por segundo do vaivém
const CART_HIT_RADIUS = 0.18;
const DUCT_RADIUS = 0.22;
// Trajeto até o vão de saída (RoomRefactor item 3) — ao acertar o carrinho,
// a bomba já não desaparece na hora: continua em linha reta até cruzar a
// cortina de tiras PVC bem perto da parede de trás, só aí conta como
// entregue (pontuação, luz verde, som).
const EXIT_TRAVEL_DURATION = 0.7;
const EXIT_HEIGHT = 0.58;
const GREEN_FLASH_DURATION = 0.5;

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
export function createConveyor({ scene, position, rotationY = 0, wallRunLength = 0.5, grabSystem, onDeliver }) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  scene.add(group);

  // Ponto local (relativo ao grupo da estação) logo antes da parede real —
  // wallRunLength vem de roomLayout.js (mesma distância usada lá pra
  // posicionar a estação), então a cortina/vão sempre batem com a parede de
  // verdade, mesmo que o layout mude de novo no futuro.
  const EXIT_LOCAL_Z = -(wallRunLength - 0.05);

  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 1.0),
    new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.6, metalness: 0.2 })
  );
  belt.position.y = 0.25;
  belt.receiveShadow = true;
  group.add(belt);

  // Textura de listras animada (offset em Y = eixo de comprimento agora que
  // o transporte corre em Z) simula o movimento contínuo da esteira sem
  // precisar de geometria/física real — já rodava incondicionalmente antes
  // do RoomRefactor, só o eixo de scroll mudou.
  const beltTexture = createStripeTexture({ colorA: '#3a3a3a', colorB: '#161616' });
  beltTexture.repeat.set(1, 6);
  const surface = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.04, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x333333, map: beltTexture, roughness: 0.7 })
  );
  surface.position.y = 0.52;
  group.add(surface);

  // Trilhos laterais — reforça a leitura de "canal" por onde a bomba desliza.
  const railGeometry = new THREE.BoxGeometry(0.03, 0.03, 0.9);
  const railMaterial = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.4, metalness: 0.6 });
  [-1, 1].forEach((sx) => {
    const rail = new THREE.Mesh(railGeometry, railMaterial);
    rail.position.set(sx * 0.185, 0.555, 0);
    group.add(rail);
  });

  // Carrinho-alvo: desliza em vaivém sobre a esteira (Math.sin em update) —
  // o jogador precisa acertá-lo arremessando a bomba, não mais tocar um
  // botão parado.
  const cart = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.1, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x8899aa, roughness: 0.5, metalness: 0.3 })
  );
  cart.position.set(0, 0.58, 0);
  group.add(cart);
  let cartPhase = 0;

  // Cortina de tiras PVC + moldura escura no vão de saída (RoomRefactor item
  // 3) — a bomba "some" atrás delas, não simplesmente desaparece no ar.
  const curtainMaterial = new THREE.MeshStandardMaterial({
    color: 0xd4b23c,
    transparent: true,
    opacity: 0.55,
    roughness: 0.4,
    side: THREE.DoubleSide,
  });
  const CURTAIN_STRIP_COUNT = 5;
  for (let i = 0; i < CURTAIN_STRIP_COUNT; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.42, 0.01), curtainMaterial);
    strip.position.set(-0.175 + i * 0.0875, 0.45, EXIT_LOCAL_Z + 0.03);
    group.add(strip);
  }
  const wallOpeningFrame = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.46, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.8 })
  );
  wallOpeningFrame.position.set(0, 0.45, -wallRunLength + 0.02);
  group.add(wallOpeningFrame);

  // Flash verde no exato momento em que a bomba cruza a cortina — não no
  // toque do carrinho (ver beginDelivery/completeDelivery mais abaixo).
  const exitLight = new THREE.PointLight(0x33ff66, 0, 1.4);
  exitLight.position.set(0, 0.5, EXIT_LOCAL_Z);
  group.add(exitLight);
  let greenFlashElapsed = GREEN_FLASH_DURATION;
  const deliveryChime = createDeliveryChime();

  // Duto de descarte do núcleo/bateria retirado na etapa traseira da
  // bancada — aceita arremesso (registerThrowTarget) e colocar por perto
  // (watchedCores, checado por proximidade em update). Fica de lado, perto
  // da frente da estação — fora do trajeto do carrinho, que agora corre em Z.
  const duct = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, 0.28, 16),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6, metalness: 0.3 })
  );
  duct.position.set(0.35, 0.14, 0.35);
  group.add(duct);

  // `latestBombs` guarda a referência mais recente pra que os callbacks de
  // registerThrowTarget (disparados de dentro de grabSystem.update, DEPOIS
  // de conveyor.update no mesmo frame — ver ordem em game.js#animate)
  // consigam mapear o object3D arremessado de volta pra uma bomba.
  let latestBombs = [];
  const watchedCores = [];
  // Bombas em trânsito entre o hit no carrinho e o cruzamento da cortina —
  // ver beginDelivery/completeDelivery.
  const traveling = [];

  function watchCore(coreObject) {
    watchedCores.push(coreObject);
  }

  function ductWorldPosition() {
    const p = new THREE.Vector3();
    duct.getWorldPosition(p);
    return p;
  }

  // Ao acertar o carrinho, a bomba NÃO é entregue ainda — só sai do grab
  // system (não pode mais ser pega no meio do trajeto) e começa a viajar até
  // o vão de saída. `completeDelivery` (chamado só ao cruzar a cortina) é
  // quem de fato pontua, soa e acende a luz verde.
  function beginDelivery(bomb) {
    grabSystem.unregister(bomb.group);
    const from = bomb.group.position.clone();
    const to = group.localToWorld(new THREE.Vector3(0, EXIT_HEIGHT, EXIT_LOCAL_Z));
    traveling.push({ bomb, from, to, elapsed: 0 });
  }

  function completeDelivery(bomb) {
    const wasCorrect = bomb.isFullyCorrect();
    bomb.delivered = true;
    scene.remove(bomb.group);
    bomb.dispose();
    greenFlashElapsed = 0;
    deliveryChime.play();
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
    if (bomb) beginDelivery(bomb);
  });

  grabSystem.registerThrowTarget(duct, DUCT_RADIUS, (object3D) => {
    // O duto não aceita bombas, só o núcleo/bateria — ignora qualquer outro
    // objeto arremessado que caia por perto por acidente.
    if (latestBombs.some((b) => b.group === object3D)) return;
    if (watchedCores.includes(object3D)) discardCore(object3D);
  });

  function update(dt, tipPositions, bombs) {
    latestBombs = bombs;
    beltTexture.offset.y -= dt * BELT_SPEED;

    cartPhase += dt * CART_CYCLE_SPEED;
    cart.position.z = Math.sin(cartPhase * Math.PI * 2) * CART_RANGE;

    for (let i = traveling.length - 1; i >= 0; i--) {
      const trip = traveling[i];
      trip.elapsed += dt;
      const t = Math.min(trip.elapsed / EXIT_TRAVEL_DURATION, 1);
      trip.bomb.group.position.lerpVectors(trip.from, trip.to, t);
      if (t >= 1) {
        traveling.splice(i, 1);
        completeDelivery(trip.bomb);
      }
    }

    if (greenFlashElapsed < GREEN_FLASH_DURATION) {
      greenFlashElapsed += dt;
      const t = THREE.MathUtils.clamp(greenFlashElapsed / GREEN_FLASH_DURATION, 0, 1);
      exitLight.intensity = (1 - t) * 2;
    }

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
