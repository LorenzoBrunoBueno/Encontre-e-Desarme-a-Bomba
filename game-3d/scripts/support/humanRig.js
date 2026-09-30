// HumanRig — motor de automação "humanizada" pro IWER, usado por
// game-3d/scripts/record-demo.mjs. Dirige cabeça + duas mãos com:
//
//   (1) toda transição de posição/rotação em minimum-jerk, duração
//       proporcional à distância (ver motion.js#minimumJerk);
//   (2) trajetórias em arco leve com overshoot (motion.js#buildArcPath);
//   (3) cabeça olhando pro alvo 250ms ANTES da mão chegar
//       (_scheduleGazeLead);
//   (4) ruído contínuo de baixa frequência em cabeça e nas duas mãos
//       (motion.js#createNoiseChannel), desligado só durante o assentamento
//       final de um clique/teleporte (mão tem que ficar imóvel pra
//       confirmar a interação);
//   (5) a mão que não está em uso descansa numa pose relativa à cabeça
//       (restPoseWorld, mesmo princípio de utilityBelt.js: segue X/Z + yaw
//       da cabeça, não pitch/roll);
//   (6) trigger/botões com rampa de 100ms e pausas de 300ms antes/depois;
//   (7) toda duração passa por rng.jitter(±15%) com seed fixa (prng.js);
//   (8)/(9) relógio virtual de 60fps via page.clock — ver record-demo.mjs,
//       que instancia esta classe já com o clock instalado.
//
// Import de posição SEMPRE recomputado do zero a partir de t (ou da última
// leitura real do jogo) e escrito com `.set(x,y,z)` — nunca
// `.position.x += delta`. Isso importa de verdade aqui: com ruído contínuo
// rodando a cada frame, uma soma cumulativa acumularia o próprio ruído como
// deslocamento permanente (random walk) em vez de tremor em torno de um
// ponto fixo. Ver clampToRoom/teleportTo mais abaixo pro mesmo cuidado
// aplicado à posição do jogador (item 10 do tarefa.md).
import {
  clamp,
  addVec,
  subVec,
  scaleVec,
  distance,
  distanceXZ,
  normalizeVec,
  crossVec,
  positionOnArc,
  buildArcPath,
  quatSlerp,
  quatLookAt,
  yawOnlyQuat,
  applyQuatToVec,
  createNoiseChannel,
  minimumJerk,
} from './motion.js';
import { createRng } from './prng.js';
import { ROOM_HALF_X, ROOM_HALF_Z } from '../../src/roomLayout.js';

export const FRAME_MS = 1000 / 60;

const IDENTITY_QUAT = { x: 0, y: 0, z: 0, w: 1 };

// --- Timing humano (todos passam por rng.jitter ±15%, requisito 7) ---
const BASE_MOVE_S = 0.15;
const PER_METER_S = 0.55;
const MIN_MOVE_S = 0.18;
const MAX_MOVE_S = 2.5;
const GAZE_LEAD_S = 0.25; // requisito 3
const MIN_HEAD_DURATION_S = 0.12;
const CLICK_RAMP_S = 0.1; // requisito 6
const CLICK_PAUSE_BEFORE_S = 0.3;
const CLICK_PAUSE_AFTER_S = 0.3;
const GRIP_RAMP_S = 0.08;
const THROW_RELEASE_RAMP_S = 0.05;

// --- Teleporte (requisitos 10/11) ---
const ROOM_MARGIN_M = 0.4;
const ALREADY_THERE_EPS_M = 0.1;
const RAY_VALID_TIMEOUT_MS = 1000;
const TELEPORT_TOLERANCE_M = 0.2;

// --- Ruído (requisito 4) ---
const NOISE_AMPLITUDE_HAND = 0.006;
const NOISE_AMPLITUDE_HEAD = 0.004;

// --- Descanso relativo à cabeça (requisito 5), mesma convenção de
// utilityBelt.js: offsets no referencial local da cabeça (X=lado, Y=altura
// relativa, Z negativo=à frente), rotacionados só pelo yaw da cabeça.
const REST_POSE_LOCAL = {
  left: { x: -0.22, y: -0.32, z: -0.18 },
  right: { x: 0.22, y: -0.32, z: -0.18 },
};

function fmt(v) {
  return `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
}

function clampToRoom({ x, z }, margin = ROOM_MARGIN_M) {
  return {
    x: clamp(x, -ROOM_HALF_X + margin, ROOM_HALF_X - margin),
    z: clamp(z, -ROOM_HALF_Z + margin, ROOM_HALF_Z - margin),
  };
}

export class HumanRig {
  constructor(page, { seed, onFrame, spectatorWidth = 960, spectatorHeight = 540 } = {}) {
    this.page = page;
    this.rng = createRng(seed);
    this.onFrame = onFrame ?? null;
    this.spectatorWidth = spectatorWidth;
    this.spectatorHeight = spectatorHeight;
    this.virtualNowMs = 0;
    this.frameIndex = 0;
    this.capture = true;
    this.playerPos = { x: 0, y: 0, z: 0 };

    this.limbs = {
      head: this._makeLimbState(NOISE_AMPLITUDE_HEAD),
      left: this._makeLimbState(NOISE_AMPLITUDE_HAND),
      right: this._makeLimbState(NOISE_AMPLITUDE_HAND),
    };
  }

  _makeLimbState(noiseAmplitude) {
    return {
      pos: { x: 0, y: 0, z: 0 },
      renderPos: { x: 0, y: 0, z: 0 },
      quat: { ...IDENTITY_QUAT },
      motion: null,
      noiseFn: createNoiseChannel(this.rng, noiseAmplitude),
      noiseFrozen: false,
      holding: null,
      aimAtWorld: null,
      triggerValue: 0,
      squeezeValue: 0,
    };
  }

  // ---- setup -------------------------------------------------------

  // Pré-requisito: o chamador já rodou `page.clock.install({time:0})` LOGO
  // após o page.goto(), antes de qualquer código do jogo carregar (ver
  // record-demo.mjs). Isso importa de verdade: instalar o clock DEPOIS que
  // o jogo já criou objetos com THREE.Timer (game.js#timer e o
  // AudioListener interno do three.js, que também tem seu próprio Timer)
  // faz esses timers capturarem `_startTime` em tempo REAL; ao virar pra
  // fake time depois, o primeiro getDelta() pós-troca calcula um delta
  // gigante/negativo (fake_now - real_startTime), e no caso do
  // AudioListener isso quebra `linearRampToValueAtTime` com um tempo
  // negativo — exceção que propaga e trava o loop de frame do jogo inteiro
  // (confirmado rodando este script: teleporte nunca via isRayValid virar
  // true porque teleport.update() tinha parado de rodar). Instalando ANTES
  // de main.js carregar, todo THREE.Timer nasce já no eixo fake, sem
  // salto — e até aqui o clock só foi instalado (`install`), não pausado,
  // então ele flui em tempo real normalmente durante o boot da página
  // (harness ready, clique no VRButton, sessão XR começando), sem travar
  // nada que dependa de rAF/timers reais.
  async init() {
    // Congela o relógio um pouco à frente de "agora" — o colchão precisa
    // cobrir o round-trip real desta própria chamada (às vezes bem mais que
    // 50ms num Chromium headless), senão pauseAt() recebe um alvo que já
    // ficou no passado e falha com "Cannot fast-forward to the past". A
    // partir daqui, tempo só anda via runFor() (requisito 9), um frame de
    // cada vez.
    const PAUSE_BUFFER_MS = 1000;
    const nowMs = await this.page.evaluate(() => Date.now());
    await this.page.clock.pauseAt(nowMs + PAUSE_BUFFER_MS);
    this.virtualNowMs = nowMs + PAUSE_BUFFER_MS;

    this.playerPos = await this._getPlayerPos();

    const initial = await this.page.evaluate(() => {
      const d = window.__iwer.xrDevice;
      const v = (o) => ({ x: o.x, y: o.y, z: o.z });
      const q = (o) => ({ x: o.x, y: o.y, z: o.z, w: o.w });
      return {
        head: { pos: v(d.position), quat: q(d.quaternion) },
        left: { pos: v(d.controllers.left.position), quat: q(d.controllers.left.quaternion) },
        right: { pos: v(d.controllers.right.position), quat: q(d.controllers.right.quaternion) },
      };
    });
    for (const limb of ['head', 'left', 'right']) {
      this.limbs[limb].pos = addVec(initial[limb].pos, this.playerPos);
      this.limbs[limb].renderPos = { ...this.limbs[limb].pos };
      this.limbs[limb].quat = initial[limb].quat;
    }

    await this.page.evaluate(
      ({ width, height }) => window.__test.createSpectatorView({ width, height }),
      { width: this.spectatorWidth, height: this.spectatorHeight }
    );
  }

  async setSpectatorPose(position, lookAtTarget) {
    await this.page.evaluate(
      ({ position, lookAtTarget }) => window.__test.setSpectatorPose(position, lookAtTarget),
      { position, lookAtTarget }
    );
  }

  // ---- leitura da página (nunca cacheada além do necessário — ver nota
  // de topo sobre reler posição real após cada teleporte) ----------------

  async _getPlayerPos() {
    return this.page.evaluate(() => window.__test.getPlayerPos());
  }

  async _getMarkers() {
    return this.page.evaluate(() => window.__test.getMarkers());
  }

  async _isRayValid(hand) {
    return this.page.evaluate((h) => window.__test.isRayValid(h), hand);
  }

  // ---- laço de frame (requisitos 8/9) -----------------------------------

  async _advanceFrame() {
    const tSec = this.virtualNowMs / 1000;
    for (const limb of ['head', 'left', 'right']) this._updateLimbForFrame(limb, tSec);
    await this._applyPosesToPage();
    // runFor() é o `clock.tick()` do Playwright (nome próprio da API, ver
    // docs de page.clock) — avança o relógio fake e DISPARA os
    // requestAnimationFrame/timers já vencidos, incluindo o loop de frame
    // do IWER (XRSession.onDeviceFrame) e o animate() do jogo (que lê
    // performance.now(), também fake, via THREE.Timer — ver game.js).
    await this.page.clock.runFor(FRAME_MS);
    if (this.capture) await this._captureFrame();
    this.virtualNowMs += FRAME_MS;
    this.frameIndex += 1;
  }

  _updateLimbForFrame(limb, tSec) {
    const state = this.limbs[limb];
    if (state.motion) {
      const elapsed = this.virtualNowMs - state.motion.startMs;
      const done = elapsed >= state.motion.durationMs;
      const u = clamp(elapsed / state.motion.durationMs, 0, 1);
      if (state.motion.samplePos) state.pos = done ? { ...state.motion.finalPos } : state.motion.samplePos(u);
      if (state.motion.sampleQuat) state.quat = done ? { ...state.motion.finalQuat } : state.motion.sampleQuat(u);
      if (done) state.motion = null;
    } else if (limb !== 'head' && !state.holding && !state.aimAtWorld) {
      // (5) mão ociosa: descansa numa pose relativa à cabeça — segue direto
      // (sem easing extra), do mesmo jeito que utilityBelt.js já segue o
      // corpo a cada frame; o easing pra CHEGAR nessa pose já rolou em
      // _settleToRest() antes de cair neste ramo.
      state.pos = this.restPoseWorld(limb);
    }

    // (4) ruído contínuo — some do ponto BASE (state.pos), nunca é somado a
    // si mesmo entre frames, então não acumula deriva.
    const noise = state.noiseFrozen ? { x: 0, y: 0, z: 0 } : state.noiseFn(tSec);
    state.renderPos = addVec(state.pos, noise);

    if (limb !== 'head') {
      // Orientação da mão só importa pro raycast do teleporte (teleport.js
      // usa -Z local do controller) — fora disso o jogo só olha proximidade
      // de posição, então mantemos identidade.
      state.quat = state.aimAtWorld ? quatLookAt(state.renderPos, state.aimAtWorld) : { ...IDENTITY_QUAT };
    }
  }

  // Converte mundo->local DENTRO da página, lendo player.position ao vivo
  // (window.__iwerDebug.player), em vez de subtrair aqui no Node com um
  // this.playerPos cacheado. Isso importa especificamente durante um
  // teleporte: o clique que dispara o teleport.js roda DENTRO do mesmo
  // page.clock.runFor() que processa o frame, então o player pode já ter
  // se movido antes do Node ter qualquer chance de reler a posição — usar
  // sempre o valor ao vivo evita um "salto" de um frame com a mão/cabeça
  // convertidas contra o offset de jogador ERRADO (ver teleportTo).
  async _applyPosesToPage() {
    const payload = {
      head: { pos: this.limbs.head.renderPos, quat: this.limbs.head.quat },
      left: {
        pos: this.limbs.left.renderPos,
        quat: this.limbs.left.quat,
        trigger: this.limbs.left.triggerValue,
        squeeze: this.limbs.left.squeezeValue,
      },
      right: {
        pos: this.limbs.right.renderPos,
        quat: this.limbs.right.quat,
        trigger: this.limbs.right.triggerValue,
        squeeze: this.limbs.right.squeezeValue,
      },
    };
    await this.page.evaluate((p) => {
      const player = window.__iwerDebug.player.position;
      const toLocal = (w) => ({ x: w.x - player.x, y: w.y - player.y, z: w.z - player.z });
      const d = window.__iwer.xrDevice;
      const headLocal = toLocal(p.head.pos);
      d.position.set(headLocal.x, headLocal.y, headLocal.z);
      d.quaternion.set(p.head.quat.x, p.head.quat.y, p.head.quat.z, p.head.quat.w);
      for (const hand of ['left', 'right']) {
        const c = d.controllers[hand];
        const s = p[hand];
        const local = toLocal(s.pos);
        c.position.set(local.x, local.y, local.z);
        c.quaternion.set(s.quat.x, s.quat.y, s.quat.z, s.quat.w);
        c.updateButtonValue('trigger', s.trigger);
        c.updateButtonValue('squeeze', s.squeeze);
      }
    }, payload);
  }

  async _captureFrame() {
    if (!this.onFrame) return;
    // Best-effort: uma gravação de dezenas de milhares de frames não deve
    // abortar por causa de UM frame perdido (ex.: hiccup pontual do
    // WebGLRenderer espectador sob renderização por software) — loga uma
    // vez e segue sem esse frame, em vez de derrubar o roteiro inteiro.
    try {
      const dataUrl = await this.page.evaluate(() => window.__test.captureSpectatorFrame('image/jpeg', 0.85));
      await this.onFrame(dataUrl, this.frameIndex);
    } catch (err) {
      if (!this._captureWarned) {
        console.warn(`[HumanRig] falha ao capturar frame ${this.frameIndex} (seguindo sem ele): ${err.message}`);
        this._captureWarned = true;
      }
    }
  }

  // ---- helpers de espera -------------------------------------------------

  async _waitForMotionDone(limb) {
    while (this.limbs[limb].motion) await this._advanceFrame();
  }

  async _holdFor(seconds) {
    const target = this.virtualNowMs + seconds * 1000;
    while (this.virtualNowMs < target) await this._advanceFrame();
  }

  async _rampValue(limb, field, from, to, durationS) {
    const state = this.limbs[limb];
    const startMs = this.virtualNowMs;
    const endMs = startMs + durationS * 1000;
    state[field] = from;
    while (this.virtualNowMs < endMs) {
      const u = clamp((this.virtualNowMs - startMs) / (endMs - startMs), 0, 1);
      state[field] = from + (to - from) * u;
      await this._advanceFrame();
    }
    state[field] = to;
  }

  // ---- pose de descanso (requisito 5) -------------------------------------

  restPoseWorld(hand) {
    const head = this.limbs.head;
    const yaw = yawOnlyQuat(head.quat);
    const offset = applyQuatToVec(yaw, REST_POSE_LOCAL[hand]);
    return addVec(head.pos, offset);
  }

  async _settleToRest(hand) {
    const state = this.limbs[hand];
    state.aimAtWorld = null;
    const target = this.restPoseWorld(hand);
    if (distance(state.pos, target) < 0.01) return;
    const duration = this.rng.jitter(clamp(BASE_MOVE_S * 0.6 + distance(state.pos, target) * PER_METER_S, MIN_MOVE_S, MAX_MOVE_S), 0.15);
    const arc = buildArcPath(state.pos, target, this.rng);
    state.motion = {
      startMs: this.virtualNowMs,
      durationMs: duration * 1000,
      samplePos: (u) => positionOnArc(arc, u),
      finalPos: target,
    };
    await this._waitForMotionDone(hand);
  }

  // ---- (3) cabeça antecipando o alvo da mão -------------------------------

  _scheduleGazeLead(worldTarget, handArrivalSec) {
    const now = this.virtualNowMs / 1000;
    const headArrival = handArrivalSec - GAZE_LEAD_S;
    const duration = Math.max(MIN_HEAD_DURATION_S, headArrival - now);
    const fromQuat = { ...this.limbs.head.quat };
    const toQuat = quatLookAt(this.limbs.head.pos, worldTarget);
    this.limbs.head.motion = {
      startMs: this.virtualNowMs,
      durationMs: duration * 1000,
      sampleQuat: (u) => quatSlerp(fromQuat, toQuat, minimumJerk(u)),
      finalQuat: toQuat,
    };
  }

  // ---- ações de alto nível -------------------------------------------------

  // "olhar para Y" — sem mão envolvida (ex.: enquadrar antes de entrar no
  // modo de desarme). Usa a duração cheia (sem o adiantamento de 250ms, que
  // só faz sentido quando existe uma mão-alvo pra anteceder).
  async lookAt(worldTarget) {
    const dist = distance(this.limbs.head.pos, worldTarget);
    const duration = this.rng.jitter(clamp(BASE_MOVE_S + dist * 0.15, MIN_HEAD_DURATION_S, 1.2), 0.15);
    const fromQuat = { ...this.limbs.head.quat };
    const toQuat = quatLookAt(this.limbs.head.pos, worldTarget);
    this.limbs.head.motion = {
      startMs: this.virtualNowMs,
      durationMs: duration * 1000,
      sampleQuat: (u) => quatSlerp(fromQuat, toQuat, minimumJerk(u)),
      finalQuat: toQuat,
    };
    await this._waitForMotionDone('head');
  }

  // "apontar para X" — alcance da mão em arco + a cabeça antecipando
  // (requisitos 1/2/3).
  async pointAt(hand, worldTarget) {
    const state = this.limbs[hand];
    state.aimAtWorld = null;
    const start = { ...state.pos };
    const dist = distance(start, worldTarget);
    const duration = this.rng.jitter(clamp(BASE_MOVE_S + dist * PER_METER_S, MIN_MOVE_S, MAX_MOVE_S), 0.15);
    const arc = buildArcPath(start, worldTarget, this.rng);
    const startMs = this.virtualNowMs;
    state.motion = {
      startMs,
      durationMs: duration * 1000,
      samplePos: (u) => positionOnArc(arc, u),
      finalPos: { ...worldTarget },
    };
    this._scheduleGazeLead(worldTarget, startMs / 1000 + duration);
    await this._waitForMotionDone(hand);
  }

  // "clicar" — trigger/botão: pausa, rampa de subida, dwell, rampa de
  // descida, pausa (requisito 6), com ruído congelado durante toda a janela
  // pra não desalinhar a mão de um alvo com tolerância apertada (ex.: fio,
  // 2.2cm — ver rearPanelModule/wireCuttingModule no jogo real). Se
  // `opts.readTip` for passado (alicate/chave de fenda), faz UMA correção
  // fina de ponta depois de já estar parado e sem ruído — mesma técnica de
  // duas leituras do script antigo (alignTip), só que sem precisar de
  // round-trips extras porque a mão já está imóvel.
  async click(hand, worldTarget, opts = {}) {
    await this.pointAt(hand, worldTarget);
    const state = this.limbs[hand];
    state.noiseFrozen = true;
    await this._holdFor(this.rng.jitter(CLICK_PAUSE_BEFORE_S, 0.15));
    if (opts.readTip) {
      const tip = await opts.readTip(this.page);
      state.pos = addVec(worldTarget, subVec(worldTarget, tip));
      await this._holdFor(0.05);
    }
    await this._rampValue(hand, 'triggerValue', 0, 1, CLICK_RAMP_S);
    await this._holdFor(0.03);
    await this._rampValue(hand, 'triggerValue', 1, 0, CLICK_RAMP_S);
    state.noiseFrozen = false;
    await this._holdFor(this.rng.jitter(CLICK_PAUSE_AFTER_S, 0.15));
  }

  async clickRepeat(hand, worldTarget, times, opts = {}) {
    for (let i = 0; i < times; i++) await this.click(hand, worldTarget, opts);
  }

  async grab(hand, worldTarget, tag = 'object') {
    await this.pointAt(hand, worldTarget);
    await this._holdFor(this.rng.jitter(0.15, 0.2));
    await this._rampValue(hand, 'squeezeValue', 0, 1, GRIP_RAMP_S);
    this.limbs[hand].holding = tag;
  }

  async release(hand) {
    await this._rampValue(hand, 'squeezeValue', 1, 0, GRIP_RAMP_S);
    this.limbs[hand].holding = null;
    await this._settleToRest(hand);
  }

  // Arremesso: solta o squeeze NO MEIO do arco (velocidade alta o
  // suficiente pra grab.js reconhecer como arremesso, ver
  // game-3d/src/grab.js — limiar real de 0.5 m/s), mão continua o
  // movimento até o fim (acompanhamento/follow-through).
  async throwTo(hand, worldTarget, { releaseAt = 0.55 } = {}) {
    const state = this.limbs[hand];
    state.aimAtWorld = null;
    const start = { ...state.pos };
    const dist = distance(start, worldTarget);
    const duration = this.rng.jitter(clamp(BASE_MOVE_S + dist * PER_METER_S * 0.6, 0.25, 0.6), 0.15);
    const arc = buildArcPath(start, worldTarget, this.rng, { archRatio: 0.12, overshootRatio: 0.1 });
    const startMs = this.virtualNowMs;
    state.motion = {
      startMs,
      durationMs: duration * 1000,
      samplePos: (u) => positionOnArc(arc, u),
      finalPos: { ...worldTarget },
    };
    this._scheduleGazeLead(worldTarget, startMs / 1000 + duration);
    let released = false;
    while (state.motion) {
      const u = (this.virtualNowMs - startMs) / (duration * 1000);
      if (!released && u >= releaseAt) {
        released = true;
        await this._rampValue(hand, 'squeezeValue', state.squeezeValue, 0, THROW_RELEASE_RAMP_S);
      } else {
        await this._advanceFrame();
      }
    }
    state.holding = null;
    await this._settleToRest(hand);
  }

  async wait(seconds) {
    await this._holdFor(seconds);
  }

  // Alavancas físicas (dispenser/purga, ver game-3d/src/leverSwitch.js) —
  // mecanismo à parte de trigger/squeeze: proximidade da ponta + puxão
  // vertical (0.15m pra baixo a partir do primeiro contato, depois volta
  // quase até o topo pra "resetar" antes do próximo puxão, se
  // `pulls` > 1 — mesmos limiares medidos em leverSwitch.js, com folga).
  async pullLever(hand, handleWorldPos, { pulls = 1 } = {}) {
    await this.pointAt(hand, handleWorldPos);
    const state = this.limbs[hand];
    for (let i = 0; i < pulls; i++) {
      await this._holdFor(this.rng.jitter(0.15, 0.2));
      const down = { x: handleWorldPos.x, y: handleWorldPos.y - 0.22, z: handleWorldPos.z };
      const downDuration = this.rng.jitter(0.35, 0.15);
      const downArc = buildArcPath(state.pos, down, this.rng, { archRatio: 0.04, overshootRatio: 0.02 });
      state.motion = {
        startMs: this.virtualNowMs,
        durationMs: downDuration * 1000,
        samplePos: (u) => positionOnArc(downArc, u),
        finalPos: down,
      };
      await this._waitForMotionDone(hand);
      await this._holdFor(this.rng.jitter(0.12, 0.2));
      const upDuration = this.rng.jitter(0.3, 0.15);
      const upArc = buildArcPath(state.pos, handleWorldPos, this.rng, { archRatio: 0.04, overshootRatio: 0.02 });
      state.motion = {
        startMs: this.virtualNowMs,
        durationMs: upDuration * 1000,
        samplePos: (u) => positionOnArc(upArc, u),
        finalPos: { ...handleWorldPos },
      };
      await this._waitForMotionDone(hand);
    }
  }

  // ---- teleporte (requisitos 10/11) --------------------------------------

  // Posição de "mira" da mão: braço estendido na direção XZ do marcador, na
  // altura do peito — a mão NUNCA anda até o marcador em si (que normalmente
  // está no chão, a metros de distância); só a ORIENTAÇÃO (recalculada a
  // cada frame a partir da posição atual da mão, ver _updateLimbForFrame)
  // converge pra apontar o raio pro centro do disco.
  _computeAimHandPosition(hand, headPos, markerWorldXZ) {
    let dir = normalizeVec({ x: markerWorldXZ.x - headPos.x, y: 0, z: markerWorldXZ.z - headPos.z });
    if (!Number.isFinite(dir.x) || (dir.x === 0 && dir.z === 0)) dir = { x: 0, y: 0, z: -1 };
    const armLength = 0.45;
    let perp = crossVec({ x: 0, y: 1, z: 0 }, dir);
    if (distance(perp, { x: 0, y: 0, z: 0 }) < 1e-4) perp = { x: 1, y: 0, z: 0 };
    perp = normalizeVec(perp);
    const sideSign = hand === 'right' ? 1 : -1;
    const base = addVec(headPos, scaleVec(dir, armLength));
    const withSide = addVec(base, scaleVec(perp, sideSign * 0.15));
    return { x: withSide.x, y: headPos.y - 0.25, z: withSide.z };
  }

  async teleportTo(id) {
    const markers = await this._getMarkers();
    const marker = markers.find((m) => m.id === id);
    if (!marker) {
      throw new Error(`teleportTo: marcador desconhecido "${id}". Disponíveis: ${markers.map((m) => m.id).join(', ')}`);
    }
    const safeMarkerXZ = clampToRoom(marker); // requisito 10: clamp ao polígono da sala com margem de 40cm
    const markerWorld = { x: safeMarkerXZ.x, y: 0.01, z: safeMarkerXZ.z };

    // Requisito 10: recomputa tudo a partir da posição REAL atual do
    // jogador, nunca de um valor acumulado localmente entre teleportes.
    this.playerPos = await this._getPlayerPos();
    if (distanceXZ(this.playerPos, markerWorld) < ALREADY_THERE_EPS_M) {
      throw new Error(`teleportTo: jogador já está no marcador "${id}" (playerPos=${fmt(this.playerPos)})`);
    }

    // O disco de teleporte é um ANEL (RingGeometry, raio interno
    // 0.7×radius), não um disco cheio — mirar o centro exato cairia no
    // "buraco" do meio e NUNCA registraria hit no raycast de teleport.js.
    // Mira um ponto sobre o próprio anel, do lado voltado pro jogador (a
    // borda mais natural de apontar, e a que fica mais perto da mão).
    const dirPlayerToMarker = normalizeVec({
      x: markerWorld.x - this.playerPos.x,
      y: 0,
      z: markerWorld.z - this.playerPos.z,
    });
    const ringHitRadius = marker.radius * 0.85;
    const aimAtWorld = subVec(markerWorld, scaleVec(dirPlayerToMarker, ringHitRadius));

    const hand = 'right';
    const state = this.limbs[hand];

    // (3) cabeça vira 250ms antes; (2) mão em arco.
    const aimPos = this._computeAimHandPosition(hand, this.limbs.head.pos, markerWorld);
    const start = { ...state.pos };
    const dist = distance(start, aimPos);
    const duration = this.rng.jitter(clamp(BASE_MOVE_S + dist * PER_METER_S, MIN_MOVE_S, MAX_MOVE_S), 0.15);
    const arc = buildArcPath(start, aimPos, this.rng);
    const startMs = this.virtualNowMs;
    state.aimAtWorld = aimAtWorld;
    state.motion = {
      startMs,
      durationMs: duration * 1000,
      samplePos: (u) => positionOnArc(arc, u),
      finalPos: aimPos,
    };
    this._scheduleGazeLead(markerWorld, startMs / 1000 + duration);
    await this._waitForMotionDone(hand);

    const basePos = { ...state.pos };

    // (11) desliga o ruído nos últimos instantes antes do clique — mão
    // precisa ficar estável pra manter o raio em cima do marcador.
    state.noiseFrozen = true;

    // Aguarda isRayValid ficar verdadeiro, com pequenos ajustes em espiral
    // se a mira inicial não caiu exatamente sobre o disco (timeout 1s).
    const deadlineMs = this.virtualNowMs + RAY_VALID_TIMEOUT_MS;
    let hit = await this._isRayValid(hand);
    let spiralStep = 0;
    while (hit !== id && this.virtualNowMs < deadlineMs) {
      spiralStep += 1;
      const angle = spiralStep * 2.4; // espiral áurea, cobre direções sem repetir
      const radius = Math.min(0.03 * spiralStep, 0.18);
      state.pos = {
        x: basePos.x + Math.cos(angle) * radius,
        y: basePos.y + Math.sin(angle * 0.5) * radius * 0.4,
        z: basePos.z + Math.sin(angle) * radius,
      };
      await this._advanceFrame();
      hit = await this._isRayValid(hand);
    }
    if (hit !== id) {
      state.noiseFrozen = false;
      throw new Error(
        `teleportTo("${id}"): raio não ficou válido em ${RAY_VALID_TIMEOUT_MS}ms mesmo após ajuste em espiral. ` +
          `mão=${fmt(state.pos)} último isRayValid=${hit ?? 'null'}`
      );
    }

    // (11) pausa 300-500ms antes de clicar.
    await this._holdFor(this.rng.next() * 0.2 + 0.3);

    // (6)/(11) rampa de 100ms, mão imóvel, confirma isRayValid no instante
    // exato do clique.
    await this._rampValue(hand, 'triggerValue', 0, 1, CLICK_RAMP_S);
    const hitAtClick = await this._isRayValid(hand);
    if (hitAtClick !== id) {
      await this._rampValue(hand, 'triggerValue', 1, 0, CLICK_RAMP_S);
      state.noiseFrozen = false;
      throw new Error(
        `teleportTo("${id}"): raio saiu do marcador exatamente no instante do clique ` +
          `(isRayValid=${hitAtClick ?? 'null'}). mão=${fmt(state.pos)}`
      );
    }
    await this._holdFor(0.03);
    await this._rampValue(hand, 'triggerValue', 1, 0, CLICK_RAMP_S);
    state.noiseFrozen = false;

    // Aguarda o teleporte assentar antes de qualquer nova ação.
    await this._holdFor(0.1);

    // Verifica a posição REAL final (nunca assume a partir do marcador).
    const finalPos = await this._getPlayerPos();
    this.playerPos = finalPos;
    const drift = distanceXZ(finalPos, markerWorld);
    if (drift > TELEPORT_TOLERANCE_M) {
      const finalRay = await this._isRayValid(hand);
      throw new Error(
        `teleportTo("${id}") falhou: jogador ficou a ${drift.toFixed(3)}m do marcador ` +
          `(tolerância ${TELEPORT_TOLERANCE_M}m). marker=${fmt(markerWorld)} playerPos=${fmt(finalPos)} ` +
          `isRayValid=${finalRay ?? 'null'}`
      );
    }

    await this._settleToRest(hand);
  }
}
