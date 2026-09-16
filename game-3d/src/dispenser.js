import * as THREE from 'three';
import { createBomb, BOMB_FUSE_SECONDS } from './bomb.js';
import { createStripeTexture } from './stripeTexture.js';
import { createLeverSwitch } from './leverSwitch.js';
import { CEILING_HEIGHT, ROOM_CEILING_Y } from './roomLayout.js';

const CHUTE_EXIT_HEIGHT = CEILING_HEIGHT - 0.56;
const FALL_DURATION = 0.6;
const BLINK_SPEED = 6;
// Empilhamento de bombas na caixa de coleta (RoomRefactor item 2): sem
// motor de física, cada bomba nova pousa um degrau acima da anterior que
// ainda esteja "descansando" na caixa (não pega/entregue), com um pequeno
// jitter de posição/rotação — evita a sobreposição exata no mesmo ponto que
// existia antes (landingPosition fixo pra toda bomba).
const STACK_HEIGHT_STEP = 0.2;
const STACK_JITTER_XZ = 0.06;
const STACK_JITTER_ROT = 0.3;
// Deslocamento lateral aleatório do ponto de controle da queda — dá a
// trajetória um leve arco (bezier quadrática) em vez de um lerp reto,
// sugerindo o "impulso" de cuspir a bomba, ainda sem gravidade real.
const ARC_LATERAL_OFFSET = 0.12;
// Duração do pulso da luz âmbar na junção duto→bico ao soltar uma bomba
// (RoomRefactor item 1/8) — reusa o mesmo emissive do corpo do dispenser,
// só que disparado no momento da queda, não enquanto "armado".
const JUNCTION_PULSE_DURATION = 0.7;

// Dispenser de teto: o corpo fica fora de alcance (montado no teto), então
// a interação física mora numa alavanca separada, ao nível do chão, perto
// da caixa de coleta (Estação 1 do documento de especificação) — o jogador
// puxa a alavanca (leverSwitch.js) para soltar a bomba armada. QUANDO uma
// bomba fica pronta pra ser solta continua sendo decisão do bombFlow.js
// (`onReady`/`setArmed`); este módulo só anima a queda, avisa quando pousa
// (onBombLanded) e expõe a alavanca + o indicador luminoso de "pronto".
//
// `wallRunLength` (RoomRefactor item 1) é a distância, em Z local, até a
// parede de trás da estação (dispenser fica na parede norte da sala, ver
// roomLayout.js) — o duto horizontal usa esse valor pra terminar exatamente
// na parede, sem precisar hardcodar o inset de roomLayout.js aqui também.
export function createDispenser({
  scene,
  position,
  rotationY = 0,
  landingPosition,
  wallRunLength = 0.55,
  grabSystem,
  onBombLanded,
  onLeverPulled,
}) {
  const group = new THREE.Group();
  group.position.set(position.x, CEILING_HEIGHT, position.z);
  group.rotation.y = rotationY;
  scene.add(group);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.4, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.6, metalness: 0.2 })
  );
  group.add(body);

  // Faixa de alerta industrial na face frontal — decal via textura procedural
  // (mesma técnica de canvas de textPanel.js), sem precisar de imagem externa.
  const stripeTexture = createStripeTexture();
  stripeTexture.repeat.set(4, 1);
  const warningStripe = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.07),
    new THREE.MeshBasicMaterial({ map: stripeTexture })
  );
  warningStripe.position.set(0, 0.05, 0.251);
  group.add(warningStripe);

  // Duto até o teto (RoomRefactor item 1) — antes o corpo ficava pendurado
  // sozinho no ar, sem nenhuma estrutura ligando ele ao teto real (que nem
  // existia). Segmento vertical curto + flange na junção com o teto, mais
  // uma extensão horizontal até a parede de trás, sugerindo uma rede de
  // tubulação vinda de um "estoque de bombas" fora do campo de visão.
  const BODY_TOP_Y = 0.2; // topo do corpo (BoxGeometry altura 0.4, centrado em 0)
  const CEILING_LOCAL_Y = ROOM_CEILING_Y - CEILING_HEIGHT;
  const stubHeight = CEILING_LOCAL_Y - BODY_TOP_Y;

  const ductStub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.1, stubHeight, 12),
    new THREE.MeshStandardMaterial({ color: 0x546e7a, roughness: 0.55, metalness: 0.35 })
  );
  ductStub.position.y = BODY_TOP_Y + stubHeight / 2;
  group.add(ductStub);

  // Flange/braçadeira metálica na junção com o teto — parafusos via pequenos
  // cilindros radiais, greeble barato sem precisar de textura externa.
  const flange = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 0.03, 16),
    new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.4, metalness: 0.6 })
  );
  flange.position.y = CEILING_LOCAL_Y - 0.015;
  group.add(flange);
  const boltGeometry = new THREE.CylinderGeometry(0.012, 0.012, 0.02, 8);
  const boltMaterial = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.7 });
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const bolt = new THREE.Mesh(boltGeometry, boltMaterial);
    bolt.position.set(Math.cos(angle) * 0.12, flange.position.y, Math.sin(angle) * 0.12);
    group.add(bolt);
  }

  // Extensão horizontal do duto até a parede de trás — tom de material
  // levemente diferente do bico/corpo, pra não ler como um bloco extrudado
  // único. Roda o cilindro (eixo padrão Y) 90° em X pra apontar em -Z local.
  const horizontalDuct = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, wallRunLength, 12),
    new THREE.MeshStandardMaterial({ color: 0x607d8b, roughness: 0.6, metalness: 0.3 })
  );
  horizontalDuct.rotation.x = Math.PI / 2;
  horizontalDuct.position.set(0, CEILING_LOCAL_Y - 0.35, -wallRunLength / 2);
  group.add(horizontalDuct);

  // Fita de perigo estendida pelo duto novo (RoomRefactor item 9) — reusa a
  // mesma textura procedural do corpo, só repetida ao longo do cilindro.
  const ductStripeTexture = createStripeTexture();
  ductStripeTexture.repeat.set(1, 3);
  const ductStripe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.083, 0.083, wallRunLength, 12, 1, true),
    new THREE.MeshBasicMaterial({ map: ductStripeTexture, transparent: true })
  );
  ductStripe.rotation.copy(horizontalDuct.rotation);
  ductStripe.position.copy(horizontalDuct.position);
  group.add(ductStripe);

  // Luz âmbar pulsante na junção duto→bico (RoomRefactor itens 1 e 8) — só
  // acende no momento em que uma bomba é solta, não continuamente (isso já
  // é o papel do `armedIndicator` abaixo, que sinaliza "pronta pra soltar").
  const junctionLight = new THREE.PointLight(0xffaa00, 0, 1.6);
  junctionLight.position.y = BODY_TOP_Y + stubHeight * 0.5;
  group.add(junctionLight);
  let junctionPulseElapsed = JUNCTION_PULSE_DURATION;

  function triggerJunctionPulse() {
    junctionPulseElapsed = 0;
  }

  // Funil de transição entre a base quadrada do corpo e a calha circular —
  // antes a calha "grudava" abruptamente no fundo plano do corpo.
  const funnel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.12, 0.12, 16),
    new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.6, metalness: 0.2 })
  );
  funnel.position.y = -0.26;
  group.add(funnel);

  const chute = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.16, 0.24, 16),
    new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.6, metalness: 0.2 })
  );
  chute.position.y = -0.44;
  group.add(chute);

  // Alavanca + indicador ficam no chão, perto da caixa de coleta — não no
  // corpo do dispenser (que está no teto, fora de alcance). Offset local
  // (0.4 pra "direita", 0.35 "pra frente" do jogador) rotacionado pelo mesmo
  // rotationY da estação, pra funcionar em qualquer um dos 4 ângulos fixos
  // do roomLayout.
  const floorOffset = new THREE.Vector3(0.4, 0, 0.35).applyAxisAngle(
    new THREE.Vector3(0, 1, 0),
    rotationY
  );
  const leverPosition = new THREE.Vector3(
    position.x + floorOffset.x,
    0,
    position.z + floorOffset.z
  );
  const lever = createLeverSwitch({
    scene,
    position: leverPosition,
    rotationY,
    requiredPulls: 1,
    onComplete: () => onLeverPulled?.(),
  });

  const armedIndicator = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xffaa00, emissiveIntensity: 0 })
  );
  armedIndicator.position.set(leverPosition.x, 0.55, leverPosition.z);
  scene.add(armedIndicator);

  let armed = false;
  let blinkPhase = 0;

  function setArmed(value) {
    armed = value;
    if (!armed) armedIndicator.material.emissiveIntensity = 0;
  }

  const falling = [];
  // Bombas que já pousaram e ainda não foram pegas — usado só pra decidir a
  // altura de empilhamento da PRÓXIMA queda (item 2), sem nenhum motor de
  // física: cada entrada sai da lista assim que o grabSystem reporta que a
  // bomba foi pega (squeeze), não importa a ordem em que o jogador pega.
  const restingBombs = [];

  function nextLandingTarget() {
    const index = restingBombs.length;
    const jitterX = (Math.random() * 2 - 1) * STACK_JITTER_XZ;
    const jitterZ = (Math.random() * 2 - 1) * STACK_JITTER_XZ;
    return new THREE.Vector3(
      landingPosition.x + jitterX,
      landingPosition.y + index * STACK_HEIGHT_STEP,
      landingPosition.z + jitterZ
    );
  }

  function dropBomb() {
    const bomb = createBomb();
    // Fusível começa a correr assim que a bomba sai do dispenser (documento
    // de especificação, Estação 1) — não quando ela pousa na caixa.
    bomb.startTimer(BOMB_FUSE_SECONDS);
    const from = new THREE.Vector3(position.x, CHUTE_EXIT_HEIGHT, position.z);
    bomb.group.position.copy(from);
    bomb.group.rotation.y = (Math.random() * 2 - 1) * STACK_JITTER_ROT;
    scene.add(bomb.group);
    const to = nextLandingTarget();
    // Ponto de controle deslocado lateralmente (bezier quadrática) — dá à
    // queda um leve arco em vez de um lerp reto, sugerindo o impulso de
    // "cuspir" a bomba (ainda sem gravidade real, só uma curva no tween).
    const lateral = new THREE.Vector3(
      (Math.random() * 2 - 1) * ARC_LATERAL_OFFSET,
      0,
      (Math.random() * 2 - 1) * ARC_LATERAL_OFFSET
    );
    const control = from.clone().lerp(to, 0.5).add(lateral);
    restingBombs.push({ bomb });
    falling.push({ bomb, elapsed: 0, from, to, control });
    triggerJunctionPulse();
    return bomb;
  }

  function updateRestingBombs() {
    for (let i = restingBombs.length - 1; i >= 0; i--) {
      if (grabSystem?.isHeld(restingBombs[i].bomb.group)) restingBombs.splice(i, 1);
    }
  }

  function update(dt, tipPositions) {
    updateRestingBombs();

    if (junctionPulseElapsed < JUNCTION_PULSE_DURATION) {
      junctionPulseElapsed += dt;
      const t = THREE.MathUtils.clamp(junctionPulseElapsed / JUNCTION_PULSE_DURATION, 0, 1);
      junctionLight.intensity = (1 - t) * 1.5;
    }

    for (let i = falling.length - 1; i >= 0; i--) {
      const drop = falling[i];
      drop.elapsed += dt;
      const t = Math.min(drop.elapsed / FALL_DURATION, 1);
      // Bezier quadrática (from → control → to) em vez de lerp reto — ver
      // comentário em dropBomb() sobre o arco de "impulso".
      const ab = drop.from.clone().lerp(drop.control, t);
      const bc = drop.control.clone().lerp(drop.to, t);
      drop.bomb.group.position.lerpVectors(ab, bc, t);
      if (t >= 1) {
        falling.splice(i, 1);
        onBombLanded(drop.bomb);
      }
    }

    lever.update(dt, tipPositions);

    if (armed) {
      blinkPhase += dt * BLINK_SPEED;
      armedIndicator.material.emissiveIntensity = 0.5 + 0.5 * Math.sin(blinkPhase);
    }
  }

  return { group, dropBomb, update, setArmed };
}
