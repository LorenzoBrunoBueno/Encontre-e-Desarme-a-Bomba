import * as THREE from 'three';

const PAD_RADIUS = 0.35;
const MAX_TELEPORT_DISTANCE = 8;
const RAY_COLOR_IDLE = 0x4488ff;
const RAY_COLOR_HOVER = 0x44ff88;

// Locomoção por teleporte com pontos fixos (decisão do projeto, evita
// cybersickness). Aponta o controller para um disco no chão e aperta o
// gatilho (trigger/select) para teleportar — o grip (squeeze) fica livre
// para o sistema de grab (pegar bomba/panfleto/alicate, ver grab.js).
//
// Move o "rig" do jogador (player), não a câmera diretamente — durante uma
// sessão WebXR ativa, o Three.js sobrescreve a posição da câmera a cada
// frame com a pose rastreada do headset, então mexer em camera.position
// não teria efeito visível (fica desfeito no frame seguinte).
//
// lock()/unlock() são usados pela mesa de desarme: dentro do modo de
// desarme a locomoção fica completamente travada (estado à parte do
// teleporte livre usado no resto da sala).
export function createTeleportSystem({ scene, player, controllers, points }) {
  const pads = points.map(({ x, z }) => {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(PAD_RADIUS * 0.7, PAD_RADIUS, 32),
      new THREE.MeshBasicMaterial({
        color: 0x2266ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.6,
      })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.01, z);
    scene.add(mesh);
    return { mesh, x, z };
  });

  const raycaster = new THREE.Raycaster();
  const tempMatrix = new THREE.Matrix4();
  const padMeshes = pads.map((pad) => pad.mesh);

  let locked = false;

  const controllerStates = controllers.map((controller) => {
    const rayGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    const rayMaterial = new THREE.LineBasicMaterial({ color: RAY_COLOR_IDLE });
    const line = new THREE.Line(rayGeometry, rayMaterial);
    line.scale.z = MAX_TELEPORT_DISTANCE;
    controller.add(line);

    const state = { controller, line, hoveredPad: null };

    controller.addEventListener('selectstart', () => {
      if (locked) return;
      if (state.hoveredPad) {
        player.position.set(state.hoveredPad.x, player.position.y, state.hoveredPad.z);
      }
    });

    return state;
  });

  function setPadsVisible(visible) {
    pads.forEach((pad) => {
      pad.mesh.visible = visible;
    });
  }

  function update() {
    controllerStates.forEach((state) => {
      state.line.visible = !locked;
      if (locked) {
        state.hoveredPad = null;
        return;
      }

      tempMatrix.identity().extractRotation(state.controller.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(state.controller.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

      const hits = raycaster.intersectObjects(padMeshes);
      if (hits.length > 0) {
        const hit = hits[0];
        state.hoveredPad = pads.find((pad) => pad.mesh === hit.object) ?? null;
        state.line.scale.z = hit.distance;
        state.line.material.color.set(RAY_COLOR_HOVER);
      } else {
        state.hoveredPad = null;
        state.line.scale.z = MAX_TELEPORT_DISTANCE;
        state.line.material.color.set(RAY_COLOR_IDLE);
      }
    });
  }

  function lock() {
    locked = true;
    setPadsVisible(false);
  }

  function unlock() {
    locked = false;
    setPadsVisible(true);
  }

  return {
    update,
    lock,
    unlock,
    get isLocked() {
      return locked;
    },
  };
}
