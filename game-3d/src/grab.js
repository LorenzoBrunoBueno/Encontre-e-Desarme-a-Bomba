import * as THREE from 'three';

const GRAB_RADIUS = 0.35;
const INDICATOR_RADIUS = 0.02;
const COLOR_IDLE = 0x888888;
const COLOR_IN_RANGE = 0x44ff88;

// Sistema genérico de pegar/carregar objetos (bomba, panfleto, alicate) via
// grip (squeeze) — sem motor de física, usando reparenting no scene graph
// (Object3D.attach preserva a transform mundial), igual ao padrão dos
// exemplos oficiais WebXR do three.js.
//
// Diferente do teleporte (mira por raycast), pegar é por PROXIMIDADE: a
// ponta do controller precisa estar a até GRAB_RADIUS de um objeto
// registrado. Cada controller ganha uma pequena esfera indicadora (mesma
// linguagem visual do raio do teleporte) que acende quando há algo pegável
// ao alcance, já que não existe um raio para dar esse feedback aqui.
//
// register(object3D, { grabRotation }) aceita um THREE.Quaternion opcional:
// se presente, o objeto sempre assume essa rotação (local, relativa à mão)
// ao ser pego, em vez de manter a rotação em que estava — usado pelo
// alicate para sempre "nascer" com a lâmina apontando pra frente da mão,
// não importa o ângulo em que foi pego.
export function createGrabSystem({ scene, controllers }) {
  const grabbables = [];
  const heldByController = new Map();

  const indicators = controllers.map((controller) => {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(INDICATOR_RADIUS, 12, 12),
      new THREE.MeshBasicMaterial({ color: COLOR_IDLE, transparent: true, opacity: 0.8 })
    );
    controller.add(mesh);
    return mesh;
  });

  function register(object3D, { grabRotation = null } = {}) {
    grabbables.push({ object3D, grabRotation });
  }

  function unregister(object3D) {
    const index = grabbables.findIndex((entry) => entry.object3D === object3D);
    if (index !== -1) grabbables.splice(index, 1);
  }

  function isHeld(object3D) {
    for (const held of heldByController.values()) {
      if (held === object3D) return true;
    }
    return false;
  }

  function findNearestGrabbable(controller) {
    const tip = new THREE.Vector3();
    controller.getWorldPosition(tip);

    let nearest = null;
    let nearestDistance = GRAB_RADIUS;
    grabbables.forEach((entry) => {
      if (isHeld(entry.object3D)) return;
      const objectPosition = new THREE.Vector3();
      entry.object3D.getWorldPosition(objectPosition);
      const distance = objectPosition.distanceTo(tip);
      if (distance <= nearestDistance) {
        nearest = entry;
        nearestDistance = distance;
      }
    });
    return nearest;
  }

  controllers.forEach((controller) => {
    controller.addEventListener('squeezestart', () => {
      if (heldByController.has(controller)) return;
      const entry = findNearestGrabbable(controller);
      if (!entry) return;
      controller.attach(entry.object3D);
      if (entry.grabRotation) {
        entry.object3D.quaternion.copy(entry.grabRotation);
      }
      heldByController.set(controller, entry.object3D);
    });

    controller.addEventListener('squeezeend', () => {
      const held = heldByController.get(controller);
      if (!held) return;
      scene.attach(held);
      heldByController.delete(controller);
    });
  });

  function update() {
    controllers.forEach((controller, index) => {
      const indicator = indicators[index];
      if (heldByController.has(controller)) {
        indicator.visible = false;
        return;
      }
      indicator.visible = true;
      const inRange = !!findNearestGrabbable(controller);
      indicator.material.color.set(inRange ? COLOR_IN_RANGE : COLOR_IDLE);
    });
  }

  return { register, unregister, isHeld, update };
}
