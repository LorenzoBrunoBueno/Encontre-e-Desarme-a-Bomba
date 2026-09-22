import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { createRoomLayout, ROOM_HALF_X, ROOM_HALF_Z, ROOM_CEILING_Y } from './roomLayout.js';
import { createTextPanel, billboardYaw } from './textPanel.js';
import { createDispenser } from './dispenser.js';
import { createCollectionBox } from './collectionBox.js';
import { createScanner } from './scanner.js';
import { createDefuseTable } from './defuseTable.js';
import { createConveyor } from './conveyor.js';
import { createTrashBin } from './trashBin.js';
import { DOOR_WIDTH, FRAME_HEIGHT } from './door.js';
import { createRespawnRoom } from './respawnRoom.js';
import { createScreenFade } from './screenFade.js';
import {
  createConcreteFloorTexture,
  createRivetedWallTexture,
  createFloorZoneMarker,
  createCrateStack,
  createBarrel,
  createCautionCone,
  createFireExtinguisher,
  createCeilingConduits,
  createBaseboards,
} from './roomDecor.js';
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
import { createTensionCue, createSfxPlayer } from './audio.js';
import { createBackgroundMusic } from './backgroundMusic.js';
import { createBombExplosionSfx } from './bombExplosion.js';
import { createCameraShake } from './cameraShake.js';
import { createReportPanel } from './reportPanel.js';
import { createTutorialGuide } from './tutorialGuide.js';
import { getDifficultyConfig, clampPhase, MAX_PHASE } from './difficulty.js';

// Fachada do jogo — implementa o contrato definido no CLAUDE.md para o
// Frontend (2D) controlar/observar a sessão de VR sem conhecer Three.js:
//   game.start()
//   game.pause()
//   game.on('bombDispensed', (bombId) => {...})
//   game.on('bombScanned', (bombId) => {...})
//   game.on('bombDelivered', (bombId, wasCorrect) => {...})
//   game.on('roundEnd', (finalScore, deathsCaused) => {...})
//   game.on('phaseUnlocked', (newPhase) => {...}) // ver difficulty.js
//   game.on('roundContinue', (newPhase) => {...}) // loop contínuo, ver abaixo
//   game.on('roundExit', () => {...}) // jogador escolheu sair pro menu 2D
// createGame({ phase, devInputOverride }) — `phase` é a fase de dificuldade
// persistente (currentPhase da API, default 1 se quem chamou não passar
// nada); `devInputOverride` é só conveniência de dev (mouse/Immersive Web
// Emulator), nunca deve ser true num build de produção (ver main.js).
//
// Loop contínuo entre fases (game-3d/instrucao.md): ao fim de uma rodada, o
// painel de relatório (reportPanel.js) vira um menu interativo de verdade
// ("avançar de fase" / "jogar de novo" / "sair pro menu") — escolher
// continuar reinicia a rodada em memória (resetRound, mais abaixo) SEM
// nunca sair da sessão WebXR nem navegar de página, porque o navegador
// exige um gesto novo do usuário pra abrir uma sessão XR de novo (não dá
// pra reentrar sozinho depois de navegar). Só "sair" ainda navega pro
// /frontend (report.html), exatamente como antes. Isso muda a regra que
// existia antes aqui ("game-3d nunca fala com a API"): quem persiste
// pontuação/fase pra cada rodada CONTINUADA agora é main.js, direto
// (game-3d/src/apiClient.js) — só o caminho de "sair" continua delegando
// isso pro /frontend (report.html) como sempre foi.
// Hoje só existe o game-3d, então main.js consome esse contrato sozinho
// (ver comentário no fim do arquivo); quando o Frontend existir, ele
// substitui esse consumo sem precisar tocar neste arquivo.
//
// Este arquivo monta o bootstrap Three.js/WebXR, os objetos macro da sala
// (dispenser, caixa de coleta, scanner, mesa de desarme, esteira) via
// roomLayout.js, e conecta o fluxo completo entre eles (scan, modo de
// desarme, entrega) — todos já wireados abaixo, não pendentes.
export function createGame({ phase = 1, devInputOverride = false } = {}) {
  const listeners = {
    bombDispensed: [],
    bombScanned: [],
    bombDelivered: [],
    roundEnd: [],
    phaseUnlocked: [],
    roundContinue: [],
    roundExit: [],
  };
  function emit(event, ...args) {
    listeners[event].forEach((callback) => callback(...args));
  }
  function on(event, callback) {
    listeners[event].push(callback);
  }

  // Fase de dificuldade persistente entre sessões (currentPhase/
  // highestPhaseUnlocked na API — ver CLAUDE.md "Contrato de API com o
  // Backend"). `let`, não `const`: o loop contínuo entre fases (ver
  // resetRound mais abaixo) reatribui os dois ao continuar pra uma nova
  // rodada sem sair da sessão WebXR. currentPhase já sai CLAMPADA
  // (1..MAX_PHASE) — quem chamou createGame() pode ter lido um valor
  // velho/inválido do localStorage.
  let currentPhase = clampPhase(phase);
  let difficulty = getDifficultyConfig(currentPhase);
  // Conveniência SÓ de desenvolvimento (mouse/Immersive Web Emulator, sem
  // dedo/controller de verdade) — nunca ativa em build de produção (main.js
  // só passa `devInputOverride: true` atrás de `import.meta.env.DEV`).
  // Substitui o hack antigo de TOUCH_THRESHOLD alterado hardcoded dentro de
  // buttonChoiceModule.js/keypadModule.js. Extraído em função (não só duas
  // consts) porque resetRound precisa recalcular os dois pra fase nova.
  function computeThresholds(diff) {
    return {
      wireButtonTouchThreshold: devInputOverride ? 0.09 : diff.wireButtonTouchThreshold,
      keypadTouchThreshold: devInputOverride ? 0.08 : diff.keypadTouchThreshold,
    };
  }
  const { wireButtonTouchThreshold, keypadTouchThreshold } = computeThresholds(difficulty);

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
  // redor, foco na ação principal". Ajustada num achado de playtest manual
  // via Immersive Web Emulator: intensidade 0.7 (com groundColor 0x444444)
  // deixava o teto praticamente preto e prejudicava a leitura geral da sala
  // no headset. Intensidade subiu pra 1.0 (ainda abaixo do 1.2 original) e
  // o groundColor — o componente que domina superfícies voltadas pra baixo,
  // como a face de baixo do teto — subiu de 0x444444 pra 0x5a5a5a; só subir
  // a intensidade teria clareado as paredes (voltadas de lado, pegam mais
  // skyColor) sem resolver o teto, que continuaria escuro por depender quase
  // só do groundColor. Mantém o contraste "mais escuro ao redor" sem apagar
  // o teto por completo.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x5a5a5a, 1.0));
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

  // Textura procedural de piso (achado "sala vazia": cor sólida lisa não lê
  // como chão de verdade) — mesma técnica de canvas de stripeTexture.js.
  // Repeat ~1 tile a cada 0.75m, então o tamanho exato do tile não precisa
  // bater exatamente com ROOM_HALF_X/Z (a textura é ruído, não uma grade
  // rígida — uma junta de rejunte "cortada" na borda da sala não chama
  // atenção do jeito que chamaria numa textura com padrão regular).
  const floorTexture = createConcreteFloorTexture();
  floorTexture.repeat.set((ROOM_HALF_X * 2) / 0.75, (ROOM_HALF_Z * 2) / 0.75);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_HALF_X * 2, ROOM_HALF_Z * 2),
    new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Casca da sala (RoomRefactor, achado adicional não coberto pelo guia
  // original): antes não existia NENHUMA parede ou teto — os objetos
  // flutuavam contra o scene.background sólido. Pré-requisito de vários
  // itens do guia (duto até a parede, vão de saída da esteira, painéis na
  // parede livre).
  // Chapa com rebites (mesmo motivo do piso acima) — um único material
  // compartilhado pelas 4 paredes, então o repeat é só uma aproximação
  // razoável pro tamanho de ambos os pares de parede (6m e 5.2m), não um
  // encaixe exato.
  const wallTexture = createRivetedWallTexture();
  wallTexture.repeat.set(8, 4);
  const wallMaterial = new THREE.MeshStandardMaterial({ map: wallTexture, roughness: 0.85, metalness: 0.05 });
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
  addWall(ROOM_HALF_Z * 2, ROOM_CEILING_Y, new THREE.Vector3(ROOM_HALF_X, ROOM_CEILING_Y / 2, 0), Math.PI / 2); // leste
  addWall(ROOM_HALF_Z * 2, ROOM_CEILING_Y, new THREE.Vector3(-ROOM_HALF_X, ROOM_CEILING_Y / 2, 0), Math.PI / 2); // oeste

  // Parede sul: antes um único addWall sólido (a porta era só decoração
  // colada na frente, sem vão real) — agora tem um vão de verdade do
  // tamanho da porta (door.js#DOOR_WIDTH/FRAME_HEIGHT), pra dar acesso à
  // salinha de reanimação (respawnRoom.js, fluxo de morte instantânea, ver
  // triggerPlayerDeath mais abaixo). 2 segmentos laterais + uma verga acima
  // do vão, no lugar do bloco único.
  const SOUTH_GAP_HALF = DOOR_WIDTH / 2;
  const southSideWidth = ROOM_HALF_X - SOUTH_GAP_HALF;
  addWall(
    southSideWidth,
    ROOM_CEILING_Y,
    new THREE.Vector3(-(SOUTH_GAP_HALF + southSideWidth / 2), ROOM_CEILING_Y / 2, ROOM_HALF_Z),
    Math.PI
  );
  addWall(
    southSideWidth,
    ROOM_CEILING_Y,
    new THREE.Vector3(SOUTH_GAP_HALF + southSideWidth / 2, ROOM_CEILING_Y / 2, ROOM_HALF_Z),
    Math.PI
  );
  const southLintelHeight = ROOM_CEILING_Y - FRAME_HEIGHT;
  addWall(
    DOOR_WIDTH,
    southLintelHeight,
    new THREE.Vector3(0, FRAME_HEIGHT + southLintelHeight / 2, ROOM_HALF_Z),
    Math.PI
  );

  // Cor levemente mais clara e roughness um pouco menor que o resto da sala
  // (achado de playtest manual: a normal do teto aponta pra baixo, então a
  // DirectionalLight — vinda de cima — nunca bate nela; o teto dependia só
  // da HemisphereLight, e ficava quase preto) — pega mais luz refletida da
  // HemisphereLight/pontuais próximas sem precisar de uma luz dedicada.
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM_HALF_X * 2, ROOM_HALF_Z * 2),
    new THREE.MeshStandardMaterial({ color: 0x3a3a42, roughness: 0.75 })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = ROOM_CEILING_Y;
  scene.add(ceiling);

  // Rodapé (achado "sala vazia": chão e parede se encontravam numa costura
  // "flutuante", sem nenhum acabamento) — tira fina nas 4 paredes.
  createBaseboards({ scene, roomHalfX: ROOM_HALF_X, roomHalfZ: ROOM_HALF_Z, wallThickness: WALL_THICKNESS });

  // Tubulação de teto ligando o holograma central às 4 paredes — só leitura
  // "instalação industrial de verdade" acima da cabeça do jogador, sem
  // nenhuma interação.
  createCeilingConduits({ scene, roomHalfX: ROOM_HALF_X, roomHalfZ: ROOM_HALF_Z });

  // Decoração enxuta (RoomRefactor item 9, escopo reduzido): painéis de
  // status na parede sul, que ficou livre no layout (oposta ao conjunto
  // dispenser+scanner na parede norte) — mesma técnica de textPanel.js já
  // usada no scanner/reportPanel.
  // ACHADO (RoomRefactor): "ROOM_HALF_Z - 0.05" ficava DENTRO do volume da
  // parede (a parede vai de ROOM_HALF_Z - WALL_THICKNESS/2 até + WALL_THICKNESS/2,
  // ou seja 2.525 a 2.675 pra WALL_THICKNESS=0.15) — a parede é sólida e
  // opaca, então qualquer coisa nesse intervalo fica oculta atrás da face
  // interna dela, invisível de dentro da sala. Precisa de z <= face interna
  // (ROOM_HALF_Z - WALL_THICKNESS/2), com uma folga pra não flickar (z-fight).
  const WALL_INNER_Z = ROOM_HALF_Z - WALL_THICKNESS / 2;
  const wallPanelA = createTextPanel({ width: 0.6, height: 0.3, fontSize: 32 });
  wallPanelA.setText(['DEFUSE INC.', 'SETOR DE TRIAGEM'], '#66ccff', '#0d0d12');
  wallPanelA.mesh.position.set(-1.1, 1.6, WALL_INNER_Z - 0.02);
  wallPanelA.mesh.rotation.y = Math.PI;
  scene.add(wallPanelA.mesh);
  const wallPanelB = createTextPanel({ width: 0.6, height: 0.3, fontSize: 32 });
  wallPanelB.setText(['MANTENHA A CALMA', 'DESARME COM CUIDADO'], '#ffaa33', '#0d0d12');
  wallPanelB.mesh.position.set(1.1, 1.6, WALL_INNER_Z - 0.02);
  wallPanelB.mesh.rotation.y = Math.PI;
  scene.add(wallPanelB.mesh);

  // Mais 2 painéis (achado "sala vazia": a parede sul tem 6m de largura e só
  // usava a faixa central — as pontas, perto das paredes leste/oeste,
  // ficavam completamente lisas). Protocolo de um lado, aviso "vigiado" do
  // outro (linguagem de sala de segurança, reforça o tema da porta).
  const wallPanelC = createTextPanel({ width: 0.62, height: 0.32, fontSize: 26 });
  wallPanelC.setText(['PROTOCOLO', '1. ESCANEIE  2. DESARME', '3. ENTREGUE'], '#8affc1', '#0d0d12');
  wallPanelC.mesh.position.set(-2.2, 1.6, WALL_INNER_Z - 0.02);
  wallPanelC.mesh.rotation.y = Math.PI;
  scene.add(wallPanelC.mesh);
  const wallPanelD = createTextPanel({ width: 0.62, height: 0.32, fontSize: 28 });
  wallPanelD.setText(['CÂMERAS EM OPERAÇÃO', 'VOCÊ ESTÁ SENDO MONITORADO'], '#ff5577', '#0d0d12');
  wallPanelD.mesh.position.set(2.2, 1.6, WALL_INNER_Z - 0.02);
  wallPanelD.mesh.rotation.y = Math.PI;
  scene.add(wallPanelD.mesh);

  // Porta de entrada/saída da sala, centrada na parede sul (única sem
  // estação) — agora um vão de verdade (ver os 3 addWall acima), abrindo
  // pra uma salinha de reanimação (respawnRoom.js). Posição em WALL_INNER_Z
  // (face interna da parede, não o centro dela) — mesmo motivo do
  // comentário acima; door.js usa deslocamentos locais pequenos (0.02 a
  // 0.09) pra protuberância da porta/moldura A PARTIR dessa face, não a
  // partir do centro da parede. `outerWallZ` é a face EXTERNA da mesma
  // parede — onde a salinha propriamente começa (game.js#triggerPlayerDeath
  // usa `respawnRoom.machinePosition`/`containsPoint` pra mover o jogador
  // pra lá e detectar quando ele sai).
  const respawnRoom = createRespawnRoom({
    scene,
    outerWallZ: ROOM_HALF_Z + WALL_THICKNESS / 2,
    doorInnerZ: WALL_INNER_Z,
    doorRotationY: Math.PI,
  });

  // Luz de zona da porta (mesmo padrão de scannerLight/defuseTableLight) —
  // sem ela a parede sul fica praticamente preta (luz global reduzida de
  // propósito, ver comentário acima da HemisphereLight), e a porta que
  // deveria ancorar visualmente essa parede desaparece no escuro.
  const doorLight = new THREE.PointLight(0xffffff, 2.2, 4.5);
  doorLight.position.set(0, 2.15, ROOM_HALF_Z - 0.6);
  scene.add(doorLight);

  // Extintor ao lado da porta — mesma convenção de WALL_INNER_Z (grupo na
  // face interna da parede, deslocamentos locais positivos puxando pra
  // dentro da sala, ver door.js).
  createFireExtinguisher({
    scene,
    position: new THREE.Vector3(0.7, 1.3, WALL_INNER_Z),
    rotationY: Math.PI,
  });

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

  // Trilha de piso por zona (achado "sala vazia": nenhuma estação tinha
  // marcação no chão além dos discos de teleporte) — mesma cor da luz
  // dedicada de cada estação (scannerLight, defuseTableLight, etc.),
  // reforçando a leitura do layout mesmo de longe.
  createFloorZoneMarker({ scene, position: layout.stations.dispenser.position, color: 0xffaa33 });
  createFloorZoneMarker({ scene, position: layout.stations.scanner.position, color: 0x3fb8ff });
  createFloorZoneMarker({ scene, position: layout.stations.defuseTable.position, color: 0xffffff });
  createFloorZoneMarker({ scene, position: layout.stations.conveyor.position, color: 0x33cc66 });
  // Mesma cor do scannerLight/statusPanel — reforça visualmente "isso
  // pertence ao scanner", mesmo a alavanca estando do outro lado da sala
  // (ver comentário em roomLayout.js sobre a mudança de posição).
  createFloorZoneMarker({ scene, position: layout.stations.purgeLever.position, color: 0x3fb8ff });

  // Props estáticos de canto (achado "sala vazia": os 4 cantos do
  // retângulo ficavam completamente vazios, sem nada preenchendo o volume)
  // — só decoração, sem grab/física.
  createCrateStack({ scene, position: new THREE.Vector3(-2.5, 0, -2.1), rotationY: 0.4 });
  createBarrel({ scene, position: new THREE.Vector3(2.55, 0, -2.15) });
  createCrateStack({ scene, position: new THREE.Vector3(2.5, 0, 2.15), rotationY: -0.6 });
  createBarrel({ scene, position: new THREE.Vector3(-2.55, 0, 2.1) });

  // Cone de sinalização perto da alavanca de purga do scanner — segue a
  // alavanca pra parede oeste (ver roomLayout.js), deslocado só o
  // suficiente pra não competir com o disco de teleporte dela.
  createCautionCone({
    scene,
    position: new THREE.Vector3(
      layout.stations.purgeLever.position.x + 0.5,
      0,
      layout.stations.purgeLever.position.z + 0.4
    ),
  });

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
  // Pose de "descanso" no anchor do cinto — usada tanto pro posicionamento
  // inicial quanto pra onde a ferramenta volta ao soltar o grip (ver
  // grab.js `homeAnchor`/`homePosition`), então as duas pontas usam o mesmo
  // valor de propósito.
  const TOOL_HOME_POSITION = new THREE.Vector3(0, -0.05, 0);

  const pincers = createPincers();
  pincers.group.position.copy(TOOL_HOME_POSITION);
  utilityBelt.rightAnchor.add(pincers.group);
  grabSystem.register(pincers.group, {
    grabRotation: toolGrabRotation,
    homeAnchor: utilityBelt.rightAnchor,
    homePosition: TOOL_HOME_POSITION,
  });

  const screwdriver = createScrewdriver();
  screwdriver.group.position.copy(TOOL_HOME_POSITION);
  utilityBelt.leftAnchor.add(screwdriver.group);
  grabSystem.register(screwdriver.group, {
    grabRotation: toolGrabRotation,
    homeAnchor: utilityBelt.leftAnchor,
    homePosition: TOOL_HOME_POSITION,
  });

  const proximityAlarm = createProximityAlarm({ listener: audioListener, grabSystem });

  // Feedback de bomba entregue incorretamente (conveyor.js#completeDelivery,
  // via onIncorrectDelivery mais abaixo): som de explosão distante + tremedeira
  // de câmera — ver bombExplosion.js/cameraShake.js pro porquê de cada escolha.
  const bombExplosionSfx = createBombExplosionSfx({ listener: audioListener });
  const cameraShake = createCameraShake({ player });
  // Overlay de tela preta + mensagem de game over (fluxo de morte
  // instantânea, ver triggerPlayerDeath/triggerGameOver mais abaixo).
  const screenFade = createScreenFade({ camera });

  // SFX por estação (scan/corte/botão/teclado/queda) — um único player
  // compartilhado (ver audio.js#createSfxPlayer) passado adiante pro
  // dispenser (que repassa pra cada bomba nova) e pro scanner.
  const sfx = createSfxPlayer();

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
    // bombFlow ainda não existe nesta linha (let declarado mais abaixo, e
    // reatribuído a cada rodada continuada por resetRound — ver comentário
    // no topo do arquivo), mas essa closure só roda em tempo de jogo, bem
    // depois de tudo já montado — mesmo padrão já usado em onDeliver do
    // conveyor logo abaixo, e sempre lê o `bombFlow` MAIS RECENTE por ser
    // uma referência de variável, não uma cópia capturada na criação.
    onLeverPulled: () => bombFlow.confirmSpawn(),
    fuseSeconds: difficulty.bombFuseSeconds,
    wireButtonTouchThreshold,
    keypadTouchThreshold,
    sfx,
  });
  createCollectionBox({
    scene,
    position: layout.stations.dispenser.position,
    rotationY: layout.stations.dispenser.rotationY,
  });
  // Aviso de "fila cheia" (bombFlow.js `onQueueFull`) — achado do playtest
  // via IWER: sem isso, o jogador não tinha como distinguir "o dispenser
  // ainda não chegou no próximo intervalo" de "o teto de segurança
  // (MAX_PENDING) travou a produção porque a caixa de coleta está lotada".
  // Parede norte (dispenser/scanner) já olha pra +Z sem rotação extra (ver
  // roomLayout.js WALL_ROTATIONS.north), mesma convenção dos painéis da
  // parede sul (wallPanelA/B), só que sem o rotation.y = Math.PI deles.
  const queueFullPanel = createTextPanel({ width: 0.42, height: 0.14, fontSize: 30 });
  queueFullPanel.setText(['FILA CHEIA', 'ENTREGUE BOMBAS'], '#ff5555', '#111111');
  queueFullPanel.mesh.position.set(
    layout.stations.dispenser.position.x,
    1.55,
    layout.stations.dispenser.position.z + 0.3
  );
  queueFullPanel.mesh.visible = false;
  scene.add(queueFullPanel.mesh);

  // Aviso de "fique em pé" — achado de playtest real no Quest 3: as
  // estações (mesa, scanner, alavancas, esteira) ficam em alturas fixas a
  // partir do chão físico (referência 'local-floor'), pensadas pra alcance
  // de jogador em pé; jogando sentado, algumas ficam fora de alcance (ver
  // game-3d/instrucao.md e CLAUDE.md, seção de requisitos de espaço). Preso
  // à câmera (HUD, mesmo padrão de reportPanel.js) pra ficar visível não
  // importa pra onde o jogador esteja olhando; aparece/desaparece sozinho
  // com base na altura real da cabeça (camera.position.y, que em
  // 'local-floor' é a altura real acima do chão) — sem bloquear o jogo,
  // só avisa. Histerese (SHOW < HIDE) evita piscar na borda do limiar.
  const STANDING_WARNING_SHOW_Y = 1.3;
  const STANDING_WARNING_HIDE_Y = 1.4;
  // Mesma largura/altura/fontSize de wallPanelC/D (game.js:267,272) — combo
  // já validado pelo auto-fit de textPanel.js pra linhas de ~25-28
  // caracteres (ver game-3d/instrucao.md, seção 10).
  const standingWarningPanel = createTextPanel({ width: 0.62, height: 0.32, fontSize: 26 });
  standingWarningPanel.setText(
    ['JOGAR EM PE E OBRIGATORIO', 'SENTADO, ALCANCE FICA LIMITADO'],
    '#ffcc33',
    '#111111'
  );
  standingWarningPanel.mesh.position.set(0, -0.25, -0.7);
  standingWarningPanel.mesh.visible = false;
  camera.add(standingWarningPanel.mesh);
  let standingWarningVisible = false;
  function updateStandingWarning() {
    const headHeight = camera.position.y;
    if (!standingWarningVisible && headHeight < STANDING_WARNING_SHOW_Y) {
      standingWarningVisible = true;
      standingWarningPanel.mesh.visible = true;
    } else if (standingWarningVisible && headHeight > STANDING_WARNING_HIDE_Y) {
      standingWarningVisible = false;
      standingWarningPanel.mesh.visible = false;
    }
  }

  // Holograma de apoio no teto central — complementa o panfleto físico,
  // mostrando os dados da última bomba escaneada de qualquer ponto da sala.
  const hologram = createHologramDisplay({ scene, camera });

  // Contador de "bombas entregues" — feedback de RITMO durante a partida,
  // sem vazar resultado individual (soma toda entrega, certa ou errada,
  // igual ao scoreManager.bombLog.length; placar numérico continua só no
  // relatório final, ver CLAUDE.md "Pontuação"). Mesmo padrão de billboard
  // do holograma ao lado (visível de qualquer estação), deslocado no X pra
  // não sobrepor.
  const deliveryCounterPanel = createTextPanel({ width: 0.5, height: 0.28, fontSize: 30 });
  deliveryCounterPanel.setText(['BOMBAS', 'ENTREGUES: 0'], '#8affc1', '#0d0d12');
  deliveryCounterPanel.mesh.position.set(
    hologram.mesh.position.x + 0.85,
    hologram.mesh.position.y,
    hologram.mesh.position.z
  );
  scene.add(deliveryCounterPanel.mesh);
  function updateDeliveryCounterPanel() {
    deliveryCounterPanel.setText(
      ['BOMBAS', `ENTREGUES: ${scoreManager.bombLog.length}`],
      '#8affc1',
      '#0d0d12'
    );
  }

  const scanner = createScanner({
    scene,
    position: layout.stations.scanner.position,
    rotationY: layout.stations.scanner.rotationY,
    grabSystem,
    hologram,
    onScanned: (bombId) => {
      emit('bombScanned', bombId);
      // Tutorial guiado da primeira bomba (game.js#showTutorialStep) — só
      // avança se for a bomba que ele está acompanhando (o jogador pode ter
      // escaneado outra fora de ordem, mas isso não deveria mexer no
      // tutorial da primeira).
      if (tutorialStep === 'scanner' && bombId === tutorialBombId) showTutorialStep('defuseApproach');
    },
    overheatInterval: difficulty.scanOverheatInterval,
    sfx,
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

  // Alavanca de purga do superaquecimento do scanner: 3 puxões. Montada na
  // parede oeste, à direita da esteira (ver roomLayout.js#purgeLever) — Y
  // elevado (achado do playtest: no chão, a alavanca ficava baixa demais
  // pra puxar confortavelmente) deixa a empunhadura de repouso a ~1.3m de
  // altura (LEVER_MOUNT_Y + HANDLE_REST_Y de leverSwitch.js), altura de
  // peito/ombro, sem mexer na geometria compartilhada do módulo (usada
  // também pela alavanca do dispenser, essa sim de chão de propósito).
  const LEVER_MOUNT_Y = 0.9;
  const purgeLeverPosition = layout.stations.purgeLever.position;

  // Placa de fixação atrás da alavanca — sem ela, a alavanca elevada
  // pareceria flutuando do lado da parede em vez de montada nela (as
  // outras estações não precisam disso: ou ficam no chão, como a do
  // dispenser, ou são grandes o bastante pra já encostar na parede
  // sozinhas).
  const LEVER_PLATE_WIDTH = 0.36;
  const LEVER_PLATE_HEIGHT = 0.9;
  const leverPlate = new THREE.Mesh(
    new THREE.BoxGeometry(LEVER_PLATE_WIDTH, LEVER_PLATE_HEIGHT, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.6, metalness: 0.3 })
  );
  leverPlate.rotation.y = layout.stations.purgeLever.rotationY;
  // -0.07 em X (não +): a parede oeste fica em X mais negativo que a
  // alavanca (que já está perto da parede, mas ainda pra DENTRO da sala,
  // ver PURGE_LEVER_WALL_INSET em roomLayout.js) — a placa precisa ficar
  // ENTRE a alavanca e a parede de verdade, não do lado de dentro da sala.
  leverPlate.position.set(purgeLeverPosition.x - 0.07, LEVER_MOUNT_Y + 0.35, purgeLeverPosition.z);
  scene.add(leverPlate);

  const purgeLeverLight = new THREE.PointLight(0x3fb8ff, 1.0, 2.6);
  purgeLeverLight.position.set(purgeLeverPosition.x + 0.6, 1.6, purgeLeverPosition.z);
  scene.add(purgeLeverLight);

  const centerLever = createLeverSwitch({
    scene,
    position: new THREE.Vector3(purgeLeverPosition.x, LEVER_MOUNT_Y, purgeLeverPosition.z),
    rotationY: layout.stations.purgeLever.rotationY,
    requiredPulls: 3,
    onComplete: () => scanner.purgeOverheat(),
  });
  // `let`, não `const`: resetRound (loop contínuo entre fases) troca por
  // uma instância nova a cada rodada continuada, pra zerar score/deathsCaused/
  // bombLog sem precisar de um reset() dedicado nesse módulo tão pequeno.
  let scoreManager = createScoreManager();
  const conveyor = createConveyor({
    scene,
    position: layout.stations.conveyor.position,
    rotationY: layout.stations.conveyor.rotationY,
    wallRunLength: layout.stations.conveyor.wallRunLength,
    grabSystem,
    onDeliver: (bombId, wasCorrect) => {
      scoreManager.recordDelivery(bombId, wasCorrect);
      updateDeliveryCounterPanel();
      const index = bombs.findIndex((bomb) => bomb.id === bombId);
      if (index !== -1) bombs.splice(index, 1);
      bombFlow.notifyDelivered();
      emit('bombDelivered', bombId, wasCorrect);
      if (tutorialStep === 'conveyor' && bombId === tutorialBombId) {
        tutorialBomb = null;
        showTutorialStep('done');
      }
    },
    onIncorrectDelivery: () => {
      bombExplosionSfx.play();
      cameraShake.trigger();
    },
    cartHitRadius: difficulty.cartHitRadius,
    cartCycleSpeed: difficulty.cartCycleSpeed,
  });

  const defuseTable = createDefuseTable({
    scene,
    position: layout.stations.defuseTable.position,
    rotationY: layout.stations.defuseTable.rotationY,
    grabSystem,
    teleport,
    pincers,
    screwdriver,
    // `trashBin` só é declarada mais abaixo (usa a posição da própria mesa),
    // mas esse callback só roda em tempo de jogo, bem depois de tudo já
    // montado — mesmo padrão já usado em onLeverPulled do dispenser com
    // `bombFlow`, ver comentário lá.
    onCoreExposed: (coreObject) => trashBin.watchCore(coreObject),
    // Tutorial guiado da primeira bomba (game.js#showTutorialStep) — precisa
    // saber SE a bomba que entrou no modo é a que está acompanhando (não só
    // que "alguma bomba" entrou), por isso defuseTable.js repassa `bomb`
    // junto do booleano.
    onModeChange: (isActive, enteredBomb) => {
      if (isActive && enteredBomb?.id === tutorialBombId && (tutorialStep === 'scanner' || tutorialStep === 'defuseApproach')) {
        showTutorialStep('wire');
      }
      if (!isActive && tutorialStep === 'exitMode') {
        showTutorialStep('conveyor');
      }
    },
  });

  // Lixeira de descarte do núcleo/bateria — antes vivia dentro do duto da
  // esteira (conveyor.js), migrada pra uma estação própria ao lado da mesa
  // de desarme, pra não obrigar o jogador a atravessar a sala só pra
  // descartar. "Direita" aqui é do ponto de vista de quem se aproxima da
  // mesa vindo do centro da sala: ela fica na parede leste com a face
  // voltada pra -X (WALL_ROTATIONS.east, roomLayout.js), então o jogador
  // olha pra +X — nessa orientação, a mão direita aponta para +Z.
  const trashBin = createTrashBin({
    scene,
    position: new THREE.Vector3(
      layout.stations.defuseTable.position.x,
      0,
      layout.stations.defuseTable.position.z + 1.05
    ),
    rotationY: layout.stations.defuseTable.rotationY,
    grabSystem,
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
    controller.addEventListener('selectstart', () => defuseTable.handleTrigger(controller));
    // reportPanel só age se o painel estiver visível (round congelado) e
    // algum botão estiver com hover — não conflita com defuseTable acima
    // (que só age se `mode` estiver ativo, nunca os dois ao mesmo tempo).
    controller.addEventListener('selectstart', () => reportPanel.handleTrigger(controller));
  });

  const reportPanel = createReportPanel(camera, controllers);
  const tutorialGuide = createTutorialGuide({ scene, camera });
  const tensionCue = createTensionCue();
  // Ambiente contínuo de fundo (game-3d/src/assets/background) — start/stop
  // ligados ao contrato start()/pause() do próprio game, ver mais abaixo;
  // toca a sessão inteira, sem reiniciar entre rodadas continuadas
  // (resetRound não toca nisso de propósito).
  const backgroundMusic = createBackgroundMusic({ listener: audioListener });

  // Extraído do callback onRoundEnd do roundTimer (era inline) — o fluxo de
  // morte instantânea (triggerGameOver, mais abaixo) também encerra a
  // rodada pelo mesmo caminho quando o jogador morre 2x sem sair da salinha
  // de reanimação, então os dois gatilhos (timer oculto zerado / game over
  // por morte) precisam do mesmo comportamento de fim de rodada.
  function finishRound() {
    running = false;
    tensionCue.stop();

    // Progressão de fase persistente (currentPhase/highestPhaseUnlocked na
    // API) — só qualifica quando o placar do turno bate o `scoreToAdvance`
    // da fase atual (null na última fase = teto, nunca avança sozinho).
    // Emitido incondicionalmente ao qualificar, independente do jogador
    // escolher "avançar" ou "jogar de novo" no painel abaixo — passar do
    // threshold já desbloqueia a próxima fase pra sempre (highestPhaseUnlocked
    // só cresce), mesmo que ele opte por continuar treinando a fase atual.
    const canAdvance =
      difficulty.scoreToAdvance !== null &&
      scoreManager.score >= difficulty.scoreToAdvance &&
      currentPhase < MAX_PHASE;
    const nextPhase = currentPhase + 1;

    // Painel interativo (reportPanel.js) — loop contínuo entre fases: o
    // jogador escolhe dentro da própria sessão WebXR, sem sair do headset
    // (ver comentário no topo do arquivo e resetRound/handleContinue/
    // handleExit mais abaixo).
    reportPanel.show(scoreManager.score, scoreManager.deathsCaused, scoreManager.playerDeaths, scoreManager.bombLog, {
      canAdvance,
      nextPhase,
      onAdvance: () => handleContinue(nextPhase),
      onReplay: () => handleContinue(currentPhase),
      onExit: handleExit,
    });

    emit('roundEnd', scoreManager.score, scoreManager.deathsCaused);
    if (canAdvance) emit('phaseUnlocked', nextPhase);
  }

  const roundTimer = createRoundTimer({
    onTensionStart: () => tensionCue.start(),
    onRoundEnd: finishRound,
  });

  // Extraído em função (não uma única const) porque resetRound precisa
  // recriar o bombFlow do zero pra fase nova a cada rodada continuada —
  // bombFlow.js não guarda recurso nenhum do Three.js, então recriar é mais
  // simples e seguro que expor um setDifficulty() pra 3 números.
  function buildBombFlow(diff) {
    return createBombFlow({
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
        if (tutorialStep === 'dispenser' && tutorialBombId === null) {
          tutorialBombId = bomb.id;
          tutorialBomb = bomb;
          showTutorialStep('scanner');
        }
      },
      onReady: () => {
        dispenser.setArmed(true);
        queueFullPanel.mesh.visible = false;
      },
      getPendingCount: () => bombs.filter((bomb) => !bomb.delivered).length,
      onQueueFull: () => {
        queueFullPanel.mesh.visible = true;
      },
      spawnIntervalSeconds: diff.spawnIntervalSeconds,
      leverGraceSeconds: diff.leverGraceSeconds,
      maxPending: diff.maxPending,
    });
  }
  // `let`: resetRound reatribui pra uma instância nova (fase/dificuldade
  // nova) a cada rodada continuada.
  let bombFlow = buildBombFlow(difficulty);

  // Descarta um Object3D inteiro (geometria + material de toda malha
  // filha) — usado só por resetRound abaixo pra limpar panfleto/núcleo que
  // sobreviveram à bomba original (rearPanelModule.js/pamphlet.js NÃO os
  // descartam de propósito, ver comentário em rearPanelModule.js#dispose;
  // aqui é justamente o lugar que precisa fazer essa faxina, porque loop
  // contínuo entre fases significa que o WebGL context nunca é recriado
  // entre rodadas como acontecia antes via reload de página).
  function disposeObject3D(object) {
    object.traverse((child) => {
      if (!child.isMesh) return;
      child.geometry?.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        // `.map` cobre o CanvasTexture do panfleto (textPanel.js) — só
        // descartar o material deixaria a textura (e o <canvas> por trás
        // dela) vazando na GPU a cada panfleto de rodadas anteriores.
        material?.map?.dispose();
        material?.dispose();
      });
    });
  }

  // Remove uma bomba da cena/grabSystem/array `bombs` e descarta seus
  // recursos — usado tanto por resetRound (descarta toda bomba não
  // entregue da rodada anterior) quanto pelo fusível zerado em animate()
  // (a bomba "explode" e some, ver triggerPlayerDeath). NÃO mexe no núcleo
  // exposto (`bomb.rearPanelModule.coreObject`) mesmo se `bomb.coreExposed`
  // — motivo já documentado em rearPanelModule.js#dispose (o núcleo pode ter
  // sido separado da bomba e seguir vivo na cena/na mão do jogador). Antes
  // este bloco arrancava o núcleo de qualquer jeito, inclusive da MÃO do
  // jogador se ele estivesse carregando o núcleo no exato momento em que o
  // fusível desta bomba zerasse — dois donos (aqui e trashBin.js) disputando
  // o mesmo objeto (achado do teste completo de fluxos, 2026-09-22, ver
  // game-3d/instrucao.md seção 15). Agora trashBin.js é o único dono do
  // núcleo desde que ele é exposto (`watchCore`, chamado por
  // defuseTable.js#onCoreExposed) até ele ser descartado de verdade
  // (jogado na lixeira) ou até `trashBin.reset()` varrer o que sobrou no
  // fim da rodada — nunca mais por aqui.
  function disposeBomb(bomb) {
    grabSystem.unregister(bomb.group);
    if (bomb.pamphletGroup) {
      grabSystem.unregister(bomb.pamphletGroup);
      bomb.pamphletGroup.parent?.remove(bomb.pamphletGroup);
      disposeObject3D(bomb.pamphletGroup);
    }
    bomb.group.parent?.remove(bomb.group);
    bomb.dispose();
  }

  // Reinicia a rodada em memória, sem recriar renderer/sessão/sala (loop
  // contínuo entre fases, ver comentário no topo do arquivo) — chamado só
  // por handleContinue abaixo. `newPhase` já vem calculado por quem chamou
  // (currentPhase pra "jogar de novo", currentPhase+1 pra "avançar").
  function resetRound(newPhase) {
    currentPhase = clampPhase(newPhase);
    difficulty = getDifficultyConfig(currentPhase);
    const thresholds = computeThresholds(difficulty);

    // Força sair do modo de desarme (mesmo caminho do botão físico da mesa)
    // se o timer zerou com uma bomba ainda ativa lá — sem isso o teleporte
    // ficaria travado pra sempre na rodada nova.
    if (defuseTable.isActive) defuseTable.exitMode();

    // Mesma ideia da guarda acima, mas pro fluxo de morte instantânea: sem
    // isso uma rodada nova podia começar com a tela preta presa ou a porta
    // da salinha de reanimação aberta por causa da rodada anterior.
    resetDeathSequence();

    // Solta qualquer coisa que ainda esteja na mão (bomba, panfleto,
    // ferramenta) ANTES de descartar bombas — evita mexer em objetos ainda
    // presos a um controller.
    grabSystem.releaseAll();

    // Descarta toda bomba não entregue da rodada anterior — incluindo o
    // panfleto, mesmo que já tenha sido separado da bomba original (ver
    // disposeObject3D acima). O núcleo NÃO é tratado aqui (ver
    // disposeBomb) — `trashBin.reset()`, logo abaixo, é quem varre qualquer
    // núcleo exposto que tenha sobrado da rodada anterior.
    while (bombs.length) {
      disposeBomb(bombs.pop());
    }

    dispenser.reset();
    dispenser.setDifficulty(thresholds);
    scanner.reset();
    conveyor.reset({ cartHitRadius: difficulty.cartHitRadius, cartCycleSpeed: difficulty.cartCycleSpeed });
    trashBin.reset();
    centerLever.reset();
    queueFullPanel.mesh.visible = false;

    scoreManager = createScoreManager();
    updateDeliveryCounterPanel();
    bombFlow = buildBombFlow(difficulty);
    bombFlow.start();

    roundTimer.reset();
    reportPanel.hide();

    // O tutorial guiado é só da PRIMEIRA bomba da sessão — nunca deveria
    // reaparecer numa rodada continuada. Salvaguarda pro caso raro de o
    // timer zerar com o tutorial ainda ativo (jogador muito lento na bomba
    // 1): força pra "done" em vez de deixar a seta apontando pra uma bomba
    // que resetRound acabou de descartar.
    if (tutorialStep !== 'done') {
      tutorialStep = 'done';
      tutorialBomb = null;
      tutorialGuide.hide();
    }

    running = true;
  }

  // Jogador escolheu "avançar"/"jogar de novo" no painel de fim de turno —
  // continua na MESMA sessão WebXR, sem navegar. main.js persiste o
  // resultado da rodada que acabou de terminar (POST /api/scores) e o
  // avanço de fase, se houver (PATCH /api/progress), direto via
  // game-3d/src/apiClient.js — best-effort, não bloqueia a rodada nova.
  function handleContinue(newPhase) {
    resetRound(newPhase);
    emit('roundContinue', newPhase);
  }

  // Jogador escolheu "sair pro menu" — único caminho que ainda navega pra
  // fora da sessão WebXR, exatamente como o antigo roundEnd fazia sozinho
  // antes do loop contínuo existir (ver main.js).
  function handleExit() {
    reportPanel.hide();
    emit('roundExit');
  }

  // Morte instantânea + salinha de reanimação: consequência real pro
  // fusível de uma bomba chegar a zero (antes só alimentava o alarme
  // sonoro/háptico de proximityAlarm.js, sem efeito nenhum). Gatilho é SÓ
  // fusível zerado (entrega incorreta continua só com o efeito que já tinha,
  // ver onIncorrectDelivery do conveyor acima) e mata não importa a
  // distância até a bomba (sala fechada). Máquina de estados simples, sem
  // setTimeout — atualizada em updateDeathSequence, chamada todo frame de
  // animate() (mesmo padrão de acumulador de dispenser.js/bombFlow.js).
  const BLACKOUT_SECONDS = 2.5; // placeholder, ajustável por playtesting
  const REVIVE_FADE_SECONDS = 1.5; // placeholder — câmera volta ao normal aos poucos
  const GAME_OVER_HOLD_SECONDS = 3; // placeholder — tempo com a mensagem de game over na tela
  // Mais forte que o tremor padrão de entrega incorreta (cameraShake.trigger()
  // sem argumentos, ver conveyor.js#onIncorrectDelivery) — a bomba "explode"
  // bem mais perto do jogador dessa vez (o fusível zerou em algum lugar da
  // sala, não do outro lado da esteira).
  const DEATH_SHAKE_INTENSITY = 0.09;
  const DEATH_SHAKE_DURATION = 0.8;

  // `insideRespawnRoom`: true do momento da morte até o jogador teleportar
  // de volta pro jogo — é a janela de risco de "game over" (2ª explosão
  // enquanto ainda dentro da salinha). `deathPhase` só controla a animação
  // do blackout/revive dentro dessa janela.
  let insideRespawnRoom = false;
  let deathPhase = 'none'; // 'none' | 'blackout' | 'gameOverHold'
  let deathTimer = 0;

  function triggerPlayerDeath() {
    if (insideRespawnRoom) {
      triggerGameOver();
      return;
    }

    insideRespawnRoom = true;
    deathPhase = 'blackout';
    deathTimer = BLACKOUT_SECONDS;

    grabSystem.releaseAll();
    if (defuseTable.isActive) defuseTable.exitMode();
    teleport.lock();
    scoreManager.recordPlayerDeath();
    bombExplosionSfx.play();
    cameraShake.trigger(DEATH_SHAKE_INTENSITY, DEATH_SHAKE_DURATION);
    screenFade.snapOpaque();
  }

  function triggerGameOver() {
    // Idempotente enquanto o hold já está rodando — achado do reteste
    // desta mesma correção (2026-09-22): sem essa guarda, uma 3ª/4ª bomba
    // explodindo DURANTE os `GAME_OVER_HOLD_SECONDS` (o jogador continua
    // "insideRespawnRoom" até escolher continuar no painel final, então
    // qualquer explosão nesse meio tempo cai aqui de novo) reiniciava o
    // hold do zero e contava outra morte a cada vez — "SUAS MORTES" subia
    // sem limite em vez de parar em 2 (a revivida + a fatal).
    if (deathPhase === 'gameOverHold') return;

    deathPhase = 'gameOverHold';
    deathTimer = GAME_OVER_HOLD_SECONDS;
    grabSystem.releaseAll();
    teleport.lock();
    // Achado do teste completo de fluxos (2026-09-22, ver
    // game-3d/instrucao.md seção 15): antes só triggerPlayerDeath() contava
    // uma morte — uma partida que terminasse em game over mostrava
    // "SUAS MORTES: 1" no relatório final mesmo já tendo matado o jogador
    // 2 vezes (a revivida + a fatal). Contar as duas aqui bate com o que o
    // jogador de fato viveu.
    scoreManager.recordPlayerDeath();
    bombExplosionSfx.play();
    cameraShake.trigger(DEATH_SHAKE_INTENSITY, DEATH_SHAKE_DURATION);
    screenFade.snapOpaque();
    screenFade.showGameOverText(['MAQUINA DE REANIMACAO DESTRUIDA', 'FIM DE JOGO']);
  }

  // Chamada todo frame de dentro do `if (running)` de animate() — o fade/
  // texto de game over continua avançando via screenFade.update() separado
  // (chamado incondicionalmente, ver animate() mais abaixo), mas a máquina
  // de estados em si só avança enquanto a rodada está rolando (não faz
  // sentido morrer depois que o timer oculto já encerrou a rodada).
  function updateDeathSequence(dt) {
    if (deathPhase === 'blackout') {
      deathTimer -= dt;
      if (deathTimer <= 0) {
        player.position.set(respawnRoom.machinePosition.x, player.position.y, respawnRoom.machinePosition.z);
        respawnRoom.openDoor();
        teleport.unlock();
        screenFade.fadeTo(0, REVIVE_FADE_SECONDS);
        deathPhase = 'none';
      }
    } else if (deathPhase === 'gameOverHold') {
      deathTimer -= dt;
      if (deathTimer <= 0) {
        deathPhase = 'none';
        screenFade.hideGameOverText();
        finishRound();
        screenFade.fadeTo(0, REVIVE_FADE_SECONDS);
      }
    }

    // Detecta a saída da salinha (só importa enquanto ainda há risco de
    // game over, ver triggerPlayerDeath) — fecha a porta sozinha, sem
    // interação manual do jogador (pedido do usuário).
    if (insideRespawnRoom && deathPhase === 'none' && !respawnRoom.containsPoint(player.position)) {
      insideRespawnRoom = false;
      respawnRoom.closeDoor();
    }
  }

  // Reseta qualquer sequência de morte em andamento — chamado por
  // resetRound (loop contínuo entre fases) pra garantir que uma rodada nova
  // nunca começa com a tela preta ou a porta da salinha aberta por causa da
  // rodada anterior.
  function resetDeathSequence() {
    insideRespawnRoom = false;
    deathPhase = 'none';
    deathTimer = 0;
    respawnRoom.closeDoor();
    screenFade.hideGameOverText();
    screenFade.fadeTo(0, 0);
    teleport.unlock();
  }

  // Tutorial guiado da PRIMEIRA bomba da sessão (pedido do usuário): uma
  // seta + texto (tutorialGuide.js) acompanha o jogador pelo fluxo completo
  // — dispenser → scanner → mesa (fio/botão/senha, na ordem que ele for
  // completando, já que os 3 desafios são simultâneos e sem ordem exigida,
  // ver CLAUDE.md "Toda bomba apresenta os 3 tipos de desafio frontais
  // simultaneamente") → sair do modo → esteira. Só acontece UMA vez por
  // sessão (não repete em rodadas continuadas, ver resetRound acima, nem se
  // o jogador pular o scanner pelo atalho permitido — nesse caso o passo
  // 'scanner' simplesmente nunca termina de mostrar e o fluxo pula direto
  // pra 'wire' quando a bomba entra no modo de desarme de qualquer jeito).
  let tutorialStep = 'dispenser';
  let tutorialBombId = null;
  let tutorialBomb = null;
  // "Tentou" (não "acertou") — diferente de wireResult/buttonResult (bomb.js),
  // o código da senha só marca sucesso se estiver CERTO, e o buffer volta a
  // ficar vazio depois de uma tentativa errada (keypadModule.js#pressConfirm).
  // Sem essa flag própria, uma tentativa errada faria o tutorial "esquecer"
  // que o jogador já tentou e apontar pro teclado de novo pra sempre.
  let tutorialKeypadAttempted = false;

  function showTutorialStep(step) {
    tutorialStep = step;
    switch (step) {
      case 'dispenser':
        tutorialGuide.show(dispenser.leverPosition, 'UMA BOMBA ESTA PRONTA - PUXE A ALAVANCA');
        break;
      case 'scanner':
        tutorialGuide.show(scanner.getSlotPosition(), 'LEVE A BOMBA ATE O SCANNER E INSIRA NO SLOT');
        break;
      case 'defuseApproach':
        tutorialGuide.show(defuseTable.getModeButtonPosition(), 'COLOQUE A BOMBA NA MESA E APERTE O BOTAO');
        break;
      case 'wire':
        tutorialGuide.show(
          tutorialBomb.wireModule.group.getWorldPosition(new THREE.Vector3()),
          'APONTE O ALICATE PRO FIO CERTO E APERTE O GATILHO'
        );
        break;
      case 'button':
        tutorialGuide.show(
          tutorialBomb.buttonModule.group.getWorldPosition(new THREE.Vector3()),
          'APERTE O BOTAO CERTO'
        );
        break;
      case 'keypad':
        tutorialGuide.show(
          tutorialBomb.keypadModule.padGroup.getWorldPosition(new THREE.Vector3()),
          'DIGITE A SENHA E CONFIRME NO OK'
        );
        break;
      case 'exitMode':
        tutorialGuide.show(defuseTable.getModeButtonPosition(), 'APERTE O BOTAO DE NOVO PRA SAIR DO MODO');
        break;
      case 'conveyor':
        tutorialGuide.show(
          conveyor.group.localToWorld(new THREE.Vector3(0, 0.6, 0)),
          'ARREMESSE A BOMBA CONTRA O CARRINHO'
        );
        break;
      case 'done':
        tutorialGuide.hide();
        break;
      default:
        break;
    }
  }

  // Chamado todo frame só enquanto tutorialStep é um dos 3 desafios (ver
  // animate() abaixo) — recalcula do zero, a partir do estado real da
  // bomba, qual é o passo "certo" agora, em vez de reagir a eventos numa
  // ordem fixa. Isso cobre naturalmente o jogador resolvendo fora da ordem
  // sugerida (ex.: aperta o botão antes do fio) sem lógica extra: no
  // próximo frame o passo mostrado já reflete o que ainda falta.
  function updateDefuseTutorialSubstep() {
    if (!tutorialBomb) return;
    if (tutorialBomb.keypadModule.inputBuffer.length > 0) tutorialKeypadAttempted = true;

    const { wireResult, buttonResult } = tutorialBomb.results;
    let nextStep;
    if (wireResult === null) nextStep = 'wire';
    else if (buttonResult === null) nextStep = 'button';
    else if (!tutorialKeypadAttempted) nextStep = 'keypad';
    else nextStep = 'exitMode';

    if (nextStep !== tutorialStep) showTutorialStep(nextStep);
  }

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
      // Bomba cujo fusível chega a zero "explode": some da cena e mata o
      // jogador na hora (triggerPlayerDeath) — só UMA morte mesmo se mais de
      // uma zerar no mesmo frame (ex.: fila cheia na caixa de coleta).
      let bombExploded = false;
      for (let i = bombs.length - 1; i >= 0; i--) {
        const bomb = bombs[i];
        bomb.tickTimer(dt);
        if (bomb.fuseRemaining === 0) {
          bombs.splice(i, 1);
          disposeBomb(bomb);
          bombExploded = true;
          // Achado do teste completo de fluxos (2026-09-22, ver
          // game-3d/instrucao.md seção 15): se a bomba que explodiu é a
          // mesma que o tutorial guiado está acompanhando, sem isso a seta
          // ficava presa pra sempre apontando pra uma bomba que não existe
          // mais (só `resetRound`, no limite de RODADA, forçava
          // tutorialStep='done' — não cobria uma bomba individual sumindo
          // no meio da rodada). Mesmo padrão já usado pelo conveyor.js
          // (onDeliver) pra encerrar o tutorial quando a bomba acompanhada
          // sai de cena por outro caminho.
          if (bomb.id === tutorialBombId && tutorialStep !== 'done') {
            tutorialBomb = null;
            showTutorialStep('done');
          }
        }
      }
      if (bombExploded) triggerPlayerDeath();
      proximityAlarm.update(dt, bombs);
      scanner.update(dt, controllerTipPositions, bombs);
      centerLever.update(dt, controllerTipPositions);
      defuseTable.update(dt, controllerTipPositions, bombs);
      trashBin.update();
      conveyor.update(dt, controllerTipPositions, bombs);
      roundTimer.update(dt);
      // Só recalcula enquanto o tutorial guiado está de fato num dos 3
      // desafios simultâneos — fora dessa janela não há nada pra recalcular
      // (ver updateDefuseTutorialSubstep, mais acima).
      if (tutorialStep === 'wire' || tutorialStep === 'button' || tutorialStep === 'keypad') {
        updateDefuseTutorialSubstep();
      }
      tutorialGuide.update(dt);
      updateDeathSequence(dt);
    }
    teleport.update();
    // Depois de teleport.update() de propósito: o shake soma seu próprio
    // offset em cima de qualquer player.position já atualizado neste frame
    // (ver comentário em cameraShake.js sobre o delta reversível).
    cameraShake.update(dt);
    // Fora do `if (running)` de propósito: o fade de volta (revive/game
    // over → relatório) continua animando mesmo depois de finishRound()
    // já ter marcado running=false (ver triggerGameOver/updateDeathSequence).
    respawnRoom.update(dt);
    screenFade.update(dt);
    updateStandingWarning();
    utilityBelt.update();
    hologram.update();
    billboardYaw(deliveryCounterPanel.mesh, camera);
    // Fora do `if (running)`: o painel de fim de turno só fica visível
    // exatamente quando running===false (round congelado), e precisa
    // continuar respondendo à mira/gatilho pro jogador conseguir escolher
    // "avançar"/"jogar de novo"/"sair" (loop contínuo entre fases).
    reportPanel.update();
    grabSystem.update(dt);

    renderer.render(scene, camera);
  }

  function start() {
    if (running) return;
    running = true;
    backgroundMusic.start();
    // hasStarted separa "primeira vez" (monta o renderer/VRButton e o loop
    // de animação) de "retomar depois de pause()" (só volta a atualizar).
    if (!hasStarted) {
      hasStarted = true;
      document.body.appendChild(renderer.domElement);
      document.body.appendChild(VRButton.createButton(renderer));
      renderer.setAnimationLoop(animate);
      bombFlow.start();
      showTutorialStep('dispenser');
    }
  }

  function pause() {
    running = false;
    backgroundMusic.stop();
  }

  return { start, pause, on };
}
