import * as THREE from 'three';

export function createTextPanel({ width = 0.4, height = 0.2, fontSize = 56 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = Math.max(1, Math.round((256 * height) / width));
  const ctx = canvas.getContext('2d');

  const texture = new THREE.CanvasTexture(canvas);
  const geometry = new THREE.PlaneGeometry(width, height);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const mesh = new THREE.Mesh(geometry, material);

  // Aceita uma string (uma linha) ou um array de strings (várias linhas,
  // centralizadas verticalmente) — usado pelo panfleto, que precisa mostrar
  // senha/fio/botão em linhas separadas com texto grande e legível.
  function setText(text, color = '#ffffff', background = '#111111') {
    const lines = Array.isArray(text) ? text : [text];

    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lineHeight = fontSize * 1.2;
    const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, canvas.width / 2, startY + i * lineHeight);
    });

    texture.needsUpdate = true;
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    texture.dispose();
  }

  return { mesh, setText, dispose };
}
