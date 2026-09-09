# Contexto do projeto — Jogo VR de desarme de bombas

## Visão geral

Jogo de realidade virtual que roda na **web** (não é um app nativo) e é acessado
via navegador no **Meta Quest 3**, usando **WebXR**. Projeto acadêmico com prazo
curto — o foco é entregar um **MVP jogável e robusto**, não um jogo completo.

Time tem experiência **iniciante em WebXR** (primeira vez mexendo com VR na web),
então as decisões técnicas abaixo priorizam simplicidade e evitar armadilhas
comuns, mesmo quando existe uma solução "mais correta" e mais complexa.

## Ideia central

Duas mecânicas combinadas:

1. **Desarme de bombas** (estilo *Keep Talking and Nobody Explodes* /
   *Surgeon Simulator*): o jogador usa as mãos/controles para cortar fios,
   apertar botões e digitar senhas para desarmar uma bomba.
2. **Gestão sob pressão estilo Overcooked**: o jogador é single-player, mas
   o jogo funciona como uma **linha de produção contínua** — bombas vão
   chegando via dispenser conforme ele entrega as anteriores (ou em um
   intervalo fixo, se ele demorar demais), então ele precisa circular entre
   as estações físicas da sala (dispenser, scanner, mesa de desarme,
   esteira) administrando várias bombas em estágios diferentes ao mesmo
   tempo.

O jogo **não é multiplayer** — decisão confirmada para manter o escopo viável
no prazo disponível.

A partida tem um **timer fixo, mas oculto do jogador** — não há contagem
regressiva visível na tela. Quando faltam ~15 segundos, uma música de
tensão começa a tocar como único aviso de que o tempo está acabando. Ao
zerar, a partida termina.

## Stack tecnológica

- **Three.js** para renderização 3D
- **WebXR API** para a sessão de realidade virtual (via `VRButton.js` e
  `XRControllerModelFactory` dos exemplos oficiais do Three.js como ponto de
  partida — não reinventar isso do zero)
- HTML/CSS/JS puro para a camada de interface fora da sessão imersiva
- Backend via **Azure Functions** (Node.js, modelo de programação v4),
  integradas ao Azure Static Web Apps, com persistência em **Azure Table
  Storage** — só para pontuação/progresso, **sem lógica de jogo no servidor**

Decisões técnicas para não usar (evitar complexidade desnecessária no MVP):

- **Sem motor de física completo** (Cannon.js, Rapier, etc.). As interações de
  corte de fio e botões usam raycasting do controller ou detecção de
  proximidade (distância entre controller e objeto), não simulação física real.
- **Locomoção por teleporte com pontos fixos**, não joystick livre — mais
  simples de implementar e evita cybersickness.

Ferramenta de teste recomendada: extensão de Chrome **"Immersive Web
Emulator"**, para testar controles/headset direto no PC antes de subir pro
Quest 3 de verdade — evita o ciclo lento de build → headset → testar.

## Objetos e cena

### Objetos macro (a sala)

- **Sala** onde o jogador se movimenta livremente (teleporte).
- **Dispenser de teto** — "cospe" bombas em intervalos, que caem numa caixa
  de coleta.
- **Caixa de coleta** — onde as bombas do dispenser se acumulam até o
  jogador pegá-las.
- **Scanner** — passa uma luz verde "lendo" a bomba e, ao final, ejeta um
  panfleto com as instruções de desarme daquela bomba específica.
- **Mesa de desarme** — onde o jogador entra no modo de desarme (core do
  jogo).
- **Esteira de entrega** — onde o jogador solta a bomba já desarmada e
  aciona o envio.

### Objetos micro

- **Bombas** — 3 variações diferentes por enquanto, e a diferença entre
  elas é **puramente visual**: posição dos elementos na bomba e cor base do
  corpo da bomba. Os 3 desafios (fio, botão, senha) são os mesmos em todas
  as variações — só muda o layout/aparência.
- **Alicate** — ferramenta para cortar fios no modo de desarme.
- **Panfleto** — contém as instruções de desarme daquela bomba específica;
  fica anexado à bomba depois de retirada do scanner.

## Fluxo completo de uma bomba

1. A bomba cai do dispenser na caixa de coleta.
2. O jogador pega a bomba e leva até o scanner.
3. O jogador coloca a bomba no scanner e aperta um botão para iniciar o
   scan (luz verde "lendo" a bomba).
4. Ao terminar, o scanner ejeta um panfleto com as instruções daquela
   bomba, que fica **anexado à bomba** — o jogador leva os dois juntos.
5. O jogador leva a bomba (com o panfleto anexado) até a mesa de desarme.
6. O jogador coloca a bomba na mesa e aciona um input para entrar no
   **modo de desarme**.
7. O jogador resolve o desarme (ver seção abaixo).
8. O jogador sai do modo de desarme, pega a bomba e leva até a esteira.
9. O jogador coloca a bomba na esteira e aperta um botão para enviá-la —
   **o resultado (certo/errado) não é revelado nesse momento**, só ao fim
   do turno (ver "Pontuação").

**Atalho permitido**: o jogador pode levar a bomba direto da caixa para a
mesa de desarme, pulando o scanner — nesse caso ele não tem o panfleto com
as instruções, o que aumenta a chance de errar o desarme.

## Sistema de chegada de bombas (dispenser)

Diferente do modelo antigo de "estações" e "fases com quantidade fixa de
bombas": **não existem mais fases**. O dispenser libera bombas de forma
contínua, seguindo esta regra:

- Solta uma nova bomba quando o jogador **entrega** uma bomba na esteira
  (repondo o que foi consumido do "estoque" de trabalho).
- Solta uma nova bomba em um **intervalo fixo determinado**, mesmo sem
  entrega, caso o jogador esteja demorando demais — isso evita que o
  jogador consiga "pausar" a pressão do jogo ficando parado.

Isso substitui inteiramente o antigo `BombManager` baseado em estações
livres/spawn rate crescente — a pressão agora vem do fluxo de produção
contínuo, não de bombas aparecendo simultaneamente em pontos aleatórios da
sala.

## Modo de desarme (core do jogo)

Ativado ao colocar a bomba na mesa e acionar o input de entrada. Regras
desse modo:

- O jogador fica **sentado/parado — locomoção travada** enquanto estiver
  nesse modo (diferente do resto do jogo, onde ele anda livremente pela
  sala).
- A bomba fica **centralizada na mesa e estática** (não se move).
- À **esquerda** fica o panfleto com as instruções (o jogador pode pegá-lo
  e lê-lo).
- À **direita** fica o alicate de corte (o jogador pode pegá-lo; apertar o
  gatilho aciona o corte de fio).

### Interações com a bomba

Toda bomba apresenta os 3 tipos de desafio **simultaneamente** — não é um
subconjunto sorteado, todas as bombas têm os três. Quantidade e cores são
sempre as mesmas entre bombas; o que muda a cada bomba gerada é **qual**
opção é a correta:

1. **Corte de fio** — sempre **4 fios**, sempre as **mesmas 4 cores**; qual
   dos 4 é o fio certo a cortar é sorteado aleatoriamente para cada bomba.
   O jogador posiciona o alicate sobre o fio certo e aperta o gatilho para
   cortar.
2. **Aperto de botão** — mesmo padrão dos fios: sempre **4 botões**, sempre
   as **mesmas 4 cores**; qual botão é o correto é sorteado aleatoriamente
   por bomba. O jogador clica no botão correto.
3. **Inserção de senha** — senha **numérica de 4 dígitos**, gerada
   aleatoriamente para cada bomba. A bomba mostra um teclado numérico e um
   visor que exibe os dígitos já inseridos; o jogador digita clicando nos
   botões do teclado.

## Conteúdo do panfleto

O panfleto traz as instruções de desarme daquela bomba, de forma clara:

- A **senha** correta.
- A **cor do fio** que deve ser cortado.
- A **cor do botão** que deve ser pressionado.

O conteúdo precisa ser **grande e legível**, já que o jogador vai segurar o
panfleto na mão e ler durante o desarme (texto pequeno não vai funcionar
bem na resolução de VR).

## Pontuação

- O jogador **não sabe se acertou ou errou** no momento da entrega — o
  resultado só é revelado no **relatório final**, ao fim do turno, listando
  o resultado de cada bomba entregue.
- Uma entrega é considerada **incorreta** se: a bomba foi entregue **sem
  ter sido desarmada** (nenhum dos 3 desafios resolvido), **ou** algum dos
  3 desafios (fio, botão, senha) foi **resolvido incorretamente**.
- Bomba entregue **corretamente**: +100 pontos.
- Bomba entregue **incorretamente**: -100 pontos, e soma ao contador de
  "mortes causadas" um número aleatório entre 1 e 6.

## Divisão do projeto em três frentes

O corte não é "quem mexe em HTML vs quem mexe em Three.js" — é **onde a
experiência vive**: dentro da sessão WebXR, ou na casca ao redor dela.

- **Interface 2D (Frontend)** — tudo fora da sessão imersiva: página inicial
  com botão "Entrar em VR", menus, tela de game over/pontuação, formulário de
  nome do jogador, leaderboard, chamadas à API do backend. HTML/CSS/JS puro,
  testável em navegador comum de PC sem precisar do Quest 3.
- **Cena 3D/WebXR (Dev 3D)** — tudo que acontece dentro da sessão imersiva:
  cena Three.js, os objetos macro (dispenser, scanner, mesa de desarme,
  esteira), interações com a bomba, controllers, áudio posicional. Concentra
  a maior parte da complexidade do projeto.
- **Backend** — API enxuta para registrar pontuação/progresso
  (`POST /api/scores`, `GET /api/leaderboard`), implementada como Azure
  Functions dentro da pasta `/api` do mesmo repositório. Sem lógica de jogo —
  tudo roda no cliente, dentro do navegador do headset. Detalhes de
  implementação na seção "Backend e hospedagem (Azure)" abaixo.

### Contrato de eventos entre Frontend e Cena 3D

Definido cedo para as duas frentes trabalharem em paralelo sem se bloquear
(frontend pode mockar esses eventos antes da cena 3D estar pronta):

```js
game.start()
game.pause()
game.on('bombDispensed', (bombId) => {...})
game.on('bombScanned', (bombId) => {...})
game.on('bombDelivered', (bombId, wasCorrect) => {...}) // calculado aqui, mas só exibido ao jogador em roundEnd
game.on('roundEnd', (finalScore, deathsCaused) => {...})
```

### Contrato de API com o Backend

```
POST /api/scores { playerName, score, deathsCaused }
GET  /api/leaderboard
```

Como frontend e API ficam sob o mesmo domínio quando publicados como Azure
Static Web App, não há problema de CORS a resolver.

> Nota: os exemplos de código dos endpoints na seção "Backend e hospedagem
> (Azure)" abaixo ainda usam o campo antigo `defusedCount` — ajustar para
> `deathsCaused` (e o que mais for definido nos "Pontos em aberto") quando
> for implementar de fato.

### Estrutura de pastas sugerida

```
/frontend        → HTML/CSS, telas, chamadas à API
/game-3d         → cena Three.js, WebXR, BombManager, módulos
/api             → Azure Functions (scores, leaderboard) — ver detalhes abaixo
/shared          → contrato de eventos e tipos compartilhados (se usarem TS)
```

## Backend e hospedagem (Azure)

Hospedagem definida: **Azure**, aproveitando o plano estudantil. Decisão de
arquitetura: usar **Azure Static Web Apps** para hospedar frontend + cena 3D
(estático, com CDN e HTTPS automático) com a **API integrada via Azure
Functions**, em vez de um backend separado. Isso resolve dois problemas de
uma vez: WebXR exige HTTPS obrigatoriamente para funcionar, e frontend +
API ficando sob o mesmo domínio elimina qualquer configuração de CORS.

Alternativa considerada e descartada por enquanto: Azure App Service
separado para o backend. Funciona, mas o tier gratuito (F1) hiberna após
período sem uso (primeira chamada depois de um tempo parado demora mais) e
adiciona complexidade de configurar CORS entre domínios diferentes — não
compensa pra esse escopo.

### Estrutura da API (`/api`)

Usando o modelo de programação v4 do Node.js para Azure Functions:

```
/api/
├── src/
│   └── functions/
│       ├── scores.js       → POST /api/scores
│       └── leaderboard.js  → GET  /api/leaderboard
├── host.json
├── package.json
└── local.settings.json     → connection strings locais (NÃO commitar)
```

### Endpoint de salvar pontuação

```js
// api/src/functions/scores.js
const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const { randomUUID } = require('crypto');

app.http('scores', {
  methods: ['POST'],
  route: 'scores',
  handler: async (request) => {
    const body = await request.json();
    const { playerName, score, defusedCount } = body;

    if (!playerName || typeof score !== 'number') {
      return { status: 400, jsonBody: { error: 'playerName e score são obrigatórios' } };
    }

    const client = TableClient.fromConnectionString(
      process.env.AZURE_TABLES_CONNECTION_STRING,
      'scores'
    );

    await client.createEntity({
      partitionKey: 'scores',
      rowKey: randomUUID(),
      playerName,
      score,
      defusedCount: defusedCount ?? 0,
      createdAt: new Date().toISOString(),
    });

    return { status: 201, jsonBody: { success: true } };
  },
});
```

### Endpoint de leaderboard

```js
// api/src/functions/leaderboard.js
const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');

app.http('leaderboard', {
  methods: ['GET'],
  route: 'leaderboard',
  handler: async () => {
    const client = TableClient.fromConnectionString(
      process.env.AZURE_TABLES_CONNECTION_STRING,
      'scores'
    );

    const entities = [];
    for await (const entity of client.listEntities()) {
      entities.push(entity);
    }
    entities.sort((a, b) => b.score - a.score);

    return { jsonBody: entities.slice(0, 10) };
  },
});
```

Persistência: **Azure Table Storage** (mais simples e barato que Cosmos DB
para um leaderboard, que é essencialmente uma lista ordenável de registros
pequenos).

### Desenvolvimento local

```bash
npm install -g @azure/static-web-apps-cli
npm install -g azure-functions-core-tools@4
```

Na raiz do projeto:

```bash
swa start ./frontend --api-location ./api
```

Isso sobe frontend e API juntos, simulando o roteamento de produção —
chamadas para `/api/scores` já funcionam localmente do mesmo jeito que em
produção, sem precisar mockar nada.

### Segredos e variáveis de ambiente

A connection string do Table Storage nunca vai no código nem no repositório:
localmente fica em `local.settings.json` (no `.gitignore`); em produção é
configurada como "Application setting" no portal Azure. A Function lê via
`process.env.AZURE_TABLES_CONNECTION_STRING` em ambos os casos.

### Deploy

Ao criar o recurso "Static Web App" no portal Azure conectado ao
repositório GitHub, ele gera automaticamente um workflow
(`.github/workflows/azure-static-web-apps-*.yml`) configurando `app_location`
(frontend/build) e `api_location` (`/api`). Cada push builda e publica os
dois juntos — quem mexe no backend só precisa alterar dentro de `/api`.

### Testar no Quest 3 durante o desenvolvimento

WebXR exige contexto seguro (HTTPS) — `http://192.168.x.x:porta` não
funciona no navegador do Quest. Para testar no headset antes do deploy,
usar `ngrok`/`localtunnel` para expor o servidor local com URL HTTPS
temporária, ou um plugin de certificado local do Vite
(`vite-plugin-mkcert`) se o bundler do frontend for Vite.

### Cuidado com o plano estudantil

Confirmar no portal Azure se o **limite de gastos (spending limit)** está
ativado na assinatura de estudante, para não haver cobrança além do crédito
gratuito.

## Decisão de locomoção

Confirmado: **teleporte com pontos fixos**, não locomoção livre por
joystick — mais simples de implementar e evita cybersickness sem precisar
de técnicas extras de conforto (vinheta, snap turning, etc.). Locomoção
livre pode ser avaliada como opção extra de conforto (não substituto) se
sobrar tempo depois do roteiro abaixo.

Além disso, dentro do **modo de desarme** (mesa) a locomoção fica
**completamente travada** — o jogador permanece sentado/parado até sair
desse modo. É um estado à parte do teleporte livre usado no resto da sala.

## Roteiro de fases do MVP

1. Cena básica + sessão WebXR rodando no Quest (chão, luz, `VRButton`,
   controllers visíveis) — validar que "entra em VR" funciona.
2. Objetos macro básicos na cena: dispenser, caixa, scanner, mesa de
   desarme, esteira — só como geometria posicionada, sem interação ainda.
3. Pegar/soltar a bomba (grab genérico) + dispenser soltando bombas na
   caixa em intervalo fixo.
4. Fluxo do scanner: colocar bomba, apertar botão, luz verde, panfleto
   ejetado e anexado à bomba.
5. Fluxo da mesa de desarme: colocar bomba, entrar no modo (locomoção
   travada), um único tipo de desafio funcionando ponta a ponta (ex: corte
   de fio com 4 cores) — validar entrada/saída do modo de desarme.
6. Adicionar os outros 2 tipos de desafio (botão e senha) na mesa de
   desarme.
7. Fluxo da esteira: colocar bomba, apertar botão de envio, calcular
   resultado internamente (sem exibir ainda).
8. Timer oculto da partida + música de tensão nos últimos ~15s + fim de
   partida.
9. Relatório final ao fim do turno: pontuação total, contador de mortes
   causadas, e o resultado (certo/errado) de cada bomba entregue.
10. Polimento: feedback visual/sonoro em cada estação, tutorial inicial,
    vibração do controller.

O MVP jogável mínimo existe a partir da fase 7 (ciclo completo de uma
bomba, do dispenser à entrega). As fases 8-10 são o que dá identidade ao
jogo (tensão, pontuação, polish) — se o prazo apertar, a fase 10 pode ser
cortada sem perder a essência da ideia.