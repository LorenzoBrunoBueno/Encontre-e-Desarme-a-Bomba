#!/usr/bin/env node
// Combina /frontend (estático, sem build) e o build do /game-3d (Vite) num
// único diretório /dist, pra publicar como um só Azure Static Web App —
// ver frontend/instrucao.md pro porquê de não usar um bundler único pras
// duas pastas.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(rootDir, 'dist');
const frontendDir = path.join(rootDir, 'frontend');
const gameDir = path.join(rootDir, 'game-3d');

console.log('[build-static] limpando dist/...');
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

console.log('[build-static] copiando frontend/ -> dist/...');
cpSync(frontendDir, distDir, {
  recursive: true,
  // instrucao.md é registro de decisão pra quem desenvolve, não conteúdo
  // do jogo — sem isso, ele vira um arquivo estático público em /instrucao.md
  filter: (src) => path.basename(src) !== 'instrucao.md',
});

console.log('[build-static] instalando e buildando game-3d/...');
execFileSync('npm', ['ci'], { cwd: gameDir, stdio: 'inherit', shell: true });
execFileSync('npm', ['run', 'build'], { cwd: gameDir, stdio: 'inherit', shell: true });

console.log('[build-static] copiando game-3d/dist -> dist/game/...');
cpSync(path.join(gameDir, 'dist'), path.join(distDir, 'game'), { recursive: true });

console.log('[build-static] pronto: dist/ contém frontend + dist/game/ contém a cena WebXR.');
