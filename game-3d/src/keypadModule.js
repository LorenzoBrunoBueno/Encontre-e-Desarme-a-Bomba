import * as THREE from 'three';
import { createTextPanel } from './textPanel.js';
import { randomInt } from './random.js';

const CODE_LENGTH = 4;
const BUTTON_SIZE = 0.05;
const BUTTON_DEPTH = 0.02;
const GRID_SPACING = 0.075;
// TEMP: aumentado de 0.045 para facilitar teste com mouse no Immersive Web
// Emulator. Reverter para 0.045 antes de testar num Quest 3 real (o valor
// original já considera GRID_SPACING para minimizar sobreposição entre
// botões vizinhos).
const TOUCH_THRESHOLD = 0.08;
const FLASH_DURATION = 0.15;
const BUTTON_COLOR = 0x8899aa;
const PRESS_COLOR = 0x33aa55;
const PRESS_DEPTH = 0.008;
const CONFIRM_COLOR = 0x3355aa;
const CONFIRM_PRESS_COLOR = 0x33aa55;
// A face da frente das molduras precisa ficar atrás da posição MAIS
// afundada do botão (restZ - PRESS_DEPTH, menos metade da espessura do
// botão), com folga de verdade — sem isso o botão pressionado atravessa a
// moldura, dando z-fighting (textura "piscando"/quebrada) ao apertar.
const BEZEL_DEPTH = BUTTON_DEPTH * 0.6;
const BEZEL_MARGIN = 0.006;
const BEZEL_FRONT_Z = -(PRESS_DEPTH + BUTTON_DEPTH / 2 + BEZEL_MARGIN);
const OUTLINE_SCALE = 1.4;

// Layout clássico de teclado telefônico; null = espaço vazio na grade.
const LAYOUT = [
  [1, 2, 3],
  [4, 5, 6],
  [7, 8, 9],
  [null, 0, null],
];

// Módulo de senha, dividido em DUAS peças que a bomba posiciona em
// quadrantes diferentes (ver bomb.js): `padGroup` (teclado 0-9) e
// `displayGroup` (visor com os dígitos já digitados + botão de
// confirmar). O jogador digita os 4 dígitos e precisa TOCAR "OK" para
// validar — não é mais automático ao completar 4 dígitos. Confirmar errado
// só limpa o buffer pra tentar de novo, não falha a bomba na hora (só o
// relatório final revela o resultado).
//
// O teclado (0-9) segue o mesmo padrão do alicate/fio/botões coloridos:
// aproximar só DESTACA (contorno branco) o dígito mais perto da mão, não
// digita sozinho — precisa de gatilho pra confirmar. O botão "OK" continua
// só por toque (é um alvo isolado, sem vizinho perto pra esbarrar sem
// querer).
export function createKeypadModule({ onSolved }) {
  const padGroup = new THREE.Group();
  const displayGroup = new THREE.Group();

  const code = Array.from({ length: CODE_LENGTH }, () => randomInt(0, 9)).join('');
  let inputBuffer = '';
  let solved = false;
  let hoveredDigit = null;
  let flashTimer = 0;
  let flashButton = null;
  let confirmFlashTimer = 0;
  let touchingConfirm = false;

  // O visor mostra os dígitos JÁ DIGITADOS pelo jogador, nunca a senha
  // correta — essa só é revelada pelo panfleto do scanner (ou adivinhada,
  // se o jogador pular o scanner).
  function renderBuffer() {
    const shown = inputBuffer.padEnd(CODE_LENGTH, '_');
    display.setText(shown, '#ffffff');
  }

  const displayBezel = new THREE.Mesh(
    new THREE.BoxGeometry(0.27, 0.13, BEZEL_DEPTH),
    new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.7, metalness: 0.15 })
  );
  displayBezel.position.set(0, 0.02, BEZEL_FRONT_Z - BEZEL_DEPTH / 2);
  displayGroup.add(displayBezel);

  const display = createTextPanel({ width: 0.22, height: 0.08, fontSize: 40 });
  display.mesh.position.set(0, 0.06, BUTTON_DEPTH / 2 + 0.001);
  displayGroup.add(display.mesh);
  renderBuffer();

  const confirmMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(BUTTON_SIZE * 0.65, BUTTON_SIZE * 0.65, BUTTON_DEPTH, 16),
    new THREE.MeshStandardMaterial({ color: CONFIRM_COLOR, roughness: 0.5, metalness: 0.1 })
  );
  confirmMesh.rotation.x = Math.PI / 2;
  confirmMesh.position.set(0, -0.06, 0);
  displayGroup.add(confirmMesh);
  const confirmRestZ = confirmMesh.position.z;
  const confirmLocalPos = confirmMesh.position.clone();

  const confirmLabel = createTextPanel({ width: BUTTON_SIZE * 1.2, height: BUTTON_SIZE * 0.65, fontSize: 78 });
  confirmLabel.setText('OK', '#111111', '#ffffff');
  confirmLabel.mesh.position.set(0, -0.06, BUTTON_DEPTH / 2 + 0.001);
  displayGroup.add(confirmLabel.mesh);

  // Moldura escura atrás de toda a grade do teclado — mesma linguagem visual
  // do painel de botões de cor (buttonChoiceModule.js).
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(GRID_SPACING * 3.6, GRID_SPACING * 4.6, BEZEL_DEPTH),
    new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.7, metalness: 0.15 })
  );
  bezel.position.set(0, GRID_SPACING * 0.5, BEZEL_FRONT_Z - BEZEL_DEPTH / 2);
  padGroup.add(bezel);

  const buttons = [];
  LAYOUT.forEach((row, rowIndex) => {
    row.forEach((digit, colIndex) => {
      if (digit === null) return;
      const x = (colIndex - 1) * GRID_SPACING;
      const y = (1.5 - rowIndex) * GRID_SPACING;

      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(BUTTON_SIZE / 2, BUTTON_SIZE / 2, BUTTON_DEPTH, 16),
        new THREE.MeshStandardMaterial({ color: BUTTON_COLOR, roughness: 0.5, metalness: 0.1 })
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(x, y, 0);
      padGroup.add(mesh);
      const restZ = mesh.position.z;

      // Contorno de mira (mesma técnica do fio/botões coloridos): filho do
      // próprio botão, acompanha posição/rotação automaticamente.
      const outline = new THREE.Mesh(
        new THREE.CylinderGeometry(BUTTON_SIZE / 2, BUTTON_SIZE / 2, BUTTON_DEPTH, 16).scale(
          OUTLINE_SCALE,
          1,
          OUTLINE_SCALE
        ),
        new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide })
      );
      outline.visible = false;
      mesh.add(outline);

      const label = createTextPanel({
        width: BUTTON_SIZE * 0.9,
        height: BUTTON_SIZE * 0.9,
        // Tripliquei (32→96): no tamanho antigo o dígito ficava minúsculo
        // dentro do botão, ilegível sem dar zoom.
        fontSize: 96,
      });
      label.setText(String(digit), '#111111', '#ffffff');
      label.mesh.position.set(x, y, BUTTON_DEPTH / 2 + 0.001);
      padGroup.add(label.mesh);

      buttons.push({ digit, mesh, label, outline, restZ, position: new THREE.Vector3(x, y, 0) });
    });
  });

  function setHoverDigit(button) {
    if (hoveredDigit === button) return;
    if (hoveredDigit) hoveredDigit.outline.visible = false;
    hoveredDigit = button;
    if (hoveredDigit) hoveredDigit.outline.visible = true;
  }

  function findNearestDigit(tipPositions) {
    let nearest = null;
    let nearestDistance = TOUCH_THRESHOLD;
    for (const tip of tipPositions) {
      for (const button of buttons) {
        const distance = padGroup.localToWorld(button.position.clone()).distanceTo(tip);
        if (distance <= nearestDistance) {
          nearestDistance = distance;
          nearest = button;
        }
      }
    }
    return nearest;
  }

  function pressDigit(button) {
    flashButton = button;
    flashTimer = FLASH_DURATION;
    button.mesh.material.color.set(PRESS_COLOR);
    button.mesh.position.z = button.restZ - PRESS_DEPTH;
    button.label.mesh.position.z -= PRESS_DEPTH;

    // Sem validação automática — só acumula. Ao encher os 4 dígitos, o
    // próximo toque começa um buffer novo (permite corrigir sem travar).
    if (inputBuffer.length >= CODE_LENGTH) inputBuffer = '';
    inputBuffer += String(button.digit);
    renderBuffer();
  }

  function pressConfirm() {
    if (solved) return;
    confirmFlashTimer = FLASH_DURATION;
    confirmMesh.material.color.set(CONFIRM_PRESS_COLOR);
    confirmMesh.position.z = confirmRestZ - PRESS_DEPTH;

    if (inputBuffer.length === CODE_LENGTH && inputBuffer === code) {
      solved = true;
      onSolved();
    } else {
      inputBuffer = '';
      renderBuffer();
    }
  }

  function update(dt, tipPositions) {
    if (flashTimer > 0) {
      flashTimer -= dt;
      if (flashTimer <= 0 && flashButton) {
        flashButton.mesh.material.color.set(BUTTON_COLOR);
        flashButton.mesh.position.z = flashButton.restZ;
        flashButton.label.mesh.position.z = flashButton.restZ + BUTTON_DEPTH / 2 + 0.001;
        flashButton = null;
      }
    }
    if (confirmFlashTimer > 0) {
      confirmFlashTimer -= dt;
      if (confirmFlashTimer <= 0) {
        confirmMesh.material.color.set(CONFIRM_COLOR);
        confirmMesh.position.z = confirmRestZ;
      }
    }

    if (!solved) {
      setHoverDigit(findNearestDigit(tipPositions));
    }

    let touchingConfirmNow = false;
    for (const tip of tipPositions) {
      if (displayGroup.localToWorld(confirmLocalPos.clone()).distanceTo(tip) <= TOUCH_THRESHOLD) {
        touchingConfirmNow = true;
        break;
      }
    }
    if (touchingConfirmNow && !touchingConfirm) pressConfirm();
    touchingConfirm = touchingConfirmNow;
  }

  function handleTrigger() {
    if (!solved && hoveredDigit) pressDigit(hoveredDigit);
  }

  function dispose() {
    display.dispose();
    displayBezel.geometry.dispose();
    displayBezel.material.dispose();
    confirmMesh.geometry.dispose();
    confirmMesh.material.dispose();
    confirmLabel.dispose();
    bezel.geometry.dispose();
    bezel.material.dispose();
    buttons.forEach(({ mesh, label, outline }) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
      label.dispose();
      outline.geometry.dispose();
      outline.material.dispose();
    });
  }

  return {
    padGroup,
    displayGroup,
    update,
    handleTrigger,
    dispose,
    // Senha correta — usada pelo panfleto (scanner), nunca exibida no visor.
    code,
    // Getters exclusivos para leitura de estado em testes automatizados
    // (harness IWER em tests/e2e/webxr/) — não influenciam a lógica do
    // teclado, só expõem o que já existia como variável de closure.
    get inputBuffer() {
      return inputBuffer;
    },
    get solved() {
      return solved;
    },
    // Referências de posição (espaço local de padGroup/displayGroup) para o
    // teste calcular coordenadas mundiais reais via localToWorld, em vez de
    // duplicar GRID_SPACING/layout no lado do teste.
    buttons,
    confirmLocalPos,
  };
}
