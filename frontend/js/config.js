// Resolve URLs que dependem de onde o app está rodando. Em produção
// (Azure Static Web Apps), /frontend e /game são publicados sob o mesmo
// domínio via scripts/build-static.mjs — não há CORS a resolver (ver
// CLAUDE.md, seção "Backend e hospedagem"). Em desenvolvimento, o game-3d
// roda no dev server do Vite (porta 5173) enquanto o frontend é servido
// estaticamente noutra porta — por isso os dois lados resolvem essa URL
// de forma independente, sem depender de um build compartilhado.
const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname);

export const API_BASE = '/api';
// https, não http: game-3d/vite.config.js usa vite-plugin-mkcert (WebXR
// exige contexto seguro mesmo em dev), e strictPort garante que a porta
// é sempre 5173 quando o dev server sobe com sucesso.
export const GAME_URL = isLocalDev ? 'https://localhost:5173/' : '/game/';
