import * as THREE from 'three';
import { shuffle } from './random.js';
import { pulseHaptic } from './haptics.js';

const BUTTON_COUNT = 4;
const BUTTON_COLORS = [0xdd2222, 0x2255dd, 0xdddd22, 0x22aa44];
const BUTTON_SIZE = 0.06;
const BUTTON_DEPTH = 0.02;
const BUTTON_SPACING = 0.11;
// Valor calibrado pra Quest 3 (dedo/controller de verdade) — vem de
// game-3d/src/difficulty.js por fase (`wireButtonTouchThreshold`), com este
// número como fallback caso o módulo seja instanciado sem config (ex.:
// testes isolados). Um valor maior só deve existir como override explícito
// de DEV (ver main.js/game.js `devInputOverride`), nunca hardcoded aqui.
const DEFAULT_TOUCH_THRESHOLD = 0.05;
const FLASH_DURATION = 0.2;
const PRESS_DEPTH = 0.012;
const OUTLINE_SCALE = 1.4;
// Mesmo raciocínio/valor de WIRE_EMISSIVE_INTENSITY em wireCuttingModule.js:
// piso de legibilidade das 4 cores independente da luz de cena, já que a
// sala é propositalmente escura fora do spot da mesa (ver game.js).
const BUTTON_EMISSIVE_INTENSITY = 0.2;

// Módulo de botão: sempre 4 cores fixas, 1 sorteada como correta por bomba.
// Mesmo padrão do alicate/fio: aproximar só DESTACA (contorno branco) o
// botão mais perto da mão, não pressiona sozinho — precisa de um gatilho
// pra confirmar. Antes era só proximidade (aproximar já apertava), o que
// causava toques acidentais no botão vizinho num painel apertado.
// Diferente do fio, não é destrutivo: o jogador pode reapertar outro botão
// até sair do modo de desarme — o resultado guardado é sempre o do ÚLTIMO
// toque (last-press-wins), por isso o callback é chamado a cada toque, não
// só uma vez.
export function createButtonChoiceModule({ onResult, touchThreshold = DEFAULT_TOUCH_THRESHOLD, sfx }) {
  const group = new THREE.Group();
  let hoveredButton = null;
  let flashTimer = 0;
  let flashButton = null;

  const colors = shuffle(BUTTON_COLORS);
  const correctIndex = Math.floor(Math.random() * BUTTON_COUNT);

  // Moldura escura atrás dos botões — dá profundidade (os botões antes
  // pareciam "colados" direto na carcaça da bomba). Grade 2x2 em vez de
  // 1x4: uma fileira única ficava larga demais e vazava do quadrante.
  //
  // A face da frente da moldura precisa ficar atrás da posição MAIS
  // afundada do botão (restZ - PRESS_DEPTH, menos metade da espessura do
  // botão) com uma folga de verdade — antes ela ficava quase colada
  // (0.002 de sobra) e o botão pressionado atravessava a moldura, dando
  // z-fighting (textura "piscando"/quebrada) exatamente ao pressionar.
  const bezelDepth = BUTTON_DEPTH * 0.6;
  const bezelMargin = 0.006;
  const bezelFrontZ = -(PRESS_DEPTH + BUTTON_DEPTH / 2 + bezelMargin);
  const bezelSide = BUTTON_SPACING + BUTTON_SIZE * 1.6;
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(bezelSide, bezelSide, bezelDepth),
    new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.7, metalness: 0.15 })
  );
  bezel.position.set(0, 0, bezelFrontZ - bezelDepth / 2);
  group.add(bezel);

  const buttons = colors.map((color, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = (col - 0.5) * BUTTON_SPACING;
    const y = (0.5 - row) * BUTTON_SPACING;
    // Botão redondo (cilindro deitado no eixo Z) em vez de placa quadrada —
    // lê melhor como botão físico de painel.
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(BUTTON_SIZE / 2, BUTTON_SIZE / 2, BUTTON_DEPTH, 16),
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.5,
        metalness: 0.1,
        emissive: color,
        emissiveIntensity: BUTTON_EMISSIVE_INTENSITY,
      })
    );
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, 0);
    group.add(mesh);

    // Contorno de mira (mesma técnica do fio: casca maior, BackSide) —
    // filho do próprio botão, então acompanha a posição/rotação dele sem
    // precisar de lógica extra (inclusive durante a animação de afundar).
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

    return {
      color,
      correct: i === correctIndex,
      mesh,
      outline,
      restZ: mesh.position.z,
      position: new THREE.Vector3(x, y, 0),
    };
  });

  function setHover(button) {
    if (hoveredButton === button) return;
    if (hoveredButton) hoveredButton.outline.visible = false;
    hoveredButton = button;
    if (hoveredButton) hoveredButton.outline.visible = true;
  }

  function findNearestButton(tipPositions) {
    let nearest = null;
    let nearestDistance = touchThreshold;
    for (const tip of tipPositions) {
      for (const button of buttons) {
        const distance = group.localToWorld(button.position.clone()).distanceTo(tip);
        if (distance <= nearestDistance) {
          nearestDistance = distance;
          nearest = button;
        }
      }
    }
    return nearest;
  }

  function press(button, controller) {
    flashButton = button;
    flashTimer = FLASH_DURATION;
    button.mesh.position.z = button.restZ - PRESS_DEPTH;
    // Feedback neutro: TODOS os botões piscam na cor ABSOLUTA do que foi
    // apertado, confirmando "algum botão foi pressionado" sem indicar se
    // era o certo (o botão fisicamente tocado também afunda, reforçando
    // qual foi). Troca a cor base (`color`), não `emissive` — emissive
    // SOMA luz por cima da cor original em vez de substituir, então um
    // botão azul piscando "vermelho" via emissive vira roxo, não vermelho.
    buttons.forEach((b) => {
      b.mesh.material.color.set(button.color);
      b.mesh.material.emissive.set(button.color);
    });
    // Mesma intensidade pro botão certo e o errado — mesma regra do fio,
    // não vaza o resultado.
    pulseHaptic(controller, 0.3, 35);
    sfx?.playButtonPress();
    onResult(button.correct);
  }

  function update(dt, tipPositions) {
    if (flashTimer > 0) {
      flashTimer -= dt;
      if (flashTimer <= 0) {
        buttons.forEach((b) => {
          b.mesh.material.color.set(b.color);
          b.mesh.material.emissive.set(b.color);
        });
        if (flashButton) {
          flashButton.mesh.position.z = flashButton.restZ;
          flashButton = null;
        }
      }
    }

    setHover(findNearestButton(tipPositions));
  }

  function handleTrigger(point, controller) {
    if (hoveredButton) press(hoveredButton, controller);
  }

  function dispose() {
    bezel.geometry.dispose();
    bezel.material.dispose();
    buttons.forEach(({ mesh, outline }) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
      outline.geometry.dispose();
      outline.material.dispose();
    });
  }

  return {
    group,
    update,
    handleTrigger,
    dispose,
    // Cor do botão certo — usada pelo panfleto (scanner).
    correctColor: colors[correctIndex],
  };
}
