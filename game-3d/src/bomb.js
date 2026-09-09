import * as THREE from 'three';
import { createWireCuttingModule } from './wireCuttingModule.js';
import { createKeypadModule } from './keypadModule.js';
import { createButtonChoiceModule } from './buttonChoiceModule.js';
import { randomInt, shuffle } from './random.js';

// Cor do corpo por variante — puramente visual, os 3 desafios são sempre
// os mesmos independente da variante (ver CLAUDE.md, "Objetos micro").
const BODY_COLORS = [0xb0413e, 0x3e5cb0, 0x3e8f4f];
// Os módulos (fio/botão/teclado/visor) foram desenhados na escala da antiga
// estação fixa (bem maior que uma bomba de mão) — MODULE_SCALE encolhe cada
// peça pra caber num quadrante da bomba, sem precisar tocar na geometria
// interna de wireCuttingModule/buttonChoiceModule/keypadModule.js.
const MODULE_SCALE = 0.68;
// Folga entre os módulos e a placa de montagem (y=0.115, topo ~0.125) —
// antes era quase zero, o que deixava a borda dos módulos encostando/
// sobrepondo o corpo da bomba em alguns ângulos.
const MODULE_Y = 0.17;
const BODY_WIDTH = 0.56;
const BODY_HEIGHT = 0.18;
const BODY_DEPTH = 0.56;

// 4 quadrantes fixos no topo da bomba — cada bomba sorteia qual peça
// (fio/botão/teclado/visor+confirmar) cai em qual quadrante, então o
// jogador não pode decorar "o fio sempre fica à esquerda". Isso também
// evita que as peças se sobreponham entre si, já que cada uma sempre
// ocupa exatamente um slot de tamanho fixo, não importa a ordem.
const QUADRANT_OFFSET = 0.15;
const QUADRANTS = [
  { x: -QUADRANT_OFFSET, z: -QUADRANT_OFFSET },
  { x: QUADRANT_OFFSET, z: -QUADRANT_OFFSET },
  { x: -QUADRANT_OFFSET, z: QUADRANT_OFFSET },
  { x: QUADRANT_OFFSET, z: QUADRANT_OFFSET },
];

let nextBombId = 1;

// Corpo com cantos arredondados de verdade via ExtrudeGeometry (Shape em
// forma de retângulo com cantos em arco + bevelEnabled), em vez de uma
// BoxGeometry de cantos vivos — ainda é geometria primitiva pura do
// three.js, sem depender de import de modelo externo.
function buildRoundedBody(color) {
  const radius = 0.025;
  const halfW = BODY_WIDTH / 2;
  const halfD = BODY_DEPTH / 2;

  const shape = new THREE.Shape();
  shape.moveTo(-halfW + radius, -halfD);
  shape.lineTo(halfW - radius, -halfD);
  shape.absarc(halfW - radius, -halfD + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(halfW, halfD - radius);
  shape.absarc(halfW - radius, halfD - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(-halfW + radius, halfD);
  shape.absarc(-halfW + radius, halfD - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(-halfW, -halfD + radius);
  shape.absarc(-halfW + radius, -halfD + radius, radius, Math.PI, (3 * Math.PI) / 2, false);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: BODY_HEIGHT,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 3,
    curveSegments: 6,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -BODY_HEIGHT / 2, 0);

  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05 });
  return new THREE.Mesh(geometry, material);
}

// Estado + visual de uma bomba. Os 3 desafios (fio, botão, senha) já são
// instanciados na criação — cada um sorteia sua própria resposta correta
// nesse momento — e ficam visíveis no modelo da bomba desde o início, mas
// SEM interação: cortar fio, apertar botão e digitar senha só funcionam
// depois que a bomba entra no modo de desarme na mesa (activateModules).
// O resultado de cada desafio (true/false/null) só é usado para calcular a
// pontuação no relatório final; nada é exibido ao jogador durante a partida.
export function createBomb() {
  const id = nextBombId++;
  const variant = randomInt(0, BODY_COLORS.length - 1);

  const group = new THREE.Group();
  const body = buildRoundedBody(BODY_COLORS[variant]);
  group.add(body);

  // Faixa/cinta ao redor do meio do corpo — quebra a leitura de "bloco de
  // cor única" e reforça a ideia de invólucro/dispositivo, não caixa lisa.
  const beltStripe = new THREE.Mesh(
    new THREE.BoxGeometry(BODY_WIDTH + 0.004, 0.025, BODY_DEPTH + 0.004),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6, metalness: 0.2 })
  );
  beltStripe.position.y = -0.01;
  group.add(beltStripe);

  // Parafusos decorativos nos 4 cantos superiores — greeble barato via
  // geometria primitiva, sem textura, reforça leitura de "montado", não moldado.
  const boltGeometry = new THREE.CylinderGeometry(0.008, 0.008, 0.01, 8);
  const boltMaterial = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.8 });
  const boltInset = 0.02;
  [-1, 1].forEach((sx) => {
    [-1, 1].forEach((sz) => {
      const bolt = new THREE.Mesh(boltGeometry, boltMaterial);
      bolt.position.set(
        sx * (BODY_WIDTH / 2 - boltInset),
        BODY_HEIGHT / 2 - 0.005,
        sz * (BODY_DEPTH / 2 - boltInset)
      );
      group.add(bolt);
    });
  });

  // Placa de montagem: uma base fina conectando visualmente o corpo aos 3
  // módulos de desafio, que ficam alguns cm acima (posição fixa em y=0.14,
  // ver `modules.forEach` abaixo) — sem essa placa os módulos pareciam
  // flutuar soltos sobre a bomba.
  const mountPlate = new THREE.Mesh(
    new THREE.BoxGeometry(BODY_WIDTH - 0.01, 0.02, BODY_DEPTH - 0.06),
    new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.7, metalness: 0.1 })
  );
  mountPlate.position.y = 0.115;
  group.add(mountPlate);

  // LED de status: pisca enquanto a bomba está ativa no modo de desarme,
  // reforçando "isso é um dispositivo eletrônico ligado".
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.008, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xff2222, emissiveIntensity: 0 })
  );
  led.position.set(BODY_WIDTH / 2 - 0.03, BODY_HEIGHT / 2 - 0.01, BODY_DEPTH / 2 - 0.03);
  group.add(led);
  let ledPhase = 0;

  let wireResult = null;
  let buttonResult = null;
  let codeResult = null;

  const wireModule = createWireCuttingModule({
    onSolved: () => {
      wireResult = true;
    },
    onFailed: () => {
      wireResult = false;
    },
  });

  const buttonModule = createButtonChoiceModule({
    // last-press-wins: cada toque atualiza o resultado, correto ou não.
    onResult: (correct) => {
      buttonResult = correct;
    },
  });

  const keypadModule = createKeypadModule({
    onSolved: () => {
      codeResult = true;
    },
  });

  // `modules`: as 3 peças LÓGICAS (fio, botão, senha) — cada uma com seu
  // próprio update/handleTrigger/dispose/resultado.
  const modules = [wireModule, buttonModule, keypadModule];

  // `quadrantPieces`: as 4 peças VISUAIS a posicionar, uma por quadrante —
  // o teclado de senha vira duas peças (padGroup e displayGroup) que podem
  // cair em quadrantes diferentes, sorteados independentemente do resto.
  const quadrantPieces = [
    wireModule.group,
    buttonModule.group,
    keypadModule.padGroup,
    keypadModule.displayGroup,
  ];
  const shuffledQuadrants = shuffle(QUADRANTS);
  quadrantPieces.forEach((pieceGroup, index) => {
    const slot = shuffledQuadrants[index];
    // As peças foram desenhadas como um painel vertical (pensado pra ser
    // visto de frente, em pé) — rotacionar -90° em X deita esse painel na
    // horizontal, alinhado com o corpo da bomba (que fica deitado na mesa).
    pieceGroup.rotation.x = -Math.PI / 2;
    pieceGroup.scale.setScalar(MODULE_SCALE);

    // Centraliza pelo bounding box real do conteúdo (não só pela origem do
    // grupo) — alguns elementos internos (bezels, visor) não são
    // perfeitamente simétricos em torno da origem, o que deixava a peça
    // visualmente descentralizada dentro do quadrante. Calculado ANTES de
    // dar position/de entrar na cena, então o box já sai no espaço local
    // do quadrante (sem herdar a transform da bomba).
    pieceGroup.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(pieceGroup).getCenter(new THREE.Vector3());
    pieceGroup.position.set(slot.x - center.x, MODULE_Y - center.y, slot.z - center.z);

    group.add(pieceGroup);
  });

  let scanned = false;
  let hasPamphlet = false;
  let pamphletGroup = null;
  let delivered = false;
  let active = false;

  // Os módulos ficam SEMPRE visíveis no modelo da bomba, desde a criação —
  // só a interação (cortar fio, apertar botão, digitar senha) é travada até
  // a bomba entrar no modo de desarme na mesa. activateModules/
  // deactivateModules controlam só o flag `active` (ver update/handleTrigger
  // abaixo), nunca a visibilidade.
  function activateModules() {
    active = true;
  }

  function deactivateModules() {
    active = false;
    led.material.emissiveIntensity = 0;
  }

  function update(dt, tipPositions, cutterTip) {
    if (!active) return;
    ledPhase += dt * 6;
    led.material.emissiveIntensity = 0.5 + 0.5 * Math.sin(ledPhase);
    modules.forEach((mod) => mod.update(dt, tipPositions, cutterTip));
  }

  function handleTrigger(point) {
    if (!active) return;
    modules.forEach((mod) => mod.handleTrigger(point));
  }

  function markScanned() {
    scanned = true;
    hasPamphlet = true;
  }

  function isFullyCorrect() {
    return wireResult === true && buttonResult === true && codeResult === true;
  }

  function dispose() {
    modules.forEach((mod) => mod.dispose());
    body.geometry.dispose();
    body.material.dispose();
    beltStripe.geometry.dispose();
    beltStripe.material.dispose();
    boltGeometry.dispose();
    boltMaterial.dispose();
    mountPlate.geometry.dispose();
    mountPlate.material.dispose();
    led.geometry.dispose();
    led.material.dispose();
  }

  return {
    id,
    variant,
    group,
    wireModule,
    buttonModule,
    keypadModule,
    update,
    handleTrigger,
    activateModules,
    deactivateModules,
    markScanned,
    isFullyCorrect,
    dispose,
    get scanned() {
      return scanned;
    },
    get hasPamphlet() {
      return hasPamphlet;
    },
    get pamphletGroup() {
      return pamphletGroup;
    },
    set pamphletGroup(value) {
      pamphletGroup = value;
    },
    get delivered() {
      return delivered;
    },
    set delivered(value) {
      delivered = value;
    },
    get results() {
      return { wireResult, buttonResult, codeResult };
    },
  };
}
