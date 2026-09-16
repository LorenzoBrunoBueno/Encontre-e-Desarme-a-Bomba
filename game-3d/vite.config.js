import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';

// base: '/game/' só no build de produção — scripts/build-static.mjs (na
// raiz do repo) publica este build dentro de dist/game/, então os asset
// paths absolutos precisam apontar pra esse subcaminho. Em dev o server
// continua servindo na raiz (http://localhost:5173/), que é o que
// frontend/js/config.js e game-3d/src/main.js esperam localmente.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/game/' : '/',
  plugins: [mkcert()],
  server: {
    host: true,
    port: 5173,
    // Falha alto (em vez de silenciosamente subir noutra porta) se 5173
    // estiver ocupada — frontend/js/config.js aponta pra essa porta fixa
    // durante dev, então um auto-incremento silencioso quebra o botão
    // "Entrar em VR" sem avisar. Se a porta estiver presa, é sinal de um
    // processo `vite` anterior que não morreu (comum no Windows ao fechar
    // o terminal) — encerre-o em vez de deixar subir noutra porta.
    strictPort: true,
  },
}));
