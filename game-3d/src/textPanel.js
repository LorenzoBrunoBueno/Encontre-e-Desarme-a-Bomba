import * as THREE from 'three';

// Resolução do canvas escala com o tamanho FÍSICO do painel (metros), não
// mais um `canvas.width = 256` fixo pra qualquer painel — antes isso dava
// texto nítido só por acaso em painéis pequenos (panfleto) e borrado em
// painéis grandes (holograma, 1.1m de largura com a MESMA resolução de um
// botão de 0.05m). Os dois lados são escalados juntos (nunca só um) pra
// nunca distorcer a proporção largura:altura do plano.
const PIXELS_PER_METER = 480;
const MIN_CANVAS_DIM = 128;
const MAX_CANVAS_DIM = 1024;

function resolveCanvasSize(width, height) {
  let w = width * PIXELS_PER_METER;
  let h = height * PIXELS_PER_METER;

  const largest = Math.max(w, h);
  if (largest > MAX_CANVAS_DIM) {
    const scale = MAX_CANVAS_DIM / largest;
    w *= scale;
    h *= scale;
  }
  const smallest = Math.min(w, h);
  if (smallest < MIN_CANVAS_DIM) {
    const scale = MIN_CANVAS_DIM / smallest;
    w *= scale;
    h *= scale;
    // Corrigir o piso pode ter empurrado o outro lado de volta acima do
    // teto (painéis muito compridos/finos) — reaplica o teto se precisar.
    const largestAfter = Math.max(w, h);
    if (largestAfter > MAX_CANVAS_DIM) {
      const scale2 = MAX_CANVAS_DIM / largestAfter;
      w *= scale2;
      h *= scale2;
    }
  }

  return { canvasWidth: Math.max(1, Math.round(w)), canvasHeight: Math.max(1, Math.round(h)) };
}

function traceRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

// Achata o tamanho de fonte pedido até toda linha caber dentro da área
// disponível (largura E altura, pro log de bombas do relatório final com
// várias linhas) — ANTES não existia nenhum ajuste: uma string mais longa
// que o canvas simplesmente saía cortada nas bordas (achado real, jogador
// bateu nisso em playtest: painéis de parede como "VOCÊ ESTÁ SENDO
// MONITORADO" nunca coube nos 256px fixos de antes). Nunca cai abaixo de
// ~55% do tamanho pedido — melhor ficar pequeno mas legível do que
// desaparecer, e nenhum texto atual do jogo precisa de mais que isso pra
// caber (ver game-3d/instrucao.md).
function fitFontSize(ctx, lines, requestedSize, maxWidth, maxHeight) {
  const minSize = Math.max(8, requestedSize * 0.55);
  let size = requestedSize;

  function fits(candidate) {
    ctx.font = `bold ${candidate}px monospace`;
    const widest = Math.max(...lines.map((line) => ctx.measureText(line).width));
    const blockHeight = lines.length * candidate * 1.2;
    return widest <= maxWidth && blockHeight <= maxHeight;
  }

  while (!fits(size) && size > minSize) size -= 1;
  return size;
}

// Fundo de cada painel — três variantes, escolhidas por quem cria o painel
// (não muda depois, é uma decisão de estilo, não de conteúdo):
//
// - 'glass' (padrão): a mesma linguagem visual do tema "Liquid Glass" do
//   /frontend (frontend/css/liquid-glass.css) portada pra canvas — cantos
//   arredondados, sheen em gradiente, borda com glow na cor do próprio
//   texto (reaproveita `accentColor`, sem precisar de um parâmetro novo).
//   Não existe backdrop-filter de verdade aqui (isso é CSS puro, não roda
//   dentro de uma textura — ver frontend/instrucao.md seção 4), então a
//   base já nasce quase opaca pra compensar; o efeito é visual, não uma
//   transparência real do que está atrás do painel. Usado por padrão em
//   todo painel "de sala/menu" (paredes, porta, scanner, holograma, fila
//   cheia, relatório final).
// - 'paper': fundo claro e chapado, cantos só levemente arredondados, borda
//   fina quente em vez de glow — mantém a leitura de "folha impressa" do
//   panfleto (CLAUDE.md pede texto grande e legível na mão, não uma HUD).
// - 'flat': comportamento ORIGINAL (retângulo reto, sem cantos nem glow) —
//   usado só pelas teclas do teclado numérico (keypadModule.js), que são
//   rótulos gravados na própria peça física do teclado, não um "menu"; não
//   faria sentido de repente ficarem com vidro/glow.
function drawBackground(ctx, w, h, style, background, accentColor) {
  ctx.clearRect(0, 0, w, h);

  if (style === 'flat') {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, w, h);
    return;
  }

  if (style === 'paper') {
    const radius = Math.min(w, h) * 0.05;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = h * 0.06;
    ctx.shadowOffsetY = h * 0.025;
    traceRoundedRect(ctx, 0, 0, w, h, radius);
    ctx.fillStyle = background;
    ctx.fill();
    ctx.restore();

    traceRoundedRect(ctx, 1, 1, w - 2, h - 2, radius);
    ctx.strokeStyle = 'rgba(70, 50, 20, 0.28)';
    ctx.lineWidth = Math.max(1, h * 0.006);
    ctx.stroke();
    return;
  }

  // 'glass'
  const radius = Math.min(w, h) * 0.14;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = h * 0.08;
  ctx.shadowOffsetY = h * 0.03;
  traceRoundedRect(ctx, 0, 0, w, h, radius);
  ctx.fillStyle = '#14181cf2';
  ctx.fill();
  ctx.restore();

  const sheen = ctx.createLinearGradient(0, 0, 0, h);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
  sheen.addColorStop(0.45, 'rgba(255, 255, 255, 0.02)');
  sheen.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
  traceRoundedRect(ctx, 0, 0, w, h, radius);
  ctx.fillStyle = sheen;
  ctx.fill();

  const borderWidth = Math.max(2, h * 0.018);
  traceRoundedRect(ctx, borderWidth / 2, borderWidth / 2, w - borderWidth, h - borderWidth, radius);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = borderWidth;
  ctx.save();
  ctx.shadowColor = accentColor;
  ctx.shadowBlur = h * 0.05;
  ctx.stroke();
  ctx.restore();

  // Linha de brilho fina logo abaixo da borda superior — mesmo efeito do
  // "inset 0 1px 1px rgba(255,255,255,0.2)" do liquid-glass.css.
  ctx.beginPath();
  ctx.moveTo(radius, borderWidth + 1);
  ctx.lineTo(w - radius, borderWidth + 1);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.lineWidth = Math.max(1, h * 0.006);
  ctx.stroke();
}

export function createTextPanel({ width = 0.4, height = 0.2, fontSize = 56, style = 'glass' } = {}) {
  const { canvasWidth, canvasHeight } = resolveCanvasSize(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
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

    drawBackground(ctx, canvas.width, canvas.height, style, background, color);

    const maxWidth = canvas.width * 0.86;
    const maxHeight = canvas.height * 0.82;
    const finalSize = fitFontSize(ctx, lines, fontSize, maxWidth, maxHeight);

    ctx.font = `bold ${finalSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    if (style !== 'flat') {
      // Sombra por trás do texto — o fundo deixou de ser um bloco liso
      // uniforme (gradiente/sheen), então o texto precisa da própria
      // garantia de contraste em vez de depender só do fundo.
      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = finalSize * 0.1;
    }

    const lineHeight = finalSize * 1.2;
    const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, canvas.width / 2, startY + i * lineHeight);
    });
    ctx.shadowBlur = 0;

    texture.needsUpdate = true;
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    texture.dispose();
  }

  return { mesh, setText, dispose };
}

const billboardScratch = new THREE.Vector3();

// Gira `mesh` (um painel de createTextPanel, direto na raiz da scene) só no
// YAW pra sempre encarar a câmera — mesma técnica usada por
// hologramDisplay.js, extraída pra reaproveitar em qualquer painel "preso
// perto do teto, legível de qualquer estação da sala" (billboard completo
// inclinaria o painel de um jeito estranho quando o jogador olha pra cima/
// baixo, por isso a altura Y da câmera é travada na do próprio painel antes
// do lookAt).
export function billboardYaw(mesh, camera) {
  camera.getWorldPosition(billboardScratch);
  billboardScratch.y = mesh.position.y;
  mesh.lookAt(billboardScratch);
}
