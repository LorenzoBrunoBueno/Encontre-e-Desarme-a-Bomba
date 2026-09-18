import * as THREE from 'three';

const BELT_HEIGHT = 1.0; // altura aproximada de cintura, fixa no espaço local do player rig
const ANCHOR_SIDE_OFFSET = 0.18;
// Deslocamento pra FRENTE do corpo (eixo -Z local do `group`, que copia só
// o yaw da câmera — ver update() abaixo: pra yaw 0 isso coincide com o -Z
// mundial, a mesma direção em que a câmera padrão do three.js olha).
// Achado do playtest: com um valor pequeno (era 0.05) as ferramentas ficavam
// quase coladas no corpo, exigindo olhar quase reto pra baixo pra achá-las.
// Bem mais pra frente assim, o ângulo de/pro chão pra enxergar a mesma
// queda de altura (cintura vs. olhos) fica bem mais raso, sem precisar
// olhar pra baixo.
const ANCHOR_FORWARD_OFFSET = 0.24;

// Cinto utilitário: acompanha a posição XZ e o YAW (não pitch/roll) da
// câmera, fixando Y numa altura de cintura — o cinto "segue o corpo" (gira
// quando o jogador vira a cabeça/tronco) sem inclinar quando ele só olha pra
// cima/baixo, aproximação razoável já que o Quest 3 não rastreia quadril.
// Dois anchors filhos: esquerdo (chave de fenda) e direito (alicate).
//
// Nenhuma mudança foi necessária em grab.js para isso funcionar: os
// grabbables já são localizados por getWorldPosition() a cada frame
// (findNearestGrabbable), então uma ferramenta presa a um anchor que se move
// com o jogador continua pegável normalmente.
export function createUtilityBelt({ player, camera }) {
  const group = new THREE.Group();
  player.add(group);

  const leftAnchor = new THREE.Object3D();
  leftAnchor.position.set(-ANCHOR_SIDE_OFFSET, 0, -ANCHOR_FORWARD_OFFSET);
  group.add(leftAnchor);

  const rightAnchor = new THREE.Object3D();
  rightAnchor.position.set(ANCHOR_SIDE_OFFSET, 0, -ANCHOR_FORWARD_OFFSET);
  group.add(rightAnchor);

  const cameraPosition = new THREE.Vector3();
  const cameraQuaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();

  function update() {
    camera.getWorldPosition(cameraPosition);
    camera.getWorldQuaternion(cameraQuaternion);
    euler.setFromQuaternion(cameraQuaternion, 'YXZ');

    // group é filho de player (o rig raiz, que só translada — nunca gira),
    // então converter a posição mundial da câmera pro espaço local do player
    // e aplicar aqui equivale a "seguir o corpo", sem duplicar a lógica de
    // teleporte (que já move o player inteiro).
    const local = player.worldToLocal(cameraPosition.clone());
    group.position.set(local.x, BELT_HEIGHT, local.z);
    group.rotation.set(0, euler.y, 0);
  }

  return { group, leftAnchor, rightAnchor, update };
}
