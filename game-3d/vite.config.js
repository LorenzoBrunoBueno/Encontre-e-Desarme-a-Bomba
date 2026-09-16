import { defineConfig } from 'vite';

// base: '/game/' só no build de produção — scripts/build-static.mjs (na
// raiz do repo) publica este build dentro de dist/game/, então os asset
// paths absolutos precisam apontar pra esse subcaminho. Em dev o server
// continua servindo na raiz (http://localhost:5173/), que é o que
// frontend/js/config.js e game-3d/src/main.js esperam localmente.
//
// vite-plugin-mkcert só existe pra dar HTTPS ao dev server local (WebXR
// exige contexto seguro mesmo em dev) — não tem nenhum uso num `vite build`
// (gera um certificado local, sem sentido num build estático). Por isso o
// import é dinâmico e só acontece em modo dev (`command === 'serve'`): um
// `import` estático no topo do arquivo seria avaliado sempre que o Vite
// carrega este config, mesmo em build — e uma dependência transitiva do
// mkcert (undici) usa uma API interna do Node só disponível a partir da
// v22, o que quebrava `vite build` no runner de CI (Node 20).
export default defineConfig(async ({ command }) => {
  const plugins = [];
  if (command === 'serve') {
    const { default: mkcert } = await import('vite-plugin-mkcert');
    plugins.push(mkcert());
  }

  return {
    base: command === 'build' ? '/game/' : '/',
    plugins,
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
  };
});
