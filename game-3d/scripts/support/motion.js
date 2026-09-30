// Matemática de movimento pura (sem Playwright/página) — usada por
// humanRig.js pra gerar as poses de cabeça/mãos frame a frame. Fica
// separada de humanRig.js só porque é testável isoladamente (funções puras,
// sem IO), não porque o projeto pede uma camada extra aqui.

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function addVec(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
export function subVec(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
export function scaleVec(a, s) {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}
export function lerpVec(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}
export function lengthVec(a) {
  return Math.hypot(a.x, a.y, a.z);
}
export function distance(a, b) {
  return lengthVec(subVec(a, b));
}
export function distanceXZ(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
export function normalizeVec(a) {
  const l = lengthVec(a) || 1;
  return scaleVec(a, 1 / l);
}
export function crossVec(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

// Perfil de "minimum jerk" (Flash & Hogan) — quíntica com velocidade e
// aceleração zero nas duas pontas, o padrão de referência pra movimento
// humano de alcance (reaching) na literatura de controle motor. `u` é
// tempo normalizado [0,1], devolve progresso espacial normalizado [0,1].
export function minimumJerk(u) {
  const c = clamp(u, 0, 1);
  return 6 * c ** 5 - 15 * c ** 4 + 10 * c ** 3;
}

// Curva cúbica de Bézier — usada com um ponto de controle ALÉM do destino
// (p3) pra produzir overshoot de verdade: a curva passa perto/além de p3
// antes de `u` chegar em 1, e só pousa exatamente em p3 no fim (p3 sempre é
// o ponto final exato, então qualquer precisão de destino exigida por uma
// interação continua garantida).
export function cubicBezier(p0, p1, p2, p3, u) {
  const c = clamp(u, 0, 1);
  const mt = 1 - c;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * c;
  const cc = 3 * mt * c * c;
  const d = c * c * c;
  return {
    x: a * p0.x + b * p1.x + cc * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + cc * p2.y + d * p3.y,
    z: a * p0.z + b * p1.z + cc * p2.z + d * p3.z,
  };
}

// Monta os 4 pontos de controle de um alcance humano: sobe um pouco no meio
// do caminho (arco, não linha reta) e ultrapassa levemente o alvo antes de
// assentar (overshoot) — os dois efeitos pedidos junto com minimum-jerk.
// `rng` vem de prng.js (seed fixa, ver tarefa.md item 7).
export function buildArcPath(p0, p3, rng, opts = {}) {
  const dist = Math.max(distance(p0, p3), 0.001);
  const archHeight = clamp(dist * (opts.archRatio ?? 0.18), 0.015, opts.archMax ?? 0.12);
  const overshoot = clamp(dist * (opts.overshootRatio ?? 0.06), 0.005, opts.overshootMax ?? 0.05);

  const dir = normalizeVec(subVec(p3, p0));
  // Eixo "pra cima" do arco: perpendicular ao deslocamento, inclinado pra
  // world-up — arco de alcance humano sobe mais do que desvia lateralmente.
  let perp = crossVec(dir, { x: 0, y: 1, z: 0 });
  if (lengthVec(perp) < 1e-4) perp = { x: 1, y: 0, z: 0 };
  perp = normalizeVec(perp);
  // Pequena variação lateral seeded pra não ficar todo alcance com o MESMO
  // arco (viés sempre pro mesmo lado ficaria robótico e repetitivo).
  const lateralSign = rng.signed();

  const mid = lerpVec(p0, p3, 0.45);
  const p1 = addVec(lerpVec(p0, mid, 0.6), { x: 0, y: archHeight * 0.6, z: 0 });
  const p2 = addVec(
    addVec(p3, scaleVec(dir, overshoot)),
    addVec({ x: 0, y: archHeight * 0.3, z: 0 }, scaleVec(perp, lateralSign * archHeight * 0.25))
  );
  return { p0, p1, p2, p3 };
}

export function positionOnArc(arc, u) {
  return cubicBezier(arc.p0, arc.p1, arc.p2, arc.p3, minimumJerk(u));
}

// --- Quaternions (x,y,z,w) — sem depender de three.js no processo Node ---

export function quatMultiply(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function quatFromAxisAngle(axis, angle) {
  const half = angle / 2;
  const s = Math.sin(half);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
}

export function quatSlerp(qa, qb, t) {
  let { x: x0, y: y0, z: z0, w: w0 } = qa;
  let { x: x1, y: y1, z: z1, w: w1 } = qb;
  let dot = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1;
  if (dot < 0) {
    x1 = -x1;
    y1 = -y1;
    z1 = -z1;
    w1 = -w1;
    dot = -dot;
  }
  if (dot > 0.9995) {
    // Quase colineares — lerp+normaliza é suficiente e evita divisão por
    // sin(theta)~0 na fórmula geral abaixo.
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const z = z0 + (z1 - z0) * t;
    const w = w0 + (w1 - w0) * t;
    const len = Math.hypot(x, y, z, w) || 1;
    return { x: x / len, y: y / len, z: z / len, w: w / len };
  }
  const theta0 = Math.acos(clamp(dot, -1, 1));
  const theta = theta0 * t;
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.cos(theta) - (dot * Math.sin(theta)) / sinTheta0;
  const s1 = Math.sin(theta) / sinTheta0;
  return {
    x: s0 * x0 + s1 * x1,
    y: s0 * y0 + s1 * y1,
    z: s0 * z0 + s1 * z1,
    w: s0 * w0 + s1 * w1,
  };
}

// Mesma construção de THREE.Matrix4.lookAt(eye,target,up) → quaternion
// (algoritmo de Shepperd), generalizada a partir do helper que já existia
// só pra câmera do dispositivo no script antigo (setHeadsetLookAt).
export function quatLookAt(eye, target, up = { x: 0, y: 1, z: 0 }) {
  const zAxis = normalizeVec(subVec(eye, target)); // câmera olha pra -Z local
  let xAxis = crossVec(up, zAxis);
  if (lengthVec(xAxis) < 1e-6) xAxis = { x: 1, y: 0, z: 0 };
  xAxis = normalizeVec(xAxis);
  const yAxis = crossVec(zAxis, xAxis);

  const m00 = xAxis.x,
    m01 = yAxis.x,
    m02 = zAxis.x;
  const m10 = xAxis.y,
    m11 = yAxis.y,
    m12 = zAxis.y;
  const m20 = xAxis.z,
    m21 = yAxis.z,
    m22 = zAxis.z;
  const trace = m00 + m11 + m22;
  let qx, qy, qz, qw;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    qw = 0.25 / s;
    qx = (m21 - m12) * s;
    qy = (m02 - m20) * s;
    qz = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  return { x: qx, y: qy, z: qz, w: qw };
}

// Extrai só o yaw (rotação em Y) de um quaternion — usado pro anchor de
// "mão em descanso" seguir o corpo do jeito que utilityBelt.js já faz
// (segue yaw da cabeça, ignora pitch/roll), não o olhar completo.
export function yawOnlyQuat(q) {
  // atan2 padrão pra extrair yaw de um quaternion (convenção Y-up).
  const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
  return quatFromAxisAngle({ x: 0, y: 1, z: 0 }, yaw);
}

export function applyQuatToVec(q, v) {
  // v' = q * v * q^-1, forma otimizada (sem construir o quaternion inverso).
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

// Ruído contínuo de baixa frequência — soma de duas senoides com fase/
// frequência sorteadas (seed fixa) por eixo, pra não repetir o mesmo
// padrão em X/Y/Z nem parecer periódico demais numa gravação curta. Só
// tremor de posição (rotação de mão/cabeça não é lida por nenhuma lógica de
// jogo — teleport.js é a exceção, tratada à parte com o ruído desligado).
export function createNoiseChannel(rng, amplitudeMeters = 0.006) {
  const axes = ['x', 'y', 'z'].map(() => ({
    freqA: 0.15 + rng.next() * 0.25, // 0.15–0.40 Hz
    freqB: 0.6 + rng.next() * 0.5, // 0.6–1.1 Hz
    phaseA: rng.next() * Math.PI * 2,
    phaseB: rng.next() * Math.PI * 2,
    mix: 0.6 + rng.next() * 0.3,
  }));
  return function noiseAt(tSeconds) {
    const out = {};
    ['x', 'y', 'z'].forEach((axis, i) => {
      const a = axes[i];
      const wave =
        a.mix * Math.sin(2 * Math.PI * a.freqA * tSeconds + a.phaseA) +
        (1 - a.mix) * Math.sin(2 * Math.PI * a.freqB * tSeconds + a.phaseB);
      out[axis] = wave * amplitudeMeters;
    });
    return out;
  };
}
