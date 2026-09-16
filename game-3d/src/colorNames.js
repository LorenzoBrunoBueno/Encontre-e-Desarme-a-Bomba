// Nomes legíveis das cores de fio/botão — compartilhado entre pamphlet.js
// (panfleto físico) e hologramDisplay.js (holograma de apoio no teto), já
// que os dois mostram exatamente os mesmos dados da bomba.
const COLOR_NAMES = {
  0xdd2222: 'VERMELHO',
  0x2255dd: 'AZUL',
  0xdddd22: 'AMARELO',
  0x22aa44: 'VERDE',
};

export function colorName(hex) {
  return COLOR_NAMES[hex] ?? '???';
}
