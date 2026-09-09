import { createTextPanel } from './textPanel.js';

const MAX_LOG_LINES = 12;

// Relatório final, preso à câmera — substituto temporário da tela de
// pontuação real, que é responsabilidade do /frontend (2D) quando existir
// (CLAUDE.md, "Divisão do projeto em três frentes"). Fica oculto durante a
// partida inteira e só aparece quando o round termina (game.on('roundEnd')),
// listando pontuação, mortes causadas e o resultado de cada bomba entregue.
export function createReportPanel(camera) {
  const summary = createTextPanel({ width: 0.5, height: 0.16, fontSize: 26 });
  summary.mesh.position.set(0, 0.18, -0.7);
  summary.mesh.visible = false;
  camera.add(summary.mesh);

  const log = createTextPanel({ width: 0.5, height: 0.4, fontSize: 18 });
  log.mesh.position.set(0, -0.2, -0.7);
  log.mesh.visible = false;
  camera.add(log.mesh);

  function show(score, deathsCaused, bombLog) {
    summary.setText([`PONTUACAO: ${score}`, `MORTES CAUSADAS: ${deathsCaused}`], '#ffd54f');
    summary.mesh.visible = true;

    const lines = bombLog.length
      ? bombLog
          .slice(0, MAX_LOG_LINES)
          .map((entry) => `Bomba ${entry.bombId}: ${entry.wasCorrect ? 'CORRETA' : 'INCORRETA'}`)
      : ['Nenhuma bomba entregue'];
    log.setText(lines, '#ffffff');
    log.mesh.visible = true;
  }

  function hide() {
    summary.mesh.visible = false;
    log.mesh.visible = false;
  }

  return { show, hide };
}
