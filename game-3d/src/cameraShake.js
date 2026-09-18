import * as THREE from 'three';

const DEFAULT_INTENSITY = 0.05; // deslocamento máximo (m) no pico do tremor
const DEFAULT_DURATION = 0.6; // segundos até o tremor sumir por completo

// Tremedeira de câmera — feedback de "a bomba estourou fora da sala" (ver
// conveyor.js#completeDelivery, disparado via onIncorrectDelivery). Desloca
// o RIG do jogador (`player`), não `camera` direto: dentro de uma sessão XR
// ativa, o three.js sobrescreve a transform LOCAL da câmera a cada frame com
// a pose real do headset (mesmo motivo pelo qual teleport.js já move
// player.position em vez de camera.position — ver comentário do "rig" em
// game.js). Um offset aplicado direto na câmera seria descartado no frame
// seguinte, tanto em VR real quanto no Immersive Web Emulator.
//
// Implementado como delta reversível: a cada update, remove o offset do
// frame anterior antes de somar o novo — assim não importa se outra coisa
// (teleport.js) já mudou player.position no mesmo frame, o shake só soma/
// tira a própria contribuição em cima do que já está lá, sem "brigar" pela
// posição base do jogador.
export function createCameraShake({ player }) {
  const currentOffset = new THREE.Vector3();
  let remaining = 0;
  let duration = DEFAULT_DURATION;
  let intensity = DEFAULT_INTENSITY;

  function trigger(shakeIntensity = DEFAULT_INTENSITY, shakeDuration = DEFAULT_DURATION) {
    intensity = shakeIntensity;
    duration = shakeDuration;
    remaining = shakeDuration;
  }

  function update(dt) {
    player.position.sub(currentOffset);

    if (remaining > 0) {
      remaining = Math.max(0, remaining - dt);
      // Cai linearmente até zero, junto com o tempo restante — o pico do
      // ruído já nasce no disparo, sem um "ataque" gradual, e desliga limpo.
      const falloff = remaining / duration;
      currentOffset.set(
        (Math.random() * 2 - 1) * intensity * falloff,
        (Math.random() * 2 - 1) * intensity * falloff,
        (Math.random() * 2 - 1) * intensity * falloff
      );
    } else {
      currentOffset.set(0, 0, 0);
    }

    player.position.add(currentOffset);
  }

  return { trigger, update };
}
