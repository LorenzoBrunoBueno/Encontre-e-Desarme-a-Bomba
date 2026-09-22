import * as THREE from 'three';
import { createTextPanel } from './textPanel.js';
import { pulseHaptic } from './haptics.js';

// Reduzido de 10 pra 6: um painel de 0.3m de altura com 10 linhas forçava o
// ajuste automático de fonte (textPanel.js#fitFontSize) a espremer o texto
// até ficar minúsculo — 6 linhas cabem com uma fonte de verdade legível, e
// cobre qualquer rodada normal sem ficar cortando informação real.
const MAX_LOG_LINES = 6;
// SUMMARY_Y subiu um pouco (era 0.36) e o painel ganhou altura (era 0.16) —
// a 3ª linha de resumo (SUAS MORTES, ver scoreManager.js#playerDeaths)
// precisava de mais espaço vertical sem encostar no log logo abaixo.
const SUMMARY_Y = 0.4;
const LOG_Y = 0.08;
const LOG_HEIGHT = 0.32;
const BUTTON_WIDTH = 0.5;
const BUTTON_HEIGHT = 0.09;
const BUTTON_GAP = 0.025;
const BUTTONS_TOP_Y = -0.2;
const RAY_LENGTH = 1.4;
const RAY_COLOR_IDLE = 0xaaaaaa;
const RAY_COLOR_HOVER = 0xffd54f;

// Painel de fim de turno, preso à câmera — mostra o resultado E, desde o
// loop contínuo entre fases (game-3d/instrucao.md), um menu de verdade pra
// continuar jogando SEM sair da sessão WebXR: "avançar de fase" (só quando
// o placar bateu o threshold), "jogar de novo" (mesma fase) ou "sair pro
// menu" (único caminho que ainda navega pra fora, ver game.js#handleExit).
// Este módulo só decide QUAL botão foi escolhido — quem persiste o
// resultado/progresso via API é quem ouve os eventos que game.js emite a
// partir daqui (main.js), não este arquivo.
//
// Interação por MIRA (raycast), não por proximidade — tentativa anterior
// usava "aproximar a mão + gatilho" (mesmo padrão do buttonChoiceModule.js),
// mas os botões ficam presos à câmera, bem na frente do rosto: encostar a
// mão exatamente ali exigia uma profundidade difícil de julgar sem
// referência (e a própria mão/controller acaba tampando o texto que se
// está tentando mirar). Apontar o controller (mesmo padrão do
// teleport.js, com raio visível) resolve os dois problemas — funciona a
// qualquer distância confortável do corpo.
export function createReportPanel(camera, controllers) {
  const summary = createTextPanel({ width: 0.5, height: 0.2, fontSize: 24 });
  summary.mesh.position.set(0, SUMMARY_Y, -0.7);
  summary.mesh.visible = false;
  camera.add(summary.mesh);

  const log = createTextPanel({ width: 0.5, height: LOG_HEIGHT, fontSize: 20 });
  log.mesh.position.set(0, LOG_Y, -0.7);
  log.mesh.visible = false;
  camera.add(log.mesh);

  function createButtonSlot() {
    const panel = createTextPanel({ width: BUTTON_WIDTH, height: BUTTON_HEIGHT, fontSize: 22 });
    panel.mesh.visible = false;
    camera.add(panel.mesh);
    return { panel, label: '', action: null, hovered: false };
  }

  // 3 slots reaproveitados entre rodadas — show() decide quantos ficam
  // visíveis e em que ordem (advance é opcional, replay/exit são sempre
  // oferecidos).
  const advanceButton = createButtonSlot();
  const replayButton = createButtonSlot();
  const exitButton = createButtonSlot();
  const buttons = [advanceButton, replayButton, exitButton];

  let panelVisible = false;

  const raycaster = new THREE.Raycaster();
  const tempMatrix = new THREE.Matrix4();
  const controllerStates = controllers.map((controller) => {
    const rayGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -1),
    ]);
    const rayMaterial = new THREE.LineBasicMaterial({ color: RAY_COLOR_IDLE, transparent: true, opacity: 0.85 });
    const line = new THREE.Line(rayGeometry, rayMaterial);
    line.scale.z = RAY_LENGTH;
    line.visible = false;
    controller.add(line);
    return { controller, line, hoveredButton: null };
  });

  function setHover(button, hovered) {
    if (button.hovered === hovered) return;
    button.hovered = hovered;
    button.panel.setText(button.label, hovered ? '#111111' : '#ffffff', hovered ? '#ffd54f' : '#2a2a2a');
  }

  function show(score, deathsCaused, playerDeaths, bombLog, { canAdvance, nextPhase, onAdvance, onReplay, onExit }) {
    summary.setText(
      [`PONTUACAO: ${score}`, `MORTES CAUSADAS: ${deathsCaused}`, `SUAS MORTES: ${playerDeaths}`],
      '#ffd54f'
    );
    summary.mesh.visible = true;

    const lines = bombLog.length
      ? bombLog
          .slice(0, MAX_LOG_LINES)
          .map((entry) => `Bomba ${entry.bombId}: ${entry.wasCorrect ? 'CORRETA' : 'INCORRETA'}`)
      : ['Nenhuma bomba entregue'];
    log.setText(lines, '#ffffff');
    log.mesh.visible = true;

    const active = [];
    if (canAdvance) {
      active.push({ button: advanceButton, label: `AVANCAR PARA FASE ${nextPhase}`, action: onAdvance });
    }
    active.push({ button: replayButton, label: 'JOGAR NOVAMENTE', action: onReplay });
    active.push({ button: exitButton, label: 'SAIR PARA O MENU', action: onExit });

    buttons.forEach((button) => {
      button.panel.mesh.visible = false;
      button.action = null;
      button.hovered = false;
    });
    active.forEach(({ button, label, action }, index) => {
      button.label = label;
      button.action = action;
      button.hovered = false;
      button.panel.setText(label, '#ffffff', '#2a2a2a');
      button.panel.mesh.position.set(0, BUTTONS_TOP_Y - index * (BUTTON_HEIGHT + BUTTON_GAP), -0.7);
      button.panel.mesh.visible = true;
    });

    panelVisible = true;
  }

  function hide() {
    panelVisible = false;
    summary.mesh.visible = false;
    log.mesh.visible = false;
    buttons.forEach((button) => {
      button.panel.mesh.visible = false;
      button.action = null;
      button.hovered = false;
    });
    controllerStates.forEach((state) => {
      state.hoveredButton = null;
      state.line.visible = false;
    });
  }

  // Chamado todo frame (independente de `running` — o round já está
  // congelado quando este painel aparece, ver game.js#animate), só faz
  // alguma coisa enquanto o painel estiver visível.
  function update() {
    if (!panelVisible) {
      controllerStates.forEach((state) => {
        state.line.visible = false;
      });
      return;
    }

    const targetMeshes = buttons.filter((button) => button.panel.mesh.visible).map((button) => button.panel.mesh);

    controllerStates.forEach((state) => {
      state.line.visible = true;

      tempMatrix.identity().extractRotation(state.controller.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(state.controller.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

      const hits = raycaster.intersectObjects(targetMeshes);
      if (hits.length > 0) {
        const hit = hits[0];
        state.hoveredButton = buttons.find((button) => button.panel.mesh === hit.object) ?? null;
        state.line.scale.z = hit.distance;
        state.line.material.color.set(RAY_COLOR_HOVER);
      } else {
        state.hoveredButton = null;
        state.line.scale.z = RAY_LENGTH;
        state.line.material.color.set(RAY_COLOR_IDLE);
      }
    });

    buttons.forEach((button) => {
      const hoveredByAny = controllerStates.some((state) => state.hoveredButton === button);
      setHover(button, hoveredByAny);
    });
  }

  function handleTrigger(controller) {
    if (!panelVisible) return;
    const state = controllerStates.find((entry) => entry.controller === controller);
    const button = state?.hoveredButton;
    if (!button?.action) return;
    pulseHaptic(controller, 0.3, 35);
    button.action();
  }

  return { show, hide, update, handleTrigger };
}
