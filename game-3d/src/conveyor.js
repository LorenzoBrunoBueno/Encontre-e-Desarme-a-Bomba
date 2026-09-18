import * as THREE from 'three';
import { createStripeTexture } from './stripeTexture.js';
import { createDeliveryChime } from './audio.js';

const BELT_SPEED = 0.4;
// Percurso do carrinho-alvo ao longo do eixo local Z — RoomRefactor girou o
// eixo de transporte de X pra Z (antes a esteira "andava" paralela à
// parede; agora anda EM DIREÇÃO a ela, pra terminar num vão de saída de
// verdade, não num beco sem saída lateral).
const CART_RANGE = 0.32;
// Fallbacks caso `cartCycleSpeed`/`cartHitRadius` não sejam passados (ex.:
// testes isolados) — os valores "de verdade" vêm de
// game-3d/src/difficulty.js por fase. Achado do playtest via IWER: com os
// números que existiam aqui antes (0.5 Hz / 0.18), a janela de acerto real
// (~38% do tempo mirando o centro do trilho) não converteu em nenhuma
// tentativa em 5 tentativas com mira calculada matematicamente — a fase 1
// usa valores mais generosos que estes por causa disso (ver difficulty.js).
const DEFAULT_CART_CYCLE_SPEED = 0.5; // ciclos por segundo do vaivém
const DEFAULT_CART_HIT_RADIUS = 0.18;
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
// O duto de descarte do núcleo/bateria (etapa traseira da bancada) morava
// aqui antes — migrado pra trashBin.js, uma estação própria ao lado da mesa
// de desarme, pra esta esteira ficar só com a entrega de bombas.
export function createConveyor({
  scene,
  position,
  rotationY = 0,
  wallRunLength = 0.5,
  grabSystem,
  onDeliver,
  onIncorrectDelivery,
  cartCycleSpeed = DEFAULT_CART_CYCLE_SPEED,
  cartHitRadius = DEFAULT_CART_HIT_RADIUS,
}) {
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

  // `latestBombs` guarda a referência mais recente pra que o callback de
  // registerThrowTarget (disparado de dentro de grabSystem.update, DEPOIS
  // de conveyor.update no mesmo frame — ver ordem em game.js#animate)
  // consiga mapear o object3D arremessado de volta pra uma bomba.
  let latestBombs = [];
  // Bombas em trânsito entre o hit no carrinho e o cruzamento da cortina —
  // ver beginDelivery/completeDelivery.
  const traveling = [];

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
    // O resultado nunca é exibido diretamente (placar continua só no
    // relatório final, ver scoreManager.js) — mas a bomba errada agora
    // "estoura fora da sala" (documento de especificação): som distante +
    // tremedeira de câmera (bombExplosion.js/cameraShake.js, disparados por
    // game.js) em vez do flash verde + chime de uma entrega bem-sucedida.
    if (wasCorrect) {
      greenFlashElapsed = 0;
      deliveryChime.play();
    } else {
      onIncorrectDelivery?.();
    }
    onDeliver?.(bomb.id, wasCorrect);
  }

  // Guarda a referência do alvo (não só registra) — cartHitRadius muda por
  // fase (difficulty.js); reset() abaixo atualiza o raio direto neste
  // registro em vez de desregistrar/registrar de novo a cada rodada.
  const cartThrowTarget = grabSystem.registerThrowTarget(cart, cartHitRadius, (object3D) => {
    const bomb = latestBombs.find((b) => b.group === object3D);
    if (bomb) beginDelivery(bomb);
  });

  function update(dt, tipPositions, bombs) {
    latestBombs = bombs;
    beltTexture.offset.y -= dt * BELT_SPEED;

    cartPhase += dt * cartCycleSpeed;
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
  }

  // Reinicia a esteira pra uma nova rodada em memória (game.js#resetRound,
  // loop contínuo entre fases — ver game-3d/instrucao.md): `traveling` da
  // rodada anterior referenciaria bombas já descartadas; `cartHitRadius`/
  // `cartCycleSpeed` mudam por fase, atualizados aqui em vez de recriar a
  // esteira inteira (que também recriaria a geometria estática sem
  // necessidade).
  function reset({ cartHitRadius: newRadius, cartCycleSpeed: newSpeed } = {}) {
    traveling.length = 0;
    cartPhase = 0;
    cart.position.z = 0;
    greenFlashElapsed = GREEN_FLASH_DURATION;
    if (newSpeed !== undefined) cartCycleSpeed = newSpeed;
    if (newRadius !== undefined) {
      cartHitRadius = newRadius;
      cartThrowTarget.radius = newRadius;
    }
  }

  return { group, update, reset };
}
