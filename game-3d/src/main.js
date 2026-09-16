import { createGame } from './game.js';

// Integração com o /frontend (2D) — ver CLAUDE.md, seção "Contrato de
// eventos entre Frontend e Cena 3D", e frontend/instrucao.md pro porquê da
// navegação real de página (em vez de SPA) entre as duas pastas.
//
// "defuse:playerId" e "defuse:pendingResult" no localStorage são o único
// contrato entre este arquivo e frontend/js/session.js e
// frontend/js/report.js — o nome das chaves não pode mudar de um lado sem
// mudar do outro.
const PLAYER_ID_KEY = 'defuse:playerId';
const PENDING_RESULT_KEY = 'defuse:pendingResult';

// Em produção (build via `vite build`, publicado em /game pelo
// scripts/build-static.mjs) o frontend fica na raiz do mesmo domínio — por
// isso "/" e não uma URL com host/porta adivinhados. Tentativa anterior
// (adivinhar "http://localhost:5500" checando location.hostname) quebrava
// sempre que a página era aberta por um endereço que não fosse exatamente
// "localhost"/"127.0.0.1" — inclusive o próprio dev server do Vite acessado
// pela URL de rede/LAN que ele imprime (o jeito normal de testar direto do
// Quest 3, ver CLAUDE.md "Testar no Quest 3").
const FRONTEND_URL = '/';

// import.meta.env.DEV é true rodando via `vite`/`npm run dev` (local ou
// pela URL de rede que o Vite imprime) e false num build de produção de
// verdade — sinal muito mais confiável do que tentar adivinhar isso a
// partir do hostname. Iterar em game-3d isoladamente (só `npm run dev`, sem
// tocar no /frontend) é o loop de teste rápido recomendado pelo CLAUDE.md
// ("Immersive Web Emulator... evita o ciclo lento de build → headset →
// testar") — mantido de propósito, mesmo depois da integração com o
// frontend: sem playerId salvo, o dev server usa um id local só pra essa
// sessão em vez de bloquear a cena. Só um build de produção de verdade
// exige login de verdade, sem esse fallback.
const isDevServer = import.meta.env.DEV;
const storedPlayerId = localStorage.getItem(PLAYER_ID_KEY);
const hasRealSession = Boolean(storedPlayerId);
const playerId = storedPlayerId || (isDevServer ? 'dev-local-player' : null);

if (!playerId) {
  // Só chega aqui num build de produção sem sessão real (em dev,
  // isDevServer já garante um playerId acima). Mostra um aviso em vez de
  // redirecionar automaticamente: um location.href aqui pode virar loop
  // infinito se este arquivo acabar sendo servido no mesmo endereço
  // apontado por FRONTEND_URL, fazendo cada carga voltar a achar nenhum
  // playerId e se redirecionar de novo pra si mesma.
  document.body.innerHTML = `
    <div style="height:100%; display:flex; align-items:center; justify-content:center; padding:24px; text-align:center;">
      <div style="color:#eee; font-family:system-ui,sans-serif; max-width:420px;">
        <p>Nenhum jogador identificado — entre pelo menu antes de abrir a cena.</p>
        <a href="${FRONTEND_URL}" style="color:#f0a63a;">Ir para o menu</a>
      </div>
    </div>
  `;
} else {
  if (!hasRealSession) {
    console.log(
      `[dev] nenhum playerId no localStorage — usando "${playerId}" só pra esta sessão de teste local.`
    );
  }

  const game = createGame();

  game.on('bombDispensed', (bombId) => {
    console.log(`Bomba ${bombId} liberada pelo dispenser`);
  });
  game.on('bombScanned', (bombId) => {
    console.log(`Bomba ${bombId} escaneada`);
  });
  game.on('bombDelivered', (bombId, wasCorrect) => {
    void wasCorrect; // resultado só é exibido ao jogador no relatório final (roundEnd)
    console.log(`Bomba ${bombId} entregue`);
  });
  game.on('roundEnd', (finalScore, deathsCaused) => {
    if (!hasRealSession) {
      // Sem frontend rodando nesta sessão de dev, não há pra onde navegar
      // com o resultado — só loga, em vez de mandar pra um FRONTEND_URL que
      // provavelmente não existe.
      console.log(`[dev] fim de turno — pontuação: ${finalScore}, mortes causadas: ${deathsCaused}`);
      return;
    }
    localStorage.setItem(PENDING_RESULT_KEY, JSON.stringify({ finalScore, deathsCaused }));
    location.href = `${FRONTEND_URL}report.html`;
  });

  game.start();
}
