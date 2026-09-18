import * as THREE from 'three';
import { createTextPanel } from './textPanel.js';

// Cor única do tutorial guiado — âmbar, não usada como identidade fixa de
// nenhuma estação (scanner é ciano, dispenser é âmbar só no indicador de
// "pronto"...), mas consistente o bastante pra ler como "isso é uma dica",
// não um elemento de jogo de verdade.
const ARROW_COLOR = 0xffcc33;
const ARROW_ABOVE_TARGET = 0.3;
const TEXT_ABOVE_ARROW = 0.22;
const BOB_AMPLITUDE = 0.04;
const BOB_SPEED = 3.2;

// Seta + texto flutuantes, em espaço de mundo (não presos à câmera como o
// reportPanel.js) — usados pelo tutorial guiado da primeira bomba
// (game.js#showTutorialStep) pra apontar pra objetos físicos da sala
// (alavanca, slot do scanner, botão da mesa, módulos da bomba, esteira).
// Só UMA instância de seta+texto existe, reaproveitada e reposicionada a
// cada passo — mesmo padrão de "poucos slots reaproveitados" do
// reportPanel.js, não um objeto novo por passo.
export function createTutorialGuide({ scene, camera }) {
  const arrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.035, 0.11, 12),
    new THREE.MeshStandardMaterial({
      color: ARROW_COLOR,
      emissive: ARROW_COLOR,
      emissiveIntensity: 0.6,
      roughness: 0.4,
    })
  );
  arrow.rotation.x = Math.PI; // ápice do cone aponta pra -Y por padrão (baixo)
  arrow.visible = false;
  scene.add(arrow);

  const label = createTextPanel({ width: 0.46, height: 0.14, fontSize: 24 });
  label.mesh.visible = false;
  scene.add(label.mesh);

  let visible = false;
  let baseY = 0;
  let bobPhase = 0;
  const cameraPosition = new THREE.Vector3();

  function show(targetPosition, text) {
    visible = true;
    arrow.visible = true;
    label.mesh.visible = true;

    arrow.position.set(targetPosition.x, targetPosition.y + ARROW_ABOVE_TARGET, targetPosition.z);
    baseY = arrow.position.y;
    bobPhase = 0;

    label.mesh.position.set(
      targetPosition.x,
      targetPosition.y + ARROW_ABOVE_TARGET + TEXT_ABOVE_ARROW,
      targetPosition.z
    );
    // Cor clara (não a paleta "glass" escura padrão) — texto e o glow da
    // borda usam a mesma cor âmbar da seta, pra ler como uma coisa só.
    label.setText(text, '#ffd54f', '#111111');
  }

  function hide() {
    visible = false;
    arrow.visible = false;
    label.mesh.visible = false;
  }

  // Chamado só enquanto `running` (game.js#animate) — não precisa continuar
  // animando com o jogo pausado/round encerrado.
  function update(dt) {
    if (!visible) return;
    bobPhase += dt * BOB_SPEED;
    arrow.position.y = baseY + Math.sin(bobPhase) * BOB_AMPLITUDE;

    // Billboard só no yaw (mesma técnica de hologramDisplay.js) — mantém a
    // altura do texto na mira, senão olhar de baixo/cima inclinaria o
    // painel de um jeito estranho.
    camera.getWorldPosition(cameraPosition);
    cameraPosition.y = label.mesh.position.y;
    label.mesh.lookAt(cameraPosition);
  }

  return {
    show,
    hide,
    update,
    get isVisible() {
      return visible;
    },
  };
}
