import * as THREE from 'three';
import { shuffle } from './random.js';

const WIRE_COUNT = 4;
const WIRE_COLORS = [0xdd2222, 0x2255dd, 0xdddd22, 0x22aa44];
const WIRE_LENGTH = 0.3;
const WIRE_RADIUS = 0.012;
const WIRE_SPACING = 0.08;
// Precisa ser bem menor que a metade do espaçamento REAL entre fios depois
// da escala aplicada por bomb.js (WIRE_SPACING * MODULE_SCALE ≈ 0.054, então
// metade ≈ 0.027) — um valor maior que isso faz o alicate ficar "dentro do
// alcance" de MAIS de um fio ao mesmo tempo, e o corte sempre acerta o
// primeiro do array (era o bug do "sempre corta o azul": o threshold antigo,
// 0.15, cobria os 4 fios de uma vez, então a mira nunca importava).
const CUT_DISTANCE_THRESHOLD = 0.022;
const CUT_GAP = 0.015;
const ARC_HEIGHT = 0.06;
const OUTLINE_SCALE = 1.6;

function closestPointOnSegment(point, start, end) {
  const segment = new THREE.Vector3().subVectors(end, start);
  const t = THREE.MathUtils.clamp(
    new THREE.Vector3().subVectors(point, start).dot(segment) / segment.lengthSq(),
    0,
    1
  );
  return start.clone().addScaledVector(segment, t);
}

// Cilindro reto simples entre dois pontos LOCAIS — usado só para os dois
// tocos visuais que sobram depois do corte (não precisa reproduzir o arco
// bezier do fio inteiro, o corte já quebra a curva de qualquer forma).
function makeStraightSegment(start, end, color) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const geometry = new THREE.CylinderGeometry(WIRE_RADIUS, WIRE_RADIUS, length, 8);
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(start).addScaledVector(direction, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
  return mesh;
}

// Módulo de corte de fio: interação por gatilho (handleTrigger), estilo KTANE —
// cortar o fio errado explode a bomba na hora (onFailed), sem esperar o timer.
export function createWireCuttingModule({ onSolved, onFailed }) {
  const group = new THREE.Group();
  let resolved = false;
  const cutMeshes = [];

  const colors = shuffle(WIRE_COLORS).slice(0, WIRE_COUNT);
  const correctIndex = Math.floor(Math.random() * WIRE_COUNT);

  // Conectores nas pontas — pequenos terminais escuros onde o fio "entra"
  // na carcaça, compartilhados entre os 4 fios (geometria/material neutros).
  const capGeometry = new THREE.CylinderGeometry(WIRE_RADIUS * 1.8, WIRE_RADIUS * 1.8, 0.012, 8);
  const capMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.5 });

  const wires = colors.map((color, i) => {
    const y = (i - (WIRE_COUNT - 1) / 2) * WIRE_SPACING;
    const localStart = new THREE.Vector3(-WIRE_LENGTH / 2, y, 0);
    const localEnd = new THREE.Vector3(WIRE_LENGTH / 2, y, 0);

    // Arqueamento (bezier quadrática) bem mais pronunciado que um "sag"
    // sutil — o teste de corte continua usando o segmento reto localStart/
    // localEnd acima, então o desvio é mantido bem menor que
    // CUT_DISTANCE_THRESHOLD para não descolar visual de hit-test.
    const mid = new THREE.Vector3(0, y, ARC_HEIGHT);
    const curve = new THREE.QuadraticBezierCurve3(localStart, mid, localEnd);
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 12, WIRE_RADIUS, 8, false),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
    );
    group.add(mesh);

    // Contorno de mira: casca um pouco maior renderizada por dentro
    // (BackSide) — técnica de "inverted hull", sem precisar de post-
    // processing. Só fica visível no fio mais perto da ponta do alicate.
    const outline = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 12, WIRE_RADIUS * OUTLINE_SCALE, 8, false),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide })
    );
    outline.visible = false;
    group.add(outline);

    // Pontas orientadas pela TANGENTE da curva no início/fim, em vez de uma
    // rotação fixa — com o arco pronunciado, isso faz as pontas mergulharem
    // na direção do corpo da bomba (de onde o fio "sai"), em vez de ficarem
    // viradas pra fora, apontando pro nada.
    const capStart = new THREE.Mesh(capGeometry, capMaterial);
    capStart.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(0).normalize());
    capStart.position.copy(localStart);
    group.add(capStart);

    const capEnd = new THREE.Mesh(capGeometry, capMaterial);
    capEnd.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(1).normalize());
    capEnd.position.copy(localEnd);
    group.add(capEnd);

    return {
      mesh,
      outline,
      correct: i === correctIndex,
      localStart,
      localEnd,
    };
  });

  let hoveredWire = null;

  function setHover(wire) {
    if (hoveredWire === wire) return;
    if (hoveredWire) hoveredWire.outline.visible = false;
    hoveredWire = wire;
    if (hoveredWire) hoveredWire.outline.visible = true;
  }

  // Usado tanto pelo destaque (a cada frame, com a ponta do alicate) quanto
  // pelo corte de verdade (no gatilho) — garante que o fio destacado em
  // branco é sempre exatamente o que vai ser cortado.
  function findNearestWire(point) {
    let nearest = null;
    let nearestDistance = CUT_DISTANCE_THRESHOLD;
    let nearestPoint = null;
    for (const wire of wires) {
      const start = group.localToWorld(wire.localStart.clone());
      const end = group.localToWorld(wire.localEnd.clone());
      const closest = closestPointOnSegment(point, start, end);
      const distance = closest.distanceTo(point);
      if (distance <= nearestDistance) {
        nearestDistance = distance;
        nearest = wire;
        nearestPoint = closest;
      }
    }
    return nearest ? { wire: nearest, point: nearestPoint } : null;
  }

  // Efeito neutro de "fio cortado": some com o fio inteiro e bota dois
  // tocos com um vão no meio, no ponto exato do corte — sempre com a MESMA
  // cor original, em qualquer fio (certo ou errado), pra não vazar o
  // resultado (só o relatório final revela isso).
  function cutWireVisual(wire, worldCutPoint) {
    const localCut = group.worldToLocal(worldCutPoint.clone());
    const direction = wire.localEnd.clone().sub(wire.localStart).normalize();
    const cutA = localCut.clone().addScaledVector(direction, -CUT_GAP);
    const cutB = localCut.clone().addScaledVector(direction, CUT_GAP);

    wire.mesh.visible = false;
    const color = wire.mesh.material.color;
    const segA = makeStraightSegment(wire.localStart, cutA, color);
    const segB = makeStraightSegment(cutB, wire.localEnd, color);
    group.add(segA, segB);
    cutMeshes.push(segA, segB);
  }

  function handleTrigger(point) {
    if (resolved || !point) return;
    const hit = findNearestWire(point);
    if (!hit) return;
    resolved = true;
    setHover(null);
    cutWireVisual(hit.wire, hit.point);
    if (hit.wire.correct) {
      onSolved();
    } else {
      onFailed();
    }
  }

  // cutterTip: ponta do alicate (mundo), só quando ele está na mão — ver
  // defuseTable.js/bomb.js. Sem alicate na mão, nada fica destacado.
  function update(dt, tipPositions, cutterTip) {
    if (resolved || !cutterTip) {
      setHover(null);
      return;
    }
    const hit = findNearestWire(cutterTip);
    setHover(hit ? hit.wire : null);
  }

  function dispose() {
    wires.forEach(({ mesh, outline }) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
      outline.geometry.dispose();
      outline.material.dispose();
    });
    capGeometry.dispose();
    capMaterial.dispose();
    cutMeshes.forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
  }

  return {
    group,
    update,
    handleTrigger,
    dispose,
    // Cor do fio certo — usada pelo panfleto (scanner) para instruir o
    // jogador, independente de a bomba já ter sido cortada ou não.
    correctColor: colors[correctIndex],
  };
}
