import * as THREE from 'three';

// Layout da sala (RoomRefactor): trocado de "4 estações em círculo" para uma
// sala RETANGULAR com posições/rotações explícitas por estação — o layout
// pedido (dispenser+scanner na mesma parede, cobertos por um único ponto de
// teleporte; mesa isolada numa lateral; esteira na lateral oposta) não é
// gerável por um ângulo uniforme como antes.
//
// Convenção de rotação (mantida do layout circular anterior): cada estação
// desenha sua face interativa (painéis, slots, botões) no seu próprio +Z
// local. `WALL_ROTATIONS` gira cada estação para essa face apontar para
// DENTRO da sala, uma rotação fixa por parede (não por ponto individual) —
// objetos encostados numa mesma parede devem ficar todos paralelos entre si,
// não cada um mirando o centro exato da sala.
export const ROOM_HALF_X = 3.0;
export const ROOM_HALF_Z = 2.6;
// Mesma altura usada por dispenser.js (duto/corpo) e hologramDisplay.js
// (painel preso perto do teto) — antes duplicada como constante local em
// cada um dos dois; agora um teto de verdade existe nesta altura.
export const CEILING_HEIGHT = 2.6;
// Altura da malha real do teto (RoomRefactor etapa 0) — fica ACIMA do corpo
// do dispenser (que ocupa a faixa em torno de CEILING_HEIGHT), com folga
// suficiente pro segmento de duto vertical + flange do item 1 do guia.
export const ROOM_CEILING_Y = CEILING_HEIGHT + 0.4;

const WALL_ROTATIONS = {
  north: 0, // parede em z = -ROOM_HALF_Z, face interativa olha para +Z (centro)
  south: Math.PI, // parede em z = +ROOM_HALF_Z, face olha para -Z
  east: -Math.PI / 2, // parede em x = +ROOM_HALF_X, face olha para -X
  west: Math.PI / 2, // parede em x = -ROOM_HALF_X, face olha para +X
};

// Distância da parede até a origem de cada estação — cada objeto ainda tem
// sua própria profundidade (corpo + painéis), então esse inset varia um
// pouco por estação pra evitar clipping ou, no caso da esteira, pra
// encostar de propósito perto da parede (o vão de saída/cortina PVC do novo
// item 3 do guia precisa ficar bem perto da parede real).
const DISPENSER_WALL_INSET = 0.55;
const SCANNER_WALL_INSET = 0.55;
const DEFUSE_TABLE_WALL_INSET = 0.75;
const CONVEYOR_WALL_INSET = 0.5;
// Alavanca de purga do superaquecimento do scanner — não é uma "estação"
// como as outras (não tem estrutura própria/painéis, é só a alavanca +
// placa de fixação, ver game.js), mas ganhou uma entrada aqui do mesmo
// jeito pra não duplicar a posição entre este arquivo (teleporte) e
// game.js (a alavanca em si).
//
// Achado do playtest (2026-09-18): montada no CENTRO da sala (posição
// antiga, (0.35, 0, 0)), a alavanca ficava baixa demais (nível do chão) e
// longe de qualquer parede — difícil de alcançar. Pedido do usuário: mover
// pra parede oeste, à direita da esteira do ponto de vista de quem está de
// frente pra ela (conveyor.rotationY aponta pra +X — "direita" nessa
// orientação é -Z, mesma fórmula `right = forward × up` já usada pra
// posicionar a lixeira ao lado da mesa, ver game-3d/instrucao.md seção 9).
// `wallInset` aqui é maior que o das outras estações de propósito: a
// alavanca fica bem PERTO da parede (montada nela), não no meio do
// caminho como dispenser/scanner/mesa/esteira.
const PURGE_LEVER_WALL_INSET = 0.2;
const PURGE_LEVER_Z_OFFSET = -1.3; // deslocamento a partir da esteira, na mesma parede

export function createRoomLayout() {
  const stations = {
    dispenser: {
      position: new THREE.Vector3(-0.6, 0, -ROOM_HALF_Z + DISPENSER_WALL_INSET),
      rotationY: WALL_ROTATIONS.north,
      wall: 'north',
      // Distância até a parede de trás — dispenser.js usa isso pra terminar
      // o duto horizontal (item 1) exatamente na parede.
      wallRunLength: DISPENSER_WALL_INSET,
    },
    scanner: {
      position: new THREE.Vector3(0.6, 0, -ROOM_HALF_Z + SCANNER_WALL_INSET),
      rotationY: WALL_ROTATIONS.north,
      wall: 'north',
    },
    defuseTable: {
      position: new THREE.Vector3(ROOM_HALF_X - DEFUSE_TABLE_WALL_INSET, 0, 0),
      rotationY: WALL_ROTATIONS.east,
      wall: 'east',
    },
    conveyor: {
      position: new THREE.Vector3(-(ROOM_HALF_X - CONVEYOR_WALL_INSET), 0, 0),
      rotationY: WALL_ROTATIONS.west,
      wall: 'west',
      // Distância até a parede de trás — conveyor.js usa isso pra posicionar
      // o vão de saída/cortina PVC (item 3) exatamente na parede.
      wallRunLength: CONVEYOR_WALL_INSET,
    },
    purgeLever: {
      position: new THREE.Vector3(
        -(ROOM_HALF_X - PURGE_LEVER_WALL_INSET),
        0,
        PURGE_LEVER_Z_OFFSET
      ),
      rotationY: WALL_ROTATIONS.west,
      wall: 'west',
    },
  };

  // Um único ponto de teleporte cobre dispenser+scanner (mesma parede,
  // lado a lado) — o resto continua 1 ponto por estação (a alavanca de
  // purga inclusa, desde que ela ganhou uma posição de parede de verdade).
  const teleportPoints = [
    { x: 0, z: stations.dispenser.position.z + 0.75 }, // preparo: dispenser + scanner
    { x: stations.defuseTable.position.x - 1.0, z: 0 }, // mesa de desarme
    { x: stations.conveyor.position.x + 1.0, z: 0 }, // esteira
    { x: stations.purgeLever.position.x + 1.0, z: stations.purgeLever.position.z }, // alavanca de purga
  ];

  return { stations, teleportPoints, roomHalfX: ROOM_HALF_X, roomHalfZ: ROOM_HALF_Z, wallRotations: WALL_ROTATIONS };
}
