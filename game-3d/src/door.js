import * as THREE from 'three';
import { createStripeTexture } from './stripeTexture.js';
import { createTextPanel } from './textPanel.js';

// Porta de entrada/saída da sala (RoomRefactor item de decoração) — estilo
// "porta de sala de segurança" (blast door industrial: moldura reforçada,
// faixa de risco amarela/preta, luz de status no cabeçalho). Por enquanto é
// só geometria estática (a sala ainda não tem fluxo de entrada/saída) — o
// painel (`panel`) e a luz de status (`statusLight`) são expostos à parte
// pra uma etapa futura poder animar abertura/fechamento e mudar a cor do
// status sem precisar remontar a porta inteira.
const DOOR_WIDTH = 0.9;
const DOOR_HEIGHT = 2.0;
const JAMB_THICKNESS = 0.09;
const JAMB_DEPTH = 0.07;
const FRAME_HEIGHT = DOOR_HEIGHT + JAMB_THICKNESS;

export function createDoor({ scene, position, rotationY = 0 }) {
  const group = new THREE.Group();
  group.position.set(position.x, 0, position.z);
  group.rotation.y = rotationY;
  scene.add(group);

  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.6, metalness: 0.6 });
  const panelMaterial = new THREE.MeshStandardMaterial({ color: 0x53565c, roughness: 0.55, metalness: 0.5 });

  const header = new THREE.Mesh(
    new THREE.BoxGeometry(DOOR_WIDTH + JAMB_THICKNESS * 2, JAMB_THICKNESS, JAMB_DEPTH),
    frameMaterial
  );
  header.position.set(0, FRAME_HEIGHT - JAMB_THICKNESS / 2, JAMB_DEPTH / 2);
  group.add(header);

  const jambGeometry = new THREE.BoxGeometry(JAMB_THICKNESS, FRAME_HEIGHT, JAMB_DEPTH);
  [-1, 1].forEach((side) => {
    const jamb = new THREE.Mesh(jambGeometry, frameMaterial);
    jamb.position.set(side * (DOOR_WIDTH / 2 + JAMB_THICKNESS / 2), FRAME_HEIGHT / 2, JAMB_DEPTH / 2);
    group.add(jamb);
  });

  // Slab principal, recuada em relação à moldura (que se projeta um pouco
  // mais pra dentro da sala) — dá a leitura de porta encaixada no vão, não
  // só uma placa colada na parede.
  const panel = new THREE.Mesh(new THREE.BoxGeometry(DOOR_WIDTH, DOOR_HEIGHT, 0.05), panelMaterial);
  panel.position.set(0, DOOR_HEIGHT / 2, 0.02);
  group.add(panel);

  // Nervuras horizontais (reforço estilo porta blindada) — só 3 tiras finas
  // levemente salientes sobre a slab, sem geometria extra de peso real.
  const ribGeometry = new THREE.BoxGeometry(DOOR_WIDTH - 0.08, 0.05, 0.015);
  [0.28, 0.52, 0.76].forEach((t) => {
    const rib = new THREE.Mesh(ribGeometry, frameMaterial);
    rib.position.set(0, DOOR_HEIGHT * t, 0.05);
    group.add(rib);
  });

  // Faixa de risco (amarelo/preto) perto da base — mesma técnica procedural
  // já usada no dispenser/esteira, aplicada aqui só como acabamento.
  const hazardTexture = createStripeTexture({ colorA: '#f2c200', colorB: '#111111', size: 48 });
  hazardTexture.repeat.set(4, 1);
  const hazardStripe = new THREE.Mesh(
    new THREE.PlaneGeometry(DOOR_WIDTH - 0.06, 0.16),
    new THREE.MeshStandardMaterial({ map: hazardTexture, roughness: 0.7 })
  );
  hazardStripe.position.set(0, 0.22, 0.048);
  group.add(hazardStripe);

  // Barra de abertura (estilo painic bar), só decorativa por enquanto.
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 0.4, 12),
    frameMaterial
  );
  handle.rotation.z = Math.PI / 2;
  handle.position.set(DOOR_WIDTH / 2 - 0.14, DOOR_HEIGHT * 0.5, 0.05);
  group.add(handle);

  // Placa de aviso acima da porta, mesma linguagem dos painéis de status já
  // usados na sala (wallPanelA/B em game.js).
  const plaque = createTextPanel({ width: 0.5, height: 0.16, fontSize: 30 });
  plaque.setText(['ACESSO RESTRITO'], '#ff5555', '#111111');
  plaque.mesh.position.set(0, FRAME_HEIGHT + 0.16, JAMB_DEPTH);
  group.add(plaque.mesh);

  // Luz de status no cabeçalho — verde por padrão (placeholder de "liberada");
  // uma etapa futura de fluxo de entrada/saída pode trocar cor/estado aqui
  // sem precisar tocar no resto da porta.
  const statusLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.03, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0x33ff66, emissive: 0x33ff66, emissiveIntensity: 1.2 })
  );
  statusLight.position.set(0, FRAME_HEIGHT - JAMB_THICKNESS / 2, JAMB_DEPTH + 0.02);
  group.add(statusLight);

  const statusPointLight = new THREE.PointLight(0x33ff66, 0.4, 1.2);
  statusPointLight.position.copy(statusLight.position);
  group.add(statusPointLight);

  return { group, panel, statusLight };
}
