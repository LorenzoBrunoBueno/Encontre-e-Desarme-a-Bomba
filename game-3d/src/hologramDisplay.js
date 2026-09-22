import { createTextPanel, billboardYaw } from './textPanel.js';
import { colorName } from './colorNames.js';
import { CEILING_HEIGHT } from './roomLayout.js';

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
    // billboardYaw (textPanel.js) trava a altura na do próprio painel antes
    // do lookAt, senão olhar pra cima/baixo inclinaria o painel de um jeito
    // estranho. lookAt() já deixa a face +Z (onde a textura é desenhada)
    // voltada pra câmera — testado ao vivo via IWER; um rotateY(π) extra
    // viraria a placa de costas pro jogador (confirmado empiricamente, não
    // só teoria).
    billboardYaw(panel.mesh, camera);
  }

  return { mesh: panel.mesh, showBomb, update };
}
