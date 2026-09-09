import * as THREE from 'three';

// Textura procedural de listras diagonais (estilo alerta industrial), gerada
// via canvas — mesma técnica de textPanel.js, reaproveitada aqui para dar
// detalhe de superfície (dispenser, esteira) sem precisar de arquivos de
// imagem externos. wrapS/wrapT em RepeatWrapping permite ladrilhar a textura
// numa superfície maior via material.map.repeat, e animar como uma esteira
// deslocando texture.offset.
export function createStripeTexture({ colorA = '#f2c200', colorB = '#111111', size = 64 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = colorB;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = colorA;
  const stripeWidth = size / 4;
  for (let x = -size; x < size * 2; x += stripeWidth * 2) {
    ctx.save();
    ctx.translate(x, 0);
    ctx.beginPath();
    ctx.moveTo(0, size);
    ctx.lineTo(stripeWidth, size);
    ctx.lineTo(stripeWidth + size, 0);
    ctx.lineTo(size, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}
