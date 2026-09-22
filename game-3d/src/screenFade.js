import * as THREE from 'three';
import { createTextPanel } from './textPanel.js';

// Overlay de tela preta preso à câmera (mesmo padrão de reportPanel.js/
// standingWarningPanel em game.js: camera.add(mesh), sem depender de
// posição do rig) — usado pelo fluxo de morte instantânea (game.js
// #triggerPlayerDeath/#triggerGameOver). Quad grande (6x6m) bem perto da
// câmera (z=-0.4) garante cobertura total do FOV com folga generosa, tanto
// no Immersive Web Emulator quanto no headset real, sem precisar calcular o
// FOV exato (que no WebXR vem por-olho da sessão, não de camera.fov).
// depthTest/depthWrite desligados + renderOrder alto: sempre desenha por
// cima do resto da cena, na ordem que a gente controlar (texto de game over
// usa um renderOrder ainda maior, pra ficar por cima do preto).
const OVERLAY_SIZE = 6;
const OVERLAY_DISTANCE = 0.4;
const OVERLAY_RENDER_ORDER = 900;
const TEXT_RENDER_ORDER = 901;

export function createScreenFade({ camera }) {
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(OVERLAY_SIZE, OVERLAY_SIZE), material);
  mesh.position.set(0, 0, -OVERLAY_DISTANCE);
  mesh.renderOrder = OVERLAY_RENDER_ORDER;
  mesh.visible = false;
  camera.add(mesh);

  // Mensagem de game over (2ª morte dentro da salinha de reanimação) —
  // mesma técnica de canvas de textPanel.js, só visível durante esse texto.
  const gameOverText = createTextPanel({ width: 0.7, height: 0.2, fontSize: 30 });
  gameOverText.mesh.position.set(0, 0, -0.7);
  gameOverText.mesh.renderOrder = TEXT_RENDER_ORDER;
  gameOverText.mesh.material.depthTest = false;
  gameOverText.mesh.material.depthWrite = false;
  gameOverText.mesh.visible = false;
  camera.add(gameOverText.mesh);

  let alpha = 0;
  let fadeFrom = 0;
  let fadeTo = 0;
  let fadeElapsed = 0;
  let fadeDuration = 0;

  function applyAlpha(value) {
    alpha = value;
    material.opacity = value;
    mesh.visible = value > 0;
  }

  function snapOpaque() {
    fadeDuration = 0;
    applyAlpha(1);
  }

  function fadeTo_(target, duration) {
    fadeFrom = alpha;
    fadeTo = target;
    fadeElapsed = 0;
    fadeDuration = duration;
    if (duration <= 0) applyAlpha(target);
  }

  function showGameOverText(lines) {
    gameOverText.setText(lines, '#ff5555', '#000000');
    gameOverText.mesh.visible = true;
  }

  function hideGameOverText() {
    gameOverText.mesh.visible = false;
  }

  function update(dt) {
    if (fadeDuration > 0 && fadeElapsed < fadeDuration) {
      fadeElapsed = Math.min(fadeElapsed + dt, fadeDuration);
      const t = fadeElapsed / fadeDuration;
      applyAlpha(THREE.MathUtils.lerp(fadeFrom, fadeTo, t));
    }
  }

  return {
    snapOpaque,
    fadeTo: fadeTo_,
    showGameOverText,
    hideGameOverText,
    update,
    get alpha() {
      return alpha;
    },
  };
}
