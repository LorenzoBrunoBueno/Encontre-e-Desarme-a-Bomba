import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { createRoomLayout, ROOM_HALF_X, ROOM_HALF_Z, ROOM_CEILING_Y } from './roomLayout.js';
import { createTextPanel } from './textPanel.js';
import { createDispenser } from './dispenser.js';
import { createCollectionBox } from './collectionBox.js';
import { createScanner } from './scanner.js';
import { createDefuseTable } from './defuseTable.js';
import { createConveyor } from './conveyor.js';
import { createTeleportSystem } from './teleport.js';
import { createGrabSystem } from './grab.js';
import { createUtilityBelt } from './utilityBelt.js';
import { createPincers } from './pincers.js';
import { createScrewdriver } from './screwdriver.js';
import { createLeverSwitch } from './leverSwitch.js';
import { createHologramDisplay } from './hologramDisplay.js';
import { createProximityAlarm } from './proximityAlarm.js';
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
// Este arquivo monta o bootstrap Three.js/WebXR, os objetos macro da sala
// (dispenser, caixa de coleta, scanner, mesa de desarme, esteira) via
// roomLayout.js, e conecta o fluxo completo entre eles (scan, modo de
// desarme, entrega) — todos já wireados abaixo, não pendentes.
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

  // Pré-requisito de qualquer THREE.PositionalAudio (proximityAlarm.js) —
  // precisa estar pendurado na câmera pra espacializar o som relativo à
  // cabeça do jogador.
  const audioListener = new THREE.AudioListener();
  camera.add(audioListener);

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
  // Shadow mapping (RoomRefactor etapa 0) — a causa raiz mais barata do
  // "objetos flutuando" reportado nos prints: mesa, scanner e alavanca já
  // tocam o chão matematicamente (ver dispenser.js/defuseTable.js/
  // leverSwitch.js), só faltava a sombra de contato que confirma isso pro
  // olho. PCFSoftShadowMap suaviza a borda sem custo alto pra uma sala
  // pequena como esta.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Luz global reduzida (era Hemisphere 1.2 + Directional 1) — dá espaço de
  // contraste pra iluminação por zona (seção 8 do guia), principalmente o
  // spot dedicado da mesa de desarme, que precisa ler como "mais escuro ao
  // redor, foco na ação principal".
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.7));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(3, 10, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1024, 1024);
  dirLight.shadow.camera.left = -ROOM_HALF_X - 1;
  dirLight.shadow.camera.right = ROOM_HALF_X + 1;
  dirLight.shadow.camera.top = ROOM_HALF_Z + 1;
  dirLight.shadow.camera.bottom = -ROOM_HALF_Z - 1;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 20;
  scene.add(dirLight);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_HALF_X * 2, ROOM_HALF_Z * 2),
    new THREE.MeshStandardMaterial({ color: 0x555566 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Casca da sala (RoomRefactor, achado adicional não coberto pelo guia
  // original): antes não existia NENHUMA parede ou teto — os objetos
  // flutuavam contra o scene.background sólido. Pré-requisito de vários
  // itens do guia (duto até a parede, vão de saída da esteira, painéis na
  // parede livre).
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x3d3d46, roughness: 0.85, metalness: 0.05 });
  const WALL_THICKNESS = 0.15;

  function addWall(width, height, position, rotationY) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(width, height, WALL_THICKNESS), wallMaterial);
    wall.position.copy(position);
    wall.rotation.y = rotationY;
    wall.receiveShadow = true;
    wall.castShadow = true;
    scene.add(wall);
    return wall;
  }

  addWall(ROOM_HALF_X * 2, ROOM_CEILING_Y, new THREE.Vector3(0, ROOM_CEILING_Y / 2, -ROOM_HALF_Z), 0); // norte
  addWall(ROOM_HALF_X * 2, ROOM_CEILING_Y, new THREE.Vector3(0, ROOM_CEILING_Y / 2, ROOM_HALF_Z), Math.PI); // sul (livre p/ decoração)
  addWall(ROOM_HALF_Z * 2, ROOM_CEILING_Y, new THREE.Vector3(ROOM_HALF_X, ROOM_CEILING_Y / 2, 0), Math.PI / 2); // leste
  addWall(ROOM_HALF_Z * 2, ROOM_CEILING_Y, new THREE.Vector3(-ROOM_HALF_X, ROOM_CEILING_Y / 2, 0), Math.PI / 2); // oeste

  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_HALF_X * 2, ROOM_HALF_Z * 2),
    new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.9 })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM_CEILING_Y;
  scene.add(ceiling);

  // Decoração enxuta (RoomRefactor item 9, escopo reduzido): painéis de
  // status na parede sul, que ficou livre no layout (oposta ao conjunto
  // dispenser+scanner na parede norte) — mesma técnica de textPanel.js já
  // usada no scanner/reportPanel.
  const wallPanelA = createTextPanel({ width: 0.6, height: 0.3, fontSize: 32 });
  wallPanelA.setText(['DEFUSE INC.', 'SETOR DE TRIAGEM'], '#66ccff', '#0d0d12');
  wallPanelA.mesh.position.set(-1.1, 1.6, ROOM_HALF_Z - 0.05);
  wallPanelA.mesh.rotation.y = Math.PI;
  scene.add(wallPanelA.mesh);
  const wallPanelB = createTextPanel({ width: 0.6, height: 0.3, fontSize: 32 });
  wallPanelB.setText(['MANTENHA A CALMA', 'DESARME COM CUIDADO'], '#ffaa33', '#0d0d12');
  wallPanelB.mesh.position.set(1.1, 1.6, ROOM_HALF_Z - 0.05);
  wallPanelB.mesh.rotation.y = Math.PI;
  scene.add(wallPanelB.mesh);

  const controllerModelFactory = new XRControllerModelFactory();
  const controllers = [];

  function buildController(index) {
    const controller = renderer.xr.getController(index);
    player.add(controller);

    // Padrão oficial do three.js pra expor o gamepad de um controller —
    // haptics.js lê isso via controller.userData.inputSource, já que o
    // Object3D do controller não guarda essa referência sozinho.
    controller.addEventListener('connected', (event) => {
      controller.userData.inputSource = event.data;
    });
    controller.addEventListener('disconnected', () => {
      controller.userData.inputSource = null;
    });

    const grip = renderer.xr.getControllerGrip(index);
    grip.add(controllerModelFactory.createControllerModel(grip));
    player.add(grip);

    controllers.push(controller);
  }
  buildController(0);
  buildController(1);
  const controllerTipPositions = controllers.map(() => new THREE.Vector3());

  const layout = createRoomLayout();

  // Teleporte precisa existir antes do grab system: force pull (dentro de
  // grab.js) consulta teleport.isLocked para ficar desativado durante o
  // modo de desarme, o mesmo travamento de locomoção já usado lá.
  const teleport = createTeleportSystem({
    scene,
    player,
    controllers,
    points: layout.teleportPoints,
  });

  const grabSystem = createGrabSystem({ scene, controllers, isLocked: () => teleport.isLocked });

  // Cinto utilitário: acompanha o corpo do jogador e carrega as ferramentas
  // da mesa de desarme — alicate no anchor direito, chave de fenda (etapa
  // traseira) no esquerdo. Mesma rotação de grab que a mesa aplicava antes
  // pro alicate (lâmina sempre voltada pra frente da mão); a chave de fenda
  // usa a mesma convenção de eixo (ponta em +Y local, ver screwdriver.js).
  const utilityBelt = createUtilityBelt({ player, camera });
  const toolGrabRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

  const pincers = createPincers();
  pincers.group.position.set(0, -0.05, 0);
  utilityBelt.rightAnchor.add(pincers.group);
  grabSystem.register(pincers.group, { grabRotation: toolGrabRotation });

  const screwdriver = createScrewdriver();
  screwdriver.group.position.set(0, -0.05, 0);
  utilityBelt.leftAnchor.add(screwdriver.group);
  grabSystem.register(screwdriver.group, { grabRotation: toolGrabRotation });

  const proximityAlarm = createProximityAlarm({ listener: audioListener, grabSystem });

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
    wallRunLength: layout.stations.dispenser.wallRunLength,
    grabSystem,
    onBombLanded: (bomb) => {
      grabSystem.register(bomb.group, { throwable: true });
    },
    // bombFlow ainda não existe nesta linha (const declarada mais abaixo),
    // mas essa closure só roda em tempo de jogo, bem depois de tudo já
    // montado — mesmo padrão já usado em onDeliver do conveyor logo abaixo.
    onLeverPulled: () => bombFlow.confirmSpawn(),
  });
  createCollectionBox({
    scene,
    position: layout.stations.dispenser.position,
    rotationY: layout.stations.dispenser.rotationY,
  });
  // Holograma de apoio no teto central — complementa o panfleto físico,
  // mostrando os dados da última bomba escaneada de qualquer ponto da sala.
  const hologram = createHologramDisplay({ scene, camera });

  const scanner = createScanner({
    scene,
    position: layout.stations.scanner.position,
    rotationY: layout.stations.scanner.rotationY,
    grabSystem,
    hologram,
    onScanned: (bombId) => emit('bombScanned', bombId),
  });

  // Iluminação por zona (RoomRefactor item 8) — azul frio e constante no
  // scanner ("leitura tecnológica"); o pulso âmbar do dispenser já mora em
  // dispenser.js (junctionLight, disparado a cada queda), não precisa de
  // outra luz aqui.
  const scannerLight = new THREE.PointLight(0x3fb8ff, 0.8, 2.2);
  scannerLight.position.set(
    layout.stations.scanner.position.x,
    1.3,
    layout.stations.scanner.position.z + 0.4
  );
  scene.add(scannerLight);

  // Alavanca de purga do superaquecimento do scanner: 3 puxões, montada perto
  // do ponto de teleporte central (não em cima dele, pra não competir
  // visualmente com o disco de teleporte).
  const centerLever = createLeverSwitch({
    scene,
    position: new THREE.Vector3(0.35, 0, 0),
    requiredPulls: 3,
    onComplete: () => scanner.purgeOverheat(),
  });
  const scoreManager = createScoreManager();
  const conveyor = createConveyor({
    scene,
    position: layout.stations.conveyor.position,
    rotationY: layout.stations.conveyor.rotationY,
    wallRunLength: layout.stations.conveyor.wallRunLength,
    grabSystem,
    onDeliver: (bombId, wasCorrect) => {
      scoreManager.recordDelivery(bombId, wasCorrect);
      const index = bombs.findIndex((bomb) => bomb.id === bombId);
      if (index !== -1) bombs.splice(index, 1);
      bombFlow.notifyDelivered();
      emit('bombDelivered', bombId, wasCorrect);
    },
  });

  const defuseTable = createDefuseTable({
    scene,
    position: layout.stations.defuseTable.position,
    rotationY: layout.stations.defuseTable.rotationY,
    grabSystem,
    teleport,
    pincers,
    screwdriver,
    onCoreExposed: (coreObject) => conveyor.watchCore(coreObject),
  });

  // Spot branco focado na mesa de desarme (RoomRefactor item 8) — com a luz
  // global já reduzida acima, esse é o ponto mais iluminado da sala,
  // reforçando "foco na ação principal" sem precisar escurecer o resto na
  // mão (a queda de intensidade com a distância já faz esse trabalho).
  const defuseTableLight = new THREE.SpotLight(0xffffff, 1.6, 4, Math.PI / 5, 0.4);
  defuseTableLight.position.set(
    layout.stations.defuseTable.position.x,
    2.2,
    layout.stations.defuseTable.position.z
  );
  defuseTableLight.target.position.copy(layout.stations.defuseTable.position);
  defuseTableLight.castShadow = true;
  scene.add(defuseTableLight);
  scene.add(defuseTableLight.target);

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
      dispenser.setArmed(false);
      const bomb = dispenser.dropBomb();
      // Bombas nascem DEPOIS do scene.traverse abaixo (criadas em tempo de
      // jogo, não no setup) — sem sombra própria não venderiam a queda na
      // caixa de coleta (item 2), então ganham as flags aqui, na origem.
      bomb.group.traverse((object) => {
        if (object.isMesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      bombs.push(bomb);
      emit('bombDispensed', bomb.id);
    },
    onReady: () => dispenser.setArmed(true),
    getPendingCount: () => bombs.filter((bomb) => !bomb.delivered).length,
  });

  // Liga cast/receiveShadow em toda malha já criada acima (RoomRefactor
  // etapa 0) — mais simples e barato, pra uma sala deste tamanho, do que
  // marcar objeto por objeto em cada módulo (dispenser/scanner/mesa/esteira/
  // caixa/alavanca); meshes puramente decorativos (indicadores, textos)
  // ganham a flag sem efeito visual perceptível, sem custo real.
  scene.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
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
      dispenser.update(dt, controllerTipPositions);
      bombFlow.update(dt);
      // Fusível de cada bomba corre em toda estação, não só na mesa de
      // desarme — por isso é tickado aqui incondicionalmente, separado do
      // update() de cada módulo (que só faz algo quando a bomba está ativa).
      bombs.forEach((bomb) => bomb.tickTimer(dt));
      proximityAlarm.update(dt, bombs);
      scanner.update(dt, controllerTipPositions, bombs);
      centerLever.update(dt, controllerTipPositions);
      defuseTable.update(dt, controllerTipPositions, bombs);
      conveyor.update(dt, controllerTipPositions, bombs);
      roundTimer.update(dt);
    }
    teleport.update();
    utilityBelt.update();
    hologram.update();
    grabSystem.update(dt);

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
