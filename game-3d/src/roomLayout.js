import * as THREE from 'three';

// Layout fixo da sala: 4 estações macro (dispenser+caixa, scanner, mesa de
// desarme, esteira) dispostas em círculo ao redor de um ponto central, mais
// os pontos de teleporte correspondentes (um pouco mais perto do centro,
// dentro do alcance do braço) e um ponto "home" no meio da sala.
export const ROOM_RADIUS = 2.2;
const TELEPORT_ARM_REACH = 0.75;

const STATION_ANGLES = {
  dispenser: 0,
  scanner: Math.PI / 2,
  defuseTable: Math.PI,
  conveyor: (3 * Math.PI) / 2,
};

function positionAt(angle, radius) {
  return new THREE.Vector3(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
}

export function createRoomLayout() {
  const stations = {};
  Object.entries(STATION_ANGLES).forEach(([name, angle]) => {
    stations[name] = {
      position: positionAt(angle, ROOM_RADIUS),
      // Vira de frente para o centro da sala, onde o jogador vai estar.
      rotationY: angle + Math.PI,
      angle,
    };
  });

  const teleportPoints = Object.values(stations).map(({ angle }) => ({
    x: Math.sin(angle) * (ROOM_RADIUS - TELEPORT_ARM_REACH),
    z: Math.cos(angle) * (ROOM_RADIUS - TELEPORT_ARM_REACH),
  }));
  teleportPoints.push({ x: 0, z: 0 });

  return { stations, teleportPoints };
}
