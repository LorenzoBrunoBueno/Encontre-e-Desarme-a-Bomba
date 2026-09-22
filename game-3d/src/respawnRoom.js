import * as THREE from 'three';
import { createDoor, DOOR_WIDTH } from './door.js';

// Salinha de reanimação atrás da porta da parede sul (fluxo de morte
// instantânea, ver game.js#triggerPlayerDeath) — pequena de propósito
// (documento de especificação do usuário pede "uma pequena sala"), só cabe
// a máquina de reanimação. Geometria primitiva pura, mesmo estilo do resto
// do jogo (dispenser.js/roomDecor.js) — sem importar modelo externo.
const ROOM_WIDTH = 1.6;
const ROOM_DEPTH = 1.4;
const ROOM_HEIGHT = 2.4;

const MACHINE_RADIUS = 0.32;
const MACHINE_HEIGHT = 1.7;
const PULSE_SPEED = 2.5;

// `outerWallZ`: face externa da parede sul (ROOM_HALF_Z + WALL_THICKNESS/2
// em game.js) — onde a parede sólida termina e a salinha começa. A porta
// fica na face INTERNA (mesma posição que já usava antes desta mudança),
// então o vão da porta (a espessura da própria parede) já cobre a
// continuidade visual entre as duas.
export function createRespawnRoom({ scene, outerWallZ, doorInnerZ, doorRotationY = Math.PI }) {
  const group = new THREE.Group();
  scene.add(group);

  const roomMaterial = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.8, metalness: 0.15 });
  const roomBackZ = outerWallZ + ROOM_DEPTH;
  const halfWidth = ROOM_WIDTH / 2;

  // Piso contínuo: começa um pouco ANTES da face externa da parede (cobre o
  // vão sob a porta, que fica dentro da espessura da parede) até o fundo da
  // salinha — sem isso sobraria uma fresta sem piso exatamente sob a porta.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_WIDTH, roomBackZ - doorInnerZ),
    roomMaterial
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, (doorInnerZ + roomBackZ) / 2);
  floor.receiveShadow = true;
  group.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH), roomMaterial);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, ROOM_HEIGHT, (outerWallZ + roomBackZ) / 2);
  group.add(ceiling);

  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_WIDTH, ROOM_HEIGHT), roomMaterial);
  backWall.position.set(0, ROOM_HEIGHT / 2, roomBackZ);
  backWall.rotation.y = Math.PI;
  backWall.receiveShadow = true;
  group.add(backWall);

  [-1, 1].forEach((side) => {
    const sideWall = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_DEPTH, ROOM_HEIGHT), roomMaterial);
    sideWall.position.set(side * halfWidth, ROOM_HEIGHT / 2, (outerWallZ + roomBackZ) / 2);
    sideWall.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    sideWall.receiveShadow = true;
    group.add(sideWall);
  });

  // Máquina de reanimação — pod cilíndrico simples com luz pulsante âmbar/
  // verde (mesmo espírito de leverSwitch.js/dispenser.js: primitivas +
  // PointLight, sem geometria complexa).
  const machineZ = outerWallZ + ROOM_DEPTH * 0.62;
  const machineGroup = new THREE.Group();
  machineGroup.position.set(0, 0, machineZ);
  group.add(machineGroup);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(MACHINE_RADIUS * 1.15, MACHINE_RADIUS * 1.25, 0.1, 16),
    new THREE.MeshStandardMaterial({ color: 0x33363c, roughness: 0.6, metalness: 0.4 })
  );
  base.position.y = 0.05;
  machineGroup.add(base);

  const pod = new THREE.Mesh(
    new THREE.CylinderGeometry(MACHINE_RADIUS, MACHINE_RADIUS * 1.05, MACHINE_HEIGHT, 16, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x2f6f5a,
      roughness: 0.4,
      metalness: 0.5,
      side: THREE.DoubleSide,
    })
  );
  pod.position.y = 0.1 + MACHINE_HEIGHT / 2;
  machineGroup.add(pod);

  const glowRing = new THREE.Mesh(
    new THREE.TorusGeometry(MACHINE_RADIUS * 0.9, 0.02, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0x33ffaa, emissive: 0x33ffaa, emissiveIntensity: 1.2 })
  );
  glowRing.rotation.x = Math.PI / 2;
  glowRing.position.y = 0.1 + MACHINE_HEIGHT * 0.75;
  machineGroup.add(glowRing);

  const machineLight = new THREE.PointLight(0x33ffaa, 1.2, 2.4);
  machineLight.position.set(0, MACHINE_HEIGHT * 0.7, 0);
  machineGroup.add(machineLight);
  let pulsePhase = 0;

  group.traverse((object) => {
    if (object.isMesh) object.castShadow = true;
  });

  const door = createDoor({
    scene: group,
    position: new THREE.Vector3(0, 0, doorInnerZ),
    rotationY: doorRotationY,
  });

  // Ponto onde o rig do jogador é colocado ao reanimar (game.js
  // #triggerPlayerDeath) — na frente do pod, de frente pra porta.
  const machinePosition = new THREE.Vector3(0, 0, machineZ - MACHINE_RADIUS - 0.35);

  function containsPoint(point) {
    return (
      Math.abs(point.x) <= halfWidth &&
      point.z >= doorInnerZ &&
      point.z <= roomBackZ
    );
  }

  function update(dt) {
    door.update(dt);
    pulsePhase += dt * PULSE_SPEED;
    const pulse = 0.7 + 0.5 * Math.sin(pulsePhase);
    glowRing.material.emissiveIntensity = pulse;
    machineLight.intensity = 0.8 * pulse;
  }

  return {
    group,
    machinePosition,
    containsPoint,
    openDoor: door.openDoor,
    closeDoor: door.closeDoor,
    update,
    get isOpen() {
      return door.isOpen;
    },
  };
}
