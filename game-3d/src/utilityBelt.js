import * as THREE from 'three';

// Distância cabeça-cintura de um adulto em pé (~1.6m de altura de olho ->
// ~1.0m de cintura). Usado como OFFSET a partir da altura real da cabeça
// (local.y, que em referência 'local-floor' é a altura real acima do chão
// físico), não mais como Y absoluto fixo — sem isso, um jogador sentado
// (cabeça bem mais baixa que 1.6m) tinha o cinto "flutuando" na altura de
// cintura de alguém em pé, fora do alcance do braço.
const HEAD_TO_WAIST_OFFSET = 0.6;
// Limites de segurança: nunca deixa o cinto colar no chão (jogador agachado)
// nem subir acima da altura de cintura padrão em pé (jogador muito alto).
const MIN_BELT_HEIGHT = 0.35;
const MAX_BELT_HEIGHT = 1.0;
const ANCHOR_SIDE_OFFSET = 0.18;
// Deslocamento pra FRENTE do corpo (eixo -Z local do `group`, que copia só
// o yaw da câmera — ver update() abaixo). Positivo aqui = na frente do
// corpo, não atrás, então some com sinal negativo nos anchors abaixo.
const ANCHOR_FORWARD_OFFSET = 0.12;

// Cinto utilitário: acompanha a posição XZ e o YAW (não pitch/roll) da
// câmera, derivando Y da altura real da cabeça (offset de cintura) — o
// cinto "segue o corpo" (gira quando o jogador vira a cabeça/tronco, sobe/
// desce com a altura real dele) sem inclinar quando ele só olha pra cima/
// baixo, aproximação razoável já que o Quest 3 não rastreia quadril.
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
    const beltHeight = THREE.MathUtils.clamp(
      local.y - HEAD_TO_WAIST_OFFSET,
      MIN_BELT_HEIGHT,
      MAX_BELT_HEIGHT
    );
    group.position.set(local.x, beltHeight, local.z);
    group.rotation.set(0, euler.y, 0);
  }

  return { group, leftAnchor, rightAnchor, update };
}
