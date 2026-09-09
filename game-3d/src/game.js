import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { createRoomLayout } from './roomLayout.js';
import { createDispenser } from './dispenser.js';
import { createCollectionBox } from './collectionBox.js';
import { createScanner } from './scanner.js';
import { createDefuseTable } from './defuseTable.js';
import { createConveyor } from './conveyor.js';
import { createTeleportSystem } from './teleport.js';
import { createGrabSystem } from './grab.js';
import { createBombFlow } from './bombFlow.js';
import { createScoreManager } from './scoreManager.js';
import { createRoundTimer } from './roundTimer.js';
import { createTensionCue } from './audio.js';
import { createReportPanel } from './reportPanel.js';

// Fachada do jogo — implementa o contrato definido no CLAUDE.md para o
// Frontend (2D) controlar/observar a sessão de VR sem conhecer Three.js:
//   game.start()
//   game.pause()
//   game.on('bombDispensed', (bombId) => {...})
//   game.on('bombScanned', (bombId) => {...})
//   game.on('bombDelivered', (bombId, wasCorrect) => {...})
//   game.on('roundEnd', (finalScore, deathsCaused) => {...})
// Hoje só existe o game-3d, então main.js consome esse contrato sozinho
// (ver comentário no fim do arquivo); quando o Frontend existir, ele
// substitui esse consumo sem precisar tocar neste arquivo.
//
// Este arquivo monta o bootstrap Three.js/WebXR e os objetos macro da sala
// (dispenser, caixa de coleta, scanner, mesa de desarme, esteira) já
// posicionados via roomLayout.js. O fluxo de scan, o modo de desarme na
// mesa e a entrega pela esteira ainda entram nas próximas fases da
// migração descrita no plano de implementação.
export function createGame() {
  const listeners = { bombDispensed: [], bombScanned: [], bombDelivered: [], roundEnd: [] };
  function emit(event, ...args) {
    listeners[event].forEach((callback) => callback(...args));
  }
  function on(event, callback) {
    listeners[event].push(callback);
  }

  let running = false;
  let hasStarted = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202030);

  const camera = new THREE.PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  camera.position.set(0, 1.6, 0);

  // "Rig" do jogador: durante uma sessão WebXR ativa, o Three.js sobrescreve
  // a transform da câmera e dos controllers a cada frame com a pose
  // rastreada do headset/mãos — setar camera.position diretamente (como o
  // teleporte antigo fazia) não tem efeito visível, porque é desfeito no
  // frame seguinte. Por isso câmera e controllers ficam dentro de um Group
  // que NÃO é gerenciado pelo XR; teleportar move esse rig, não a câmera.
  const player = new THREE.Group();
  player.add(camera);
  scene.add(player);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(3, 10, 5);
  scene.add(dirLight);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0x555566 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const controllerModelFactory = new XRControllerModelFactory();
  const controllers = [];

  function buildController(index) {
    const controller = renderer.xr.getController(index);
    player.add(controller);

    const grip = renderer.xr.getControllerGrip(index);
    grip.add(controllerModelFactory.createControllerModel(grip));
    player.add(grip);

    controllers.push(controller);
  }
  buildController(0);
  buildController(1);
  const controllerTipPositions = controllers.map(() => new THREE.Vector3());

  const layout = createRoomLayout();

  const grabSystem = createGrabSystem({ scene, controllers });
  const bombs = [];

  const landingPosition = new THREE.Vector3(
    layout.stations.dispenser.position.x,
    0.4,
    layout.stations.dispenser.position.z
  );
  const dispenser = createDispenser({
    scene,
    position: layout.stations.dispenser.position,
    rotationY: layout.stations.dispenser.rotationY,
    landingPosition,
    onBombLanded: (bomb) => {
      grabSystem.register(bomb.group);
    },
  });
  createCollectionBox({
    scene,
    position: layout.stations.dispenser.position,
    rotationY: layout.stations.dispenser.rotationY,
  });
  const scanner = createScanner({
    scene,
    position: layout.stations.scanner.position,
    rotationY: layout.stations.scanner.rotationY,
    grabSystem,
    onScanned: (bombId) => emit('bombScanned', bombId),
  });
  const scoreManager = createScoreManager();
  const conveyor = createConveyor({
    scene,
    position: layout.stations.conveyor.position,
    rotationY: layout.stations.conveyor.rotationY,
    grabSystem,
    onDeliver: (bombId, wasCorrect) => {
      scoreManager.recordDelivery(bombId, wasCorrect);
      const index = bombs.findIndex((bomb) => bomb.id === bombId);
      if (index !== -1) bombs.splice(index, 1);
      bombFlow.notifyDelivered();
      emit('bombDelivered', bombId, wasCorrect);
    },
  });

  const teleport = createTeleportSystem({
    scene,
    player,
    controllers,
    points: layout.teleportPoints,
  });

  const defuseTable = createDefuseTable({
    scene,
    position: layout.stations.defuseTable.position,
    rotationY: layout.stations.defuseTable.rotationY,
    grabSystem,
    teleport,
  });

  controllers.forEach((controller) => {
    controller.addEventListener('selectstart', () => defuseTable.handleTrigger());
  });

  const reportPanel = createReportPanel(camera);
  const tensionCue = createTensionCue();
  const roundTimer = createRoundTimer({
    onTensionStart: () => tensionCue.start(),
    onRoundEnd: () => {
      running = false;
      tensionCue.stop();
      reportPanel.show(scoreManager.score, scoreManager.deathsCaused, scoreManager.bombLog);
      emit('roundEnd', scoreManager.score, scoreManager.deathsCaused);
    },
  });

  const bombFlow = createBombFlow({
    onSpawn: () => {
      const bomb = dispenser.dropBomb();
      bombs.push(bomb);
      emit('bombDispensed', bomb.id);
    },
    getPendingCount: () => bombs.filter((bomb) => !bomb.delivered).length,
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  const timer = new THREE.Timer();

  function animate() {
    timer.update();
    const dt = timer.getDelta();

    controllers.forEach((controller, index) =>
      controller.getWorldPosition(controllerTipPositions[index])
    );

    if (running) {
      dispenser.update(dt);
      bombFlow.update(dt);
      scanner.update(dt, controllerTipPositions, bombs);
      defuseTable.update(dt, controllerTipPositions, bombs);
      conveyor.update(dt, controllerTipPositions, bombs);
      roundTimer.update(dt);
    }
    teleport.update();
    grabSystem.update();

    renderer.render(scene, camera);
  }

  function start() {
    if (running) return;
    running = true;
    // hasStarted separa "primeira vez" (monta o renderer/VRButton e o loop
    // de animação) de "retomar depois de pause()" (só volta a atualizar).
    if (!hasStarted) {
      hasStarted = true;
      document.body.appendChild(renderer.domElement);
      document.body.appendChild(VRButton.createButton(renderer));
      renderer.setAnimationLoop(animate);
      bombFlow.start();
    }
  }

  function pause() {
    running = false;
  }

  return { start, pause, on };
}
