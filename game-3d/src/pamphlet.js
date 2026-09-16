import * as THREE from 'three';
import { createTextPanel } from './textPanel.js';
import { colorName } from './colorNames.js';

// Panfleto com as instruções de desarme de uma bomba específica: senha, cor
// do fio certo e cor do botão certo. Texto grande — vai ser lido segurando
// na mão dentro da sessão VR (CLAUDE.md exige texto legível em VR).
export function createPamphlet(bomb) {
  const panel = createTextPanel({ width: 0.22, height: 0.3, fontSize: 26 });
  panel.setText(
    [
      `SENHA`,
      bomb.keypadModule.code,
      `FIO: ${colorName(bomb.wireModule.correctColor)}`,
      `BOTAO: ${colorName(bomb.buttonModule.correctColor)}`,
    ],
    '#111111',
    '#fdf6e3'
  );

  // Base fina atrás do texto — dá espessura de "folha de papel", em vez de
  // um plano de texto flutuando sem profundidade.
  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(0.226, 0.306, 0.004),
    new THREE.MeshStandardMaterial({ color: 0xfdf6e3, roughness: 0.9, metalness: 0 })
  );
  backing.position.z = -0.003;

  const group = new THREE.Group();
  group.add(backing);
  group.add(panel.mesh);

  function dispose() {
    panel.dispose();
    backing.geometry.dispose();
    backing.material.dispose();
  }

  return { group, dispose };
}
