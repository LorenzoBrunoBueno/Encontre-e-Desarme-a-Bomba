import * as THREE from 'three';

const SCREW_RADIUS = 0.014;
const SCREW_HEIGHT = 0.016;
const SCREW_TOUCH_RADIUS = 0.05;
const SCREW_INSET = 0.05;
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
    mesh.position.set(x, -BODY_HEIGHT / 2 + SCREW_HEIGHT / 2, z);
    group.add(mesh);
    return { mesh, removed: false, turnsCompleted: 0, engaged: false, startQuaternion: null };
  });

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

  function allScrewsRemoved() {
    return screws.every((screw) => screw.removed);
  }

  // screwdriverTip/screwdriverQuaternion vêm de defuseTable.js — ambos null
  // quando a chave de fenda não está na mão (ver grabSystem.isHeld/
  // getHoldingController).
  function update(dt, screwdriverTip, screwdriverQuaternion) {
    if (coverOpen) return;

    screws.forEach((screw) => {
      if (screw.removed) return;

      let inRange = false;
      if (screwdriverTip) {
        const screwPos = new THREE.Vector3();
        screw.mesh.getWorldPosition(screwPos);
        inRange = screwPos.distanceTo(screwdriverTip) <= SCREW_TOUCH_RADIUS;
      }

      if (!inRange) {
        screw.engaged = false;
        return;
      }

      if (!screw.engaged) {
        screw.engaged = true;
        screw.startQuaternion = screwdriverQuaternion.clone();
        return;
      }

      const angle = screw.startQuaternion.angleTo(screwdriverQuaternion);
      if (angle >= TURN_ANGLE_THRESHOLD) {
        screw.turnsCompleted += 1;
        screw.startQuaternion = screwdriverQuaternion.clone();
        if (screw.turnsCompleted >= TURNS_TO_REMOVE) {
          screw.removed = true;
          screw.mesh.visible = false;
        }
      }
    });

    if (allScrewsRemoved()) {
      coverOpen = true;
      cover.visible = false;
      core.visible = true;
    }
  }

  // NÃO descarta a geometria/material do núcleo (`core`) aqui: uma vez
  // exposto, ele pode ter sido separado da bomba (pego e carregado pra
  // outro lugar, ver defuseTable.js#update) e continuar vivo na cena depois
  // que esta bomba já foi entregue/descartada — mesmo padrão já usado pelo
  // panfleto (pamphlet.js), que também nunca é descartado por bomb.dispose().
  function dispose() {
    screws.forEach((screw) => screw.mesh.geometry.dispose());
    screwMaterial.dispose();
    cover.geometry.dispose();
    cover.material.dispose();
  }

  return {
    group,
    update,
    dispose,
    get coverOpen() {
      return coverOpen;
    },
    get coreObject() {
      return core;
    },
  };
}
