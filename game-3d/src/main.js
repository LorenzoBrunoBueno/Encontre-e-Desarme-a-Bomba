import { createGame } from './game.js';

// Como o /frontend (2D) ainda não existe, este bootstrap consome o
// contrato de eventos do game.js "no lugar" do frontend futuro — quando
// ele existir, é aqui que a chamada de game.start() e os game.on(...)
// seriam substituídos por código de UI de verdade (ver CLAUDE.md, seção
// "Contrato de eventos entre Frontend e Cena 3D").
const game = createGame();

game.on('bombDispensed', (bombId) => {
  console.log(`Bomba ${bombId} liberada pelo dispenser`);
});
game.on('bombScanned', (bombId) => {
  console.log(`Bomba ${bombId} escaneada`);
});
game.on('bombDelivered', (bombId, wasCorrect) => {
  void wasCorrect; // resultado só é exibido ao jogador no relatório final (roundEnd)
  console.log(`Bomba ${bombId} entregue`);
});
game.on('roundEnd', (finalScore, deathsCaused) => {
  console.log(`Fim de turno — pontuação: ${finalScore}, mortes causadas: ${deathsCaused}`);
});

game.start();
