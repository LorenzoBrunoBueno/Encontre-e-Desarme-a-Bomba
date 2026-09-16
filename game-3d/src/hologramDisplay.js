import * as THREE from 'three';
import { createTextPanel } from './textPanel.js';
import { colorName } from './colorNames.js';

// Mesmo valor de CEILING_HEIGHT em dispenser.js — duplicado por simplicidade
// (não existe um módulo de constantes compartilhadas no projeto); ajustar os
// dois juntos se a altura do teto mudar.
const CEILING_HEIGHT = 2.6;
const PANEL_WIDTH = 1.1;
const PANEL_HEIGHT = 0.55;

// Holograma de apoio: painel grande preso perto do teto, no CENTRO da sala,
// sempre virado pra câmera (billboard, só no yaw — não inclina com a cabeça)
// para ficar legível de qualquer estação (documento de especificação,
// Estação 2). COMPLEMENTA o panfleto físico existente — não o substitui —
// mostrando os mesmos dados (senha, cor do fio, cor do botão) da ÚLTIMA
// bomba escaneada, útil quando o jogador está longe da bancada.
export function createHologramDisplay({ scene, camera }) {
  const panel = createTextPanel({ width: PANEL_WIDTH, height: PANEL_HEIGHT, fontSize: 40 });
  panel.mesh.position.set(0, CEILING_HEIGHT - 0.45, 0);
  panel.setText(['HOLOGRAMA', 'AGUARDANDO ESCANEAMENTO'], '#33ffee', '#0a0a1acc');
  scene.add(panel.mesh);

  const cameraPosition = new THREE.Vector3();

  function showBomb(bomb) {
    panel.setText(
      [
        'ULTIMA LEITURA',
        `SENHA: ${bomb.keypadModule.code}`,
        `FIO: ${colorName(bomb.wireModule.correctColor)}`,
        `BOTAO: ${colorName(bomb.buttonModule.correctColor)}`,
      ],
      '#33ffee',
      '#0a0a1a'
    );
  }

  function update() {
    camera.getWorldPosition(cameraPosition);
    // Billboard só no yaw: mantém a altura do holograma na mira, senão olhar
    // pra cima/baixo inclinaria o painel de um jeito estranho.
    cameraPosition.y = panel.mesh.position.y;
    // lookAt() já deixa a face +Z (onde a textura é desenhada) voltada pra
    // câmera — testado ao vivo via IWER; um rotateY(π) extra aqui vira a
    // placa de costas pro jogador (confirmado empiricamente, não só teoria).
    panel.mesh.lookAt(cameraPosition);
  }

  return { mesh: panel.mesh, showBomb, update };
}
