import * as THREE from 'three';
import { createStripeTexture } from './stripeTexture.js';
import { ROOM_CEILING_Y } from './roomLayout.js';

// Decoração ambiente da sala (achado do playtest: "sala vazia" — chão/paredes
// eram cor sólida lisa, sem props, sem trilha nenhuma no piso, teto sem
// nenhuma tubulação). Tudo aqui é geometria estática ou textura procedural
// via canvas (mesma técnica de stripeTexture.js), sem física real — só
// acabamento visual, nenhum item aqui é interativo.

// --- Texturas procedurais (chão/paredes) ---------------------------------

// Piso de concreto industrial: ladrilho grande com ruído (manchas) + linha de
// rejunte nas bordas do tile, repetido via RepeatWrapping — mesmo truque de
// stripeTexture.js, só que sem padrão geométrico regular (concreto real não é
// perfeitamente uniforme).
export function createConcreteFloorTexture({ size = 256 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#5a5a68';
  ctx.fillRect(0, 0, size, size);

  // Ruído: retângulos pequenos com variação leve de tom, dá a sensação de
  // concreto manchado sem precisar de Perlin noise real.
  for (let i = 0; i < 260; i++) {
    const shade = 70 + Math.floor(Math.random() * 40);
    ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade + 10}, 0.35)`;
    const w = 2 + Math.random() * 6;
    ctx.fillRect(Math.random() * size, Math.random() * size, w, w);
  }

  // Linha de rejunte no perímetro do tile — some ao repetir a textura,
  // formando a grade de ladrilhos na superfície inteira.
  ctx.strokeStyle = 'rgba(20, 20, 26, 0.8)';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Painel de parede com rebites nos cantos (visual "chapa industrial
// aparafusada") — mesma ideia de tile repetido, um painel = uma chapa.
export function createRivetedWallTexture({ size = 256 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#40414a';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(20, 20, 24, 0.9)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, size - 6, size - 6);

  const margin = size * 0.12;
  const rivetRadius = size * 0.025;
  [[margin, margin], [size - margin, margin], [margin, size - margin], [size - margin, size - margin]].forEach(
    ([rx, ry]) => {
      ctx.beginPath();
      ctx.arc(rx, ry, rivetRadius, 0, Math.PI * 2);
      ctx.fillStyle = '#232328';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(rx - rivetRadius * 0.3, ry - rivetRadius * 0.3, rivetRadius * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fill();
    }
  );

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// --- Trilha de zona no piso ------------------------------------------------

// Marcação pintada no chão sob cada estação, na cor da luz daquela zona —
// MeshBasicMaterial (não recebe sombra/luz) de propósito: uma faixa pintada
// de verdade continua legível mesmo nas áreas da sala com pouca luz global.
export function createFloorZoneMarker({ scene, position, color, width = 1.3, depth = 1.3 }) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
  );
  mesh.rotation.x = -Math.PI / 2;
  // Levemente acima do chão (0.006) mas abaixo dos discos de teleporte
  // (0.01, ver teleport.js) — não deve competir com eles por z-fighting.
  mesh.position.set(position.x, 0.006, position.z);
  scene.add(mesh);
  return mesh;
}

// --- Props estáticos de canto ----------------------------------------------

const crateMaterial = new THREE.MeshStandardMaterial({ color: 0x8d6e63, roughness: 0.85, metalness: 0.05 });
const hazardCrateMaterial = new THREE.MeshStandardMaterial({
  map: createStripeTexture({ colorA: '#f2c200', colorB: '#2a2a2a', size: 48 }),
  roughness: 0.8,
});

export function createCrateStack({ scene, position, rotationY = 0 }) {
  const group = new THREE.Group();
  group.position.set(position.x, 0, position.z);
  group.rotation.y = rotationY;
  scene.add(group);

  const crateSize = 0.4;
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(crateSize, crateSize, crateSize), crateMaterial);
  bottom.position.y = crateSize / 2;
  group.add(bottom);

  // Caixa de cima, girada e com textura de alerta — quebra a repetição do
  // bloco liso debaixo e reaproveita a mesma textura já usada no dispenser.
  const top = new THREE.Mesh(new THREE.BoxGeometry(crateSize * 0.85, crateSize * 0.85, crateSize * 0.85), hazardCrateMaterial);
  top.position.set(0.04, crateSize + crateSize * 0.425, -0.03);
  top.rotation.y = 0.35;
  group.add(top);

  return { group };
}

export function createBarrel({ scene, position, rotationY = 0 }) {
  const group = new THREE.Group();
  group.position.set(position.x, 0, position.z);
  group.rotation.y = rotationY;
  scene.add(group);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.62, 20),
    new THREE.MeshStandardMaterial({ color: 0x2e5f3f, roughness: 0.6, metalness: 0.3 })
  );
  body.position.y = 0.31;
  group.add(body);

  // Duas cintas metálicas (leve destaque, sem custo real — só cilindros
  // finos um pouco mais largos que o corpo).
  const bandMaterial = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.5, metalness: 0.6 });
  [0.16, 0.46].forEach((y) => {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.226, 0.226, 0.05, 20), bandMaterial);
    band.position.y = y;
    group.add(band);
  });

  return { group };
}

// Cone de sinalização perto da alavanca de purga do scanner — só decorativo,
// reforça "atenção" no centro da sala sem competir com o disco de teleporte.
export function createCautionCone({ scene, position }) {
  const group = new THREE.Group();
  group.position.set(position.x, 0, position.z);
  scene.add(group);

  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.14, 0.32, 16),
    new THREE.MeshStandardMaterial({ color: 0xff6a00, roughness: 0.6 })
  );
  cone.position.y = 0.16;
  group.add(cone);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.03, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 })
  );
  base.position.y = 0.015;
  group.add(base);

  // Faixa reflexiva (mesma textura de alerta, só que fina e horizontal).
  const stripeTexture = createStripeTexture({ colorA: '#ffffff', colorB: '#ff6a00', size: 32 });
  stripeTexture.repeat.set(3, 1);
  const stripe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.12, 0.06, 16, 1, true),
    new THREE.MeshStandardMaterial({ map: stripeTexture, roughness: 0.5 })
  );
  stripe.position.y = 0.2;
  group.add(stripe);

  return { group };
}

// Extintor montado na parede — só decorativo, reforça leitura "instalação de
// verdade" perto da porta.
export function createFireExtinguisher({ scene, position, rotationY = 0 }) {
  const group = new THREE.Group();
  group.position.set(position.x, position.y, position.z);
  group.rotation.y = rotationY;
  scene.add(group);

  const bracket = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.03, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.4 })
  );
  group.add(bracket);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.07, 0.32, 16),
    new THREE.MeshStandardMaterial({ color: 0xb02a1e, roughness: 0.5, metalness: 0.2 })
  );
  body.position.set(0, -0.19, 0.04);
  group.add(body);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 0.04, 12),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.4 })
  );
  cap.position.set(0, -0.02, 0.04);
  group.add(cap);

  const nozzle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.14, 8),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 })
  );
  nozzle.rotation.z = Math.PI / 3;
  nozzle.position.set(-0.06, 0.02, 0.04);
  group.add(nozzle);

  return { group };
}

// --- Tubulação/vigas de teto -----------------------------------------------

// Conduítes ligando o holograma central (teto) às 4 paredes — só leitura
// "instalação industrial de verdade" por cima da cabeça do jogador; não
// interage com nada, por isso nem recebe param de scene em cada trecho (só
// um grupo único, adicionado uma vez).
export function createCeilingConduits({ scene, roomHalfX, roomHalfZ }) {
  const group = new THREE.Group();
  const y = ROOM_CEILING_Y - 0.06;
  group.position.set(0, y, 0);
  scene.add(group);

  const pipeMaterial = new THREE.MeshStandardMaterial({ color: 0x33343a, roughness: 0.4, metalness: 0.7 });

  // Cilindro deitado: CylinderGeometry nasce deitado no eixo Y, então
  // rotation.z = PI/2 deixa ele correndo no eixo X, e rotation.x = PI/2 no
  // eixo Z — usado pros dois troncos retos que cruzam o teto abaixo.
  function addPipe(length, position, rotation) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, length, 10), pipeMaterial);
    pipe.position.copy(position);
    pipe.rotation.copy(rotation);
    group.add(pipe);
  }

  addPipe(roomHalfX * 2 - 0.4, new THREE.Vector3(0, 0, -0.5), new THREE.Euler(0, 0, Math.PI / 2));
  addPipe(roomHalfZ * 2 - 0.4, new THREE.Vector3(0.5, 0, 0), new THREE.Euler(Math.PI / 2, 0, 0));

  // Flanges (discos finos) nos pontos onde os troncos "entrariam" na parede
  // — só um acabamento, sem funil real atrás.
  const flangeMaterial = new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.5, metalness: 0.5 });
  [
    [0, -roomHalfZ + 0.05, Math.PI / 2],
    [0, roomHalfZ - 0.05, Math.PI / 2],
    [roomHalfX - 0.05, 0, 0],
    [-roomHalfX + 0.05, 0, 0],
  ].forEach(([fx, fz, rotX]) => {
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 12), flangeMaterial);
    flange.position.set(fx, 0, fz);
    flange.rotation.x = rotX;
    group.add(flange);
  });

  return { group };
}

// --- Rodapé -----------------------------------------------------------------

// Tira fina onde cada parede encosta no chão — resolve a costura "flutuante"
// entre chão (cor 0x555566) e parede (cor 0x3d3d46) sem precisar remodelar
// nenhum dos dois.
export function createBaseboards({ scene, roomHalfX, roomHalfZ, wallThickness }) {
  const material = new THREE.MeshStandardMaterial({ color: 0x24242a, roughness: 0.7, metalness: 0.1 });
  const height = 0.08;
  const depth = wallThickness * 0.6;

  function addStrip(length, position, rotationY) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(length, height, depth), material);
    strip.position.set(position.x, height / 2, position.z);
    strip.rotation.y = rotationY;
    scene.add(strip);
  }

  addStrip(roomHalfX * 2, new THREE.Vector3(0, 0, -roomHalfZ + depth / 2), 0); // norte
  addStrip(roomHalfX * 2, new THREE.Vector3(0, 0, roomHalfZ - depth / 2), 0); // sul
  addStrip(roomHalfZ * 2, new THREE.Vector3(roomHalfX - depth / 2, 0, 0), Math.PI / 2); // leste
  addStrip(roomHalfZ * 2, new THREE.Vector3(-roomHalfX + depth / 2, 0, 0), Math.PI / 2); // oeste
}
