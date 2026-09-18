import { createGame } from './game.js';
import { apiClient } from './apiClient.js';

// Integração com o /frontend (2D) — ver CLAUDE.md, seção "Contrato de
// eventos entre Frontend e Cena 3D", e frontend/instrucao.md pro porquê da
// navegação real de página (em vez de SPA) entre as duas pastas.
//
// "defuse:playerId", "defuse:currentPhase", "defuse:pendingResult" e
// "defuse:pendingPhase" no localStorage são o único contrato entre este
// arquivo e frontend/js/session.js e frontend/js/report.js — o nome das
// chaves não pode mudar de um lado sem mudar do outro. Isso só vale pro
// caminho de SAIR da sessão WebXR ('roundExit', mais abaixo): desde o loop
// contínuo entre fases (game-3d/instrucao.md), continuar jogando
// ('roundContinue') nunca chega a navegar pro /frontend — este arquivo fala
// direto com a API (./apiClient.js) nesse caso, e só nesse caso.
const PLAYER_ID_KEY = 'defuse:playerId';
const CURRENT_PHASE_KEY = 'defuse:currentPhase';
const PENDING_RESULT_KEY = 'defuse:pendingResult';
const PENDING_PHASE_KEY = 'defuse:pendingPhase';

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
// Fase de dificuldade persistente (currentPhase da API) — o /frontend grava
// essa chave antes de entrar em VR (ver frontend/js/session.js), buscando
// GET /api/progress/{playerId}. Sem sessão real (dev local) ou sem valor
// salvo ainda, cai pra fase 1 — createGame()/difficulty.js clampam de novo,
// então um valor inválido aqui nunca quebra a cena, só vira fase 1.
const currentPhase = parseInt(localStorage.getItem(CURRENT_PHASE_KEY), 10) || 1;

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

  // devInputOverride: conveniência SÓ de dev (mouse/Immersive Web Emulator,
  // sem dedo/controller de verdade) — import.meta.env.DEV garante que nunca
  // fica ativo num build de produção real (mesmo sinal já usado acima pra
  // isDevServer).
  const game = createGame({ phase: currentPhase, devInputOverride: isDevServer });

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

  // game.js decide SE a fase avançou (compara score contra o threshold da
  // fase atual, ver difficulty.js) — dispara ANTES de 'roundEnd' (game.js
  // emite os dois na mesma chamada de onRoundEnd, nessa ordem), sempre que
  // o placar do turno bate o threshold, independente do jogador escolher
  // "avançar" ou "jogar de novo" no painel de fim de turno (ver
  // reportPanel.js) — passar do threshold já desbloqueia a fase pra sempre.
  let pendingPhase = null;
  game.on('phaseUnlocked', (newPhase) => {
    pendingPhase = newPhase;
    console.log(`Fase ${newPhase} desbloqueada`);
  });

  // Só guarda o resultado do turno que acabou de terminar — quem decide o
  // que fazer com ele é 'roundContinue'/'roundExit' abaixo, disparados pelo
  // painel interativo de fim de turno (loop contínuo entre fases, ver
  // game-3d/instrucao.md).
  let lastFinalScore = 0;
  let lastDeathsCaused = 0;
  game.on('roundEnd', (finalScore, deathsCaused) => {
    lastFinalScore = finalScore;
    lastDeathsCaused = deathsCaused;
    if (!hasRealSession) {
      console.log(`[dev] fim de turno — pontuação: ${finalScore}, mortes causadas: ${deathsCaused}`);
    }
  });

  // Jogador escolheu "avançar"/"jogar de novo" — continua na MESMA sessão
  // WebXR, sem navegar (não dá pra reabrir XR sozinho depois de navegar,
  // exige um gesto novo do usuário). Como não vamos passar pelo
  // /frontend (report.html) desta vez, este handler persiste o resultado
  // direto via API (game-3d/src/apiClient.js) — o único lugar do game-3d
  // que fala com a API, e só nesse caminho; "sair" (abaixo) continua
  // delegando isso pro /frontend como sempre foi. Best-effort: o jogador já
  // está jogando a rodada nova quando este fetch roda, uma falha aqui não
  // trava nada, só perde o registro daquela rodada específica.
  game.on('roundContinue', (newPhase) => {
    const phaseJustUnlocked = pendingPhase;
    pendingPhase = null;
    localStorage.setItem(CURRENT_PHASE_KEY, String(newPhase));
    if (!hasRealSession) return; // sessão de dev local, sem API pra falar
    persistRound({ finalScore: lastFinalScore, deathsCaused: lastDeathsCaused, phaseJustUnlocked, newPhase }).catch(
      (err) => {
        console.warn('Não foi possível salvar o resultado/avanço de fase da rodada anterior:', err);
      }
    );
  });

  // Jogador escolheu "sair pro menu" — único caminho que ainda navega pra
  // fora da sessão WebXR, exatamente como o antigo handler de 'roundEnd'
  // fazia sozinho antes do loop contínuo existir; report.html é quem
  // persiste (POST /api/scores, PATCH /api/progress), como sempre foi.
  game.on('roundExit', () => {
    if (!hasRealSession) {
      console.log('[dev] saindo — sem frontend rodando nesta sessão, nada a persistir aqui.');
      return;
    }
    localStorage.setItem(PENDING_RESULT_KEY, JSON.stringify({ finalScore: lastFinalScore, deathsCaused: lastDeathsCaused }));
    if (pendingPhase !== null) {
      localStorage.setItem(PENDING_PHASE_KEY, String(pendingPhase));
    }
    location.href = `${FRONTEND_URL}report.html`;
  });

  async function persistRound({ finalScore, deathsCaused, phaseJustUnlocked, newPhase }) {
    await apiClient.postScore(playerId, finalScore, deathsCaused);
    if (phaseJustUnlocked !== null) {
      const progress = await apiClient.getProgress(playerId);
      await apiClient.patchProgress(playerId, {
        currentPhase: newPhase,
        highestPhaseUnlocked: Math.max(progress.highestPhaseUnlocked, phaseJustUnlocked),
      });
    }
  }

  game.start();
}
