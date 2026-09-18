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
import { createTrashBin } from './trashBin.js';
import { createDoor } from './door.js';
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
import { createReportPanel } from './reportPanel.js';
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

  // Porta de entrada/saída da sala, centrada na parede sul (a única sem
  // estação) — por ora só decorativa; um fluxo real de entrada/saída
  // (spawn do jogador, abrir/fechar) fica pra uma etapa futura.
  // Posição em WALL_INNER_Z (face interna da parede, não o centro dela) —
  // mesmo motivo do comentário acima; door.js usa deslocamentos locais
  // pequenos (0.02 a 0.09) pra protuberância da porta/moldura A PARTIR
  // dessa face, não a partir do centro da parede.
  createDoor({
    scene,
    position: new THREE.Vector3(0, 0, WALL_INNER_Z),
    rotationY: Math.PI,
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
      const index = bombs.findIndex((bomb) => bomb.id === bombId);
      if (index !== -1) bombs.splice(index, 1);
      bombFlow.notifyDelivered();
      emit('bombDelivered', bombId, wasCorrect);
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
  const tensionCue = createTensionCue();
  const roundTimer = createRoundTimer({
    onTensionStart: () => tensionCue.start(),
    onRoundEnd: () => {
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
      reportPanel.show(scoreManager.score, scoreManager.deathsCaused, scoreManager.bombLog, {
        canAdvance,
        nextPhase,
        onAdvance: () => handleContinue(nextPhase),
        onReplay: () => handleContinue(currentPhase),
        onExit: handleExit,
      });

      emit('roundEnd', scoreManager.score, scoreManager.deathsCaused);
      if (canAdvance) emit('phaseUnlocked', nextPhase);
    },
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

    // Solta qualquer coisa que ainda esteja na mão (bomba, panfleto,
    // ferramenta) ANTES de descartar bombas — evita mexer em objetos ainda
    // presos a um controller.
    grabSystem.releaseAll();

    // Descarta toda bomba não entregue da rodada anterior — incluindo
    // panfleto/núcleo mesmo que já tenham sido separados da bomba original
    // (ver disposeObject3D acima).
    while (bombs.length) {
      const bomb = bombs.pop();
      grabSystem.unregister(bomb.group);
      if (bomb.pamphletGroup) {
        grabSystem.unregister(bomb.pamphletGroup);
        bomb.pamphletGroup.parent?.remove(bomb.pamphletGroup);
        disposeObject3D(bomb.pamphletGroup);
      }
      if (bomb.coreExposed) {
        const core = bomb.rearPanelModule.coreObject;
        grabSystem.unregister(core);
        core.parent?.remove(core);
        disposeObject3D(core);
      }
      bomb.group.parent?.remove(bomb.group);
      bomb.dispose();
    }

    dispenser.reset();
    dispenser.setDifficulty(thresholds);
    scanner.reset();
    conveyor.reset({ cartHitRadius: difficulty.cartHitRadius, cartCycleSpeed: difficulty.cartCycleSpeed });
    trashBin.reset();
    centerLever.reset();
    queueFullPanel.mesh.visible = false;

    scoreManager = createScoreManager();
    bombFlow = buildBombFlow(difficulty);
    bombFlow.start();

    roundTimer.reset();
    reportPanel.hide();

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
      trashBin.update();
      conveyor.update(dt, controllerTipPositions, bombs);
      roundTimer.update(dt);
    }
    teleport.update();
    utilityBelt.update();
    hologram.update();
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
