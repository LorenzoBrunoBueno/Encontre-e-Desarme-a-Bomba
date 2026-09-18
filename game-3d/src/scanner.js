import * as THREE from 'three';
import { createPamphlet } from './pamphlet.js';
import { createTextPanel } from './textPanel.js';

const SLOT_RADIUS = 0.35;
const SCAN_DURATION = 5;
const BLINK_SPEED = 8;
// Crise de superaquecimento (documento de especificação, Estação 2): a cada
// N bombas escaneadas com sucesso, o scanner trava até o jogador purgar na
// alavanca central (game.js cria essa alavanca e chama purgeOverheat()).
// Fallback caso `overheatInterval` não seja passado (ex.: testes isolados);
// o valor "de verdade" vem de game-3d/src/difficulty.js por fase.
const DEFAULT_OVERHEAT_INTERVAL = 3;

// Scanner: o jogador só precisa ENCOSTAR a bomba no slot — a inserção sozinha
// já dispara o scan (mecânica ativa, sem botão), com uma barra de progresso
// real ao longo de SCAN_DURATION. Ao final, ejeta um panfleto anexado à
// bomba (pamphlet.js) e atualiza o holograma de apoio no teto
// (hologramDisplay.js, passado via `hologram` — complementa o panfleto, não
// o substitui). A cada OVERHEAT_INTERVAL scans, o scanner superaquece e
// recusa novas bombas até ser purgado.
export function createScanner({
  scene,
  position,
  rotationY = 0,
  grabSystem,
  onScanned,
  hologram,
  overheatInterval = DEFAULT_OVERHEAT_INTERVAL,
  sfx,
}) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  scene.add(group);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.9, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.5, metalness: 0.3 })
  );
  body.position.y = 0.45;
  group.add(body);

  // Pés — separa visualmente o console do chão, evita leitura de "bloco
  // pousado direto no piso".
  const footGeometry = new THREE.CylinderGeometry(0.05, 0.06, 0.06, 12);
  const footMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.6, metalness: 0.2 });
  [-1, 1].forEach((sx) => {
    [-1, 1].forEach((sz) => {
      const foot = new THREE.Mesh(footGeometry, footMaterial);
      foot.position.set(sx * 0.28, 0.03, sz * 0.18);
      group.add(foot);
    });
  });

  // Grelhas de ventilação na face frontal — greeble barato via caixas finas.
  const ventMaterial = new THREE.MeshStandardMaterial({ color: 0x1c2226, roughness: 0.8, metalness: 0.1 });
  const ventGeometry = new THREE.BoxGeometry(0.36, 0.012, 0.006);
  for (let i = 0; i < 4; i++) {
    const vent = new THREE.Mesh(ventGeometry, ventMaterial);
    vent.position.set(0, 0.62 - i * 0.03, 0.253);
    group.add(vent);
  }

  const slot = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.06, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.6, metalness: 0.2 })
  );
  slot.position.set(0, 0.92, 0);
  group.add(slot);

  // Moldura da janela de scan — dá a leitura de "câmara/abertura" ao redor
  // do slot onde a bomba é inserida.
  const rimMaterial = new THREE.MeshStandardMaterial({ color: 0x11151a, roughness: 0.5, metalness: 0.4 });
  const rimSideGeometry = new THREE.BoxGeometry(0.54, 0.015, 0.02);
  const rimEndGeometry = new THREE.BoxGeometry(0.02, 0.015, 0.39);
  [-1, 1].forEach((sz) => {
    const rim = new THREE.Mesh(rimSideGeometry, rimMaterial);
    rim.position.set(0, 0.955, sz * 0.185);
    group.add(rim);
  });
  [-1, 1].forEach((sx) => {
    const rim = new THREE.Mesh(rimEndGeometry, rimMaterial);
    rim.position.set(sx * 0.26, 0.955, 0);
    group.add(rim);
  });

  // Painel de status — texto grande via canvas (mesma técnica do panfleto),
  // mostra o estado atual do scanner para quem está de longe.
  const statusPanel = createTextPanel({ width: 0.3, height: 0.1, fontSize: 34 });
  statusPanel.mesh.position.set(0, 0.68, 0.251);
  statusPanel.setText('PRONTO', '#33ff66', '#111111');
  group.add(statusPanel.mesh);

  // Barra de progresso real do scan — trilho fixo + preenchimento que cresce
  // da esquerda pra direita (geometria com pivô na borda esquerda, mesma
  // técnica de `geometry.translate` já usada em bomb.js pro corpo da bomba).
  const PROGRESS_WIDTH = 0.32;
  const PROGRESS_HEIGHT = 0.025;
  const progressTrack = new THREE.Mesh(
    new THREE.BoxGeometry(PROGRESS_WIDTH, PROGRESS_HEIGHT, 0.008),
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 })
  );
  progressTrack.position.set(0, 0.6, 0.251);
  group.add(progressTrack);

  const progressFillGeometry = new THREE.BoxGeometry(PROGRESS_WIDTH, PROGRESS_HEIGHT, 0.01);
  progressFillGeometry.translate(PROGRESS_WIDTH / 2, 0, 0);
  const progressFill = new THREE.Mesh(
    progressFillGeometry,
    new THREE.MeshBasicMaterial({ color: 0x33ff66 })
  );
  progressFill.position.set(-PROGRESS_WIDTH / 2, 0.6, 0.2515);
  progressFill.scale.x = 0;
  group.add(progressFill);

  // Luz de aviso de superaquecimento — pisca no topo do console enquanto
  // `overheated` estiver ativo.
  const overheatLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xff2222, emissiveIntensity: 0 })
  );
  overheatLight.position.set(0.28, 0.85, 0.25);
  group.add(overheatLight);

  let scanning = false;
  let scanTimer = 0;
  let currentBomb = null;
  let blinkPhase = 0;
  let scansCompleted = 0;
  let overheated = false;

  function slotWorldPosition() {
    const p = new THREE.Vector3();
    slot.getWorldPosition(p);
    return p;
  }

  function findBombInSlot(bombs) {
    const slotPos = slotWorldPosition();
    return bombs.find((bomb) => {
      if (bomb.delivered) return false;
      if (grabSystem.isHeld(bomb.group)) return false;
      const bombPos = new THREE.Vector3();
      bomb.group.getWorldPosition(bombPos);
      return bombPos.distanceTo(slotPos) <= SLOT_RADIUS;
    });
  }

  function startScan(bomb) {
    scanning = true;
    scanTimer = SCAN_DURATION;
    currentBomb = bomb;
    progressFill.scale.x = 0;
    statusPanel.setText('ESCANEANDO...', '#ffcc33', '#111111');
  }

  function finishScan() {
    scanning = false;
    progressFill.scale.x = 0;
    sfx?.playScanDone();
    if (currentBomb && !currentBomb.hasPamphlet) {
      const pamphlet = createPamphlet(currentBomb);
      pamphlet.group.position.set(0.18, 0.05, 0);
      currentBomb.group.add(pamphlet.group);
      grabSystem.register(pamphlet.group);
      currentBomb.pamphletGroup = pamphlet.group;
      currentBomb.markScanned();
      onScanned?.(currentBomb.id);
      hologram?.showBomb(currentBomb);

      scansCompleted += 1;
      if (scansCompleted % overheatInterval === 0) {
        overheated = true;
      }
    }
    currentBomb = null;
    statusPanel.setText(
      overheated ? ['SUPERAQUECIDO', 'PURGUE NO CENTRO'] : 'PRONTO',
      overheated ? '#ff3333' : '#33ff66',
      '#111111'
    );
  }

  // Chamado pela alavanca de purga central (game.js) ao completar os 3
  // puxões — não precisa zerar `scansCompleted`: usando módulo, o próximo
  // superaquecimento naturalmente só volta a acontecer depois de mais
  // OVERHEAT_INTERVAL scans a partir daqui.
  function purgeOverheat() {
    overheated = false;
    statusPanel.setText('PRONTO', '#33ff66', '#111111');
  }

  function update(dt, tipPositions, bombs) {
    if (overheated) {
      blinkPhase += dt * BLINK_SPEED;
      overheatLight.material.emissiveIntensity = 0.5 + 0.5 * Math.sin(blinkPhase);
      return;
    }
    overheatLight.material.emissiveIntensity = 0;

    if (scanning) {
      scanTimer -= dt;
      progressFill.scale.x = THREE.MathUtils.clamp(1 - scanTimer / SCAN_DURATION, 0, 1);
      if (scanTimer <= 0) finishScan();
      return;
    }

    const bomb = findBombInSlot(bombs);
    if (bomb && !bomb.scanned) startScan(bomb);
  }

  // Reinicia o scanner pra uma nova rodada em memória (game.js#resetRound,
  // loop contínuo entre fases — ver game-3d/instrucao.md): sem isso,
  // `currentBomb` continuaria apontando pra uma bomba já descartada
  // (dispose()) da rodada anterior se o timer zerasse no meio de um scan.
  function reset() {
    scanning = false;
    currentBomb = null;
    progressFill.scale.x = 0;
    scansCompleted = 0;
    overheated = false;
    overheatLight.material.emissiveIntensity = 0;
    blinkPhase = 0;
    statusPanel.setText('PRONTO', '#33ff66', '#111111');
  }

  return {
    group,
    update,
    purgeOverheat,
    reset,
    // Usado pelo tutorial guiado da primeira bomba (game.js#showTutorialStep)
    // pra apontar a seta exatamente no slot, não no console inteiro.
    getSlotPosition: slotWorldPosition,
  };
}
