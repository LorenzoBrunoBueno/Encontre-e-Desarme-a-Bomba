import * as THREE from 'three';
import { pulseHaptic } from './haptics.js';

const SCREW_RADIUS = 0.014;
const SCREW_HEIGHT = 0.016;
const SCREW_TOUCH_RADIUS = 0.05;
const SCREW_INSET = 0.05;
// Mesma técnica de "inverted hull" do fio/botão (wireCuttingModule.js/
// buttonChoiceModule.js): casca branca renderizada por dentro (BackSide),
// maior que o parafuso, só visível no parafuso mais perto da ponta da
// chave de fenda — ANTES não existia nenhum indicador aqui, era o único
// módulo sem destaque de "isso aqui é o que você está tocando".
const OUTLINE_SCALE = 1.6;
// Cada giro completo empurra o parafuso mais pra fora (mesma lógica visual
// do botão afundando ao ser apertado, só que na direção contrária — o
// parafuso "sai" em vez de "afundar") — feedback de progresso sem precisar
// de HUD/texto, visível mesmo de relance.
const POP_PER_TURN = 0.006;
// Cada "turno" é: capturar a orientação do controller quando a chave de
// fenda encosta no parafuso, e contar 1 turno quando ela se afasta dessa
// orientação inicial por mais de TURN_ANGLE_THRESHOLD radianos (em qualquer
// direção) — evita ter que isolar o eixo de "roll" de um delta de quaternion
// (frágil), e deixa o jogador girar o pulso pra lá e pra cá em vários
// movimentos curtos em vez de exigir uma volta contínua.
const TURN_ANGLE_THRESHOLD = 2.0; // ~115°
const TURNS_TO_REMOVE = 3;

// Medidas do corpo da bomba — duplicadas de bomb.js por simplicidade (não
// existe módulo de constantes compartilhadas no projeto); ajustar os dois
// juntos se o tamanho do corpo mudar.
const BODY_WIDTH = 0.56;
const BODY_DEPTH = 0.56;
const BODY_HEIGHT = 0.18;

const SCREW_OFFSETS = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
].map(([sx, sz]) => ({
  x: sx * (BODY_WIDTH / 2 - SCREW_INSET),
  z: sz * (BODY_DEPTH / 2 - SCREW_INSET),
}));

// Etapa traseira (documento de especificação, Estação 3): 4 parafusos na
// face de BAIXO do corpo da bomba — só ficam alcançáveis depois que o
// jogador vira a bomba fisicamente na mesa (defuseTable.js gira
// bomb.group.rotation.x em 180°, ver botão de rotação). A rotação de
// verdade já esconde os módulos frontais (viram pra dentro da mesa) e expõe
// esta face, sem precisar de nenhum toggle manual de visibilidade — é só
// geometria rígida girando junto com o resto da bomba.
//
// NÃO conta para bomb.isFullyCorrect() — é tarefa física extra, o documento
// de especificação não liga pontuação a ela.
export function createRearPanelModule() {
  const group = new THREE.Group();
  const screwMaterial = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.4, metalness: 0.7 });

  const screws = SCREW_OFFSETS.map(({ x, z }) => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(SCREW_RADIUS, SCREW_RADIUS, SCREW_HEIGHT, 8),
      screwMaterial
    );
    // Protrai PRA FORA da superfície do corpo (-BODY_HEIGHT/2), não pra
    // dentro dela — com "+ SCREW_HEIGHT/2" o parafuso ficava embutido no
    // corpo, com só a tampa da rosca coplanar à superfície, e a `cover`
    // (mais abaixo) se estende ainda mais pra fora que isso, ocultando o
    // parafuso inteiro por trás dela. Achado do playtest: os parafusos
    // simplesmente não apareciam depois de girar a bomba.
    const restY = -BODY_HEIGHT / 2 - SCREW_HEIGHT / 2;
    mesh.position.set(x, restY, z);
    group.add(mesh);

    // Filho do parafuso — acompanha a posição dele automaticamente,
    // inclusive quando ele "sai" um pouco a cada giro (ver POP_PER_TURN).
    const outline = new THREE.Mesh(
      new THREE.CylinderGeometry(
        SCREW_RADIUS * OUTLINE_SCALE,
        SCREW_RADIUS * OUTLINE_SCALE,
        SCREW_HEIGHT,
        8
      ),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide })
    );
    outline.visible = false;
    mesh.add(outline);

    return { mesh, outline, restY, removed: false, turnsCompleted: 0, engaged: false, startQuaternion: null };
  });

  let hoveredScrew = null;

  function setHover(screw) {
    if (hoveredScrew === screw) return;
    if (hoveredScrew) hoveredScrew.outline.visible = false;
    hoveredScrew = screw;
    if (hoveredScrew) hoveredScrew.outline.visible = true;
  }

  const cover = new THREE.Mesh(
    new THREE.BoxGeometry(BODY_WIDTH - 0.1, 0.015, BODY_DEPTH - 0.1),
    new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.7, metalness: 0.1 })
  );
  cover.position.set(0, -BODY_HEIGHT / 2 - 0.001, 0);
  group.add(cover);

  // Núcleo/bateria volátil — só fica visível (e pegável, via
  // defuseTable.js#update que registra no grabSystem ao ver `coverOpen`
  // virar true) depois que a tampa abre.
  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.09, 16),
    new THREE.MeshStandardMaterial({
      color: 0x33ddaa,
      roughness: 0.3,
      metalness: 0.4,
      emissive: 0x117755,
      emissiveIntensity: 0.4,
    })
  );
  core.position.set(0, -BODY_HEIGHT / 2 - 0.05, 0);
  core.visible = false;
  group.add(core);

  let coverOpen = false;
  // Controller que segura a chave de fenda no frame mais recente (null se
  // ninguém segura) — cacheado aqui só pra handleTrigger() poder dar
  // haptics sem precisar receber esse argumento de novo (o evento de
  // gatilho que chama handleTrigger não carrega esse dado).
  let lastScrewdriverController = null;

  function allScrewsRemoved() {
    return screws.every((screw) => screw.removed);
  }

  function checkCoverOpen() {
    if (allScrewsRemoved()) {
      coverOpen = true;
      cover.visible = false;
      core.visible = true;
    }
  }

  // Conta 1 giro em `screw` — chamado tanto pelo gesto de rotação de pulso
  // (update(), abaixo) quanto pelo gatilho (handleTrigger(), atalho pra
  // testar sem precisar girar o controller de verdade — ver
  // game-3d/instrucao.md). Mesmo efeito nos dois casos: empurra o parafuso
  // pra fora (feedback de progresso) e dá haptics.
  function completeTurn(screw, screwdriverController) {
    screw.turnsCompleted += 1;
    screw.mesh.position.y = screw.restY - POP_PER_TURN * screw.turnsCompleted;
    if (screw.turnsCompleted >= TURNS_TO_REMOVE) {
      screw.removed = true;
      screw.mesh.visible = false;
      pulseHaptic(screwdriverController, 0.4, 50);
    } else {
      pulseHaptic(screwdriverController, 0.25, 30);
    }
    checkCoverOpen();
  }

  // screwdriverTip/screwdriverQuaternion vêm de defuseTable.js — ambos null
  // quando a chave de fenda não está na mão (ver grabSystem.isHeld/
  // getHoldingController). screwdriverController é o mesmo objeto, só que
  // usado pra haptics (pulseHaptic aceita null/undefined sem erro).
  function update(dt, screwdriverTip, screwdriverQuaternion, screwdriverController) {
    lastScrewdriverController = screwdriverController;
    if (coverOpen) return;

    // Só um parafuso destacado por vez — o que estiver no alcance da ponta
    // (mesmo padrão de "seleção sempre clara" do fio/botão). handleTrigger()
    // abaixo age exatamente sobre esse mesmo parafuso destacado.
    let nearestInRange = null;

    screws.forEach((screw) => {
      if (screw.removed) return;

      let inRange = false;
      if (screwdriverTip) {
        const screwPos = new THREE.Vector3();
        screw.mesh.getWorldPosition(screwPos);
        inRange = screwPos.distanceTo(screwdriverTip) <= SCREW_TOUCH_RADIUS;
      }

      if (inRange) nearestInRange = screw;

      // Perder o alcance por um instante NÃO reseta o giro em andamento —
      // só ignora o parafuso neste frame, mantendo `engaged`/
      // `startQuaternion` como estavam. O único jeito de perder o
      // progresso de verdade é o jogador tirar a bomba da mesa (ver
      // resetProgress(), chamado por defuseTable.js#exitMode).
      if (!inRange) return;

      if (!screw.engaged) {
        screw.engaged = true;
        screw.startQuaternion = screwdriverQuaternion.clone();
        return;
      }

      const angle = screw.startQuaternion.angleTo(screwdriverQuaternion);
      if (angle >= TURN_ANGLE_THRESHOLD) {
        screw.startQuaternion = screwdriverQuaternion.clone();
        completeTurn(screw, screwdriverController);
      }
    });

    setHover(nearestInRange);
  }

  // Atalho por gatilho: conta 1 giro no parafuso atualmente destacado (ver
  // `nearestInRange`/setHover em update()), sem precisar girar o pulso de
  // verdade — pensado pra testar no navegador/mouse, onde simular rotação
  // do controller não é natural. Continua funcionando junto com o gesto de
  // girar o pulso (qualquer um dos dois conta): decisão do usuário, ver
  // game-3d/instrucao.md. No-op se não há parafuso destacado (chave de fenda
  // fora de alcance ou não está na mão) ou se a etapa já terminou.
  function handleTrigger() {
    if (coverOpen || !hoveredScrew) return;
    completeTurn(hoveredScrew, lastScrewdriverController);
  }

  // Chamado por defuseTable.js#exitMode quando o jogador tira a bomba da
  // mesa — única forma de perder o progresso dos parafusos (perder o
  // alcance da chave de fenda momentaneamente NÃO reseta nada, ver update()
  // acima). No-op se a tampa já abriu: a etapa está concluída (núcleo
  // exposto/já retirado), não há progresso de parafuso a perder.
  function resetProgress() {
    if (coverOpen) return;
    screws.forEach((screw) => {
      screw.removed = false;
      screw.turnsCompleted = 0;
      screw.engaged = false;
      screw.startQuaternion = null;
      screw.mesh.visible = true;
      screw.mesh.position.y = screw.restY;
    });
    setHover(null);
  }

  // NÃO descarta a geometria/material do núcleo (`core`) aqui: uma vez
  // exposto, ele pode ter sido separado da bomba (pego e carregado pra
  // outro lugar, ver defuseTable.js#update) e continuar vivo na cena depois
  // que esta bomba já foi entregue/descartada — mesmo padrão já usado pelo
  // panfleto (pamphlet.js), que também nunca é descartado por bomb.dispose().
  function dispose() {
    screws.forEach((screw) => {
      screw.mesh.geometry.dispose();
      screw.outline.geometry.dispose();
      screw.outline.material.dispose();
    });
    screwMaterial.dispose();
    cover.geometry.dispose();
    cover.material.dispose();
  }

  return {
    group,
    update,
    handleTrigger,
    resetProgress,
    dispose,
    get coverOpen() {
      return coverOpen;
    },
    get coreObject() {
      return core;
    },
  };
}
