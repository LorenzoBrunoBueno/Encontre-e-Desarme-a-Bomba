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
- **Dispenser de teto** — arma uma bomba em intervalos (ou a cada entrega),
  mas só a solta de fato quando o jogador puxa a **alavanca física** ao
  nível do chão, perto da caixa de coleta (o corpo do dispenser fica no
  teto, fora de alcance). Se o jogador demorar demais pra puxar, um
  fallback automático solta a bomba sozinho — ver "Sistema de chegada de
  bombas" abaixo.
- **Caixa de coleta** — onde as bombas do dispenser se acumulam até o
  jogador pegá-las.
- **Scanner** — a própria inserção da bomba no slot já dispara o scan
  (sem botão), com uma barra de progresso real durante a leitura; ao
  final, ejeta um panfleto com as instruções e atualiza um **holograma de
  apoio** preso ao teto central da sala (visível de qualquer estação,
  mostra os dados da última bomba escaneada — complementa o panfleto, não
  o substitui). A cada 3 bombas escaneadas, o scanner **superaquece** e
  recusa novas bombas até o jogador ir até o centro da sala e puxar uma
  **alavanca de purga** (3 puxões).
- **Mesa de desarme** — onde o jogador entra no modo de desarme (core do
  jogo). Tem um botão dedicado para **girar a bomba 180°**, expondo uma
  etapa traseira (ver "Modo de desarme" abaixo).
- **Esteira de entrega** — não é mais um botão: o jogador precisa
  **arremessar** a bomba desarmada contra um carrinho-alvo que desliza em
  vaivém sobre a esteira. A mesma estação abriga um **duto de descarte**
  para o núcleo/bateria retirado da etapa traseira (aceita arremesso ou só
  aproximar).

### Objetos micro

- **Bombas** — 3 variações diferentes por enquanto, e a diferença entre
  elas é **puramente visual**: posição dos elementos na bomba e cor base do
  corpo da bomba. Os 3 desafios (fio, botão, senha) são os mesmos em todas
  as variações — só muda o layout/aparência. Toda bomba também tem uma
  **etapa traseira** (4 parafusos + núcleo/bateria, ver "Modo de desarme")
  e um **fusível individual** que corre desde que ela sai do dispenser —
  não afeta a pontuação (que continua decidida só na entrega), serve de
  base para o alarme de proximidade (ver "Sistema de áudio e feedback").
- **Alicate** — ferramenta para cortar fios no modo de desarme.
- **Chave de fenda** — ferramenta para remover os 4 parafusos da etapa
  traseira, girando o pulso perto de cada parafuso (não usa o gatilho,
  diferente do alicate).
- **Núcleo/bateria volátil** — exposto depois que os 4 parafusos da etapa
  traseira são removidos; o jogador pega e leva até o duto de descarte da
  esteira. Tarefa física extra, sem efeito na pontuação.
- **Panfleto** — contém as instruções de desarme daquela bomba específica;
  fica anexado à bomba depois de retirada do scanner.
- **Cinto utilitário** — preso ao corpo do jogador (segue posição e giro da
  cabeça, mas não a inclinação), carrega o alicate (lado direito) e a
  chave de fenda (lado esquerdo) — as ferramentas não ficam mais fixas em
  pontos da mesa.

## Fluxo completo de uma bomba

1. O jogador puxa a alavanca do dispenser (ou o fallback automático dispara)
   e a bomba cai na caixa de coleta — o fusível individual dela começa a
   correr nesse momento.
2. O jogador pega a bomba e leva até o scanner.
3. O jogador insere a bomba no slot do scanner — a inserção sozinha já
   dispara o scan (barra de progresso real, sem precisar de botão).
4. Ao terminar, o scanner ejeta um panfleto com as instruções daquela
   bomba, que fica **anexado à bomba** — o jogador leva os dois juntos — e
   atualiza o holograma de apoio no teto central.
5. O jogador leva a bomba (com o panfleto anexado) até a mesa de desarme.
6. O jogador coloca a bomba na mesa e aciona um input para entrar no
   **modo de desarme**.
7. O jogador resolve o desarme frontal (fio/botão/senha) e, se quiser,
   gira a bomba 180° para resolver a etapa traseira (parafusos + núcleo) —
   ver seção "Modo de desarme".
8. O jogador sai do modo de desarme, pega a bomba e leva até a esteira.
9. O jogador **arremessa** a bomba desarmada contra o carrinho-alvo da
   esteira para entregá-la — **o resultado (certo/errado) não é revelado
   nesse momento**, só ao fim do turno (ver "Pontuação"). Se também
   removeu o núcleo/bateria na etapa traseira, descarta no duto da mesma
   estação (arremessando ou só aproximando).

**Atalho permitido**: o jogador pode levar a bomba direto da caixa para a
mesa de desarme, pulando o scanner — nesse caso ele não tem o panfleto com
as instruções, o que aumenta a chance de errar o desarme.

## Sistema de chegada de bombas (dispenser)

Diferente do modelo antigo de "estações" e "fases com quantidade fixa de
bombas": **não existem mais fases**. O dispenser arma bombas de forma
contínua, seguindo esta regra:

- Arma uma nova bomba quando o jogador **entrega** uma bomba na esteira
  (repondo o que foi consumido do "estoque" de trabalho).
- Arma uma nova bomba em um **intervalo fixo determinado**, mesmo sem
  entrega, caso o jogador esteja demorando demais.

"Armar" só acende um indicador luminoso no dispenser — soltar a bomba de
fato exige o jogador ir até lá e **puxar a alavanca física** (ver "Objetos
macro"). Se ele demorar demais pra puxar depois de armada, um **fallback
automático** solta a bomba sozinho mesmo assim — isso preserva a regra
original de que o jogador não consegue "pausar" a pressão do jogo ficando
parado, mesmo com a alavanca exigindo uma ação física a mais.

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
- A bomba fica **centralizada na mesa** e só se move quando o jogador
  aciona o botão de **rotação** (gira 180° em torno do eixo horizontal,
  "virando de cabeça pra baixo" pra expor a etapa traseira — não é uma
  interação livre, é um botão dedicado).
- À **esquerda** fica o panfleto com as instruções (o jogador pode pegá-lo
  e lê-lo).
- O alicate (corte de fio) e a chave de fenda (etapa traseira) não ficam
  mais fixos na mesa — vivem no **cinto utilitário** que o jogador usa o
  tempo todo (direita = alicate, esquerda = chave de fenda), pegáveis por
  proximidade como qualquer outro objeto.

### Interações com a bomba

Toda bomba apresenta os 3 tipos de desafio frontais **simultaneamente** —
não é um subconjunto sorteado, todas as bombas têm os três. Quantidade e
cores são sempre as mesmas entre bombas; o que muda a cada bomba gerada é
**qual** opção é a correta:

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

### Etapa traseira (opcional, sem efeito na pontuação)

Depois de girar a bomba 180° na mesa, o jogador vê 4 parafusos na face que
antes ficava embaixo. Com a chave de fenda do cinto, ele encosta em cada
parafuso e gira o pulso algumas vezes para soltá-lo (não usa o gatilho).
Depois dos 4 removidos, uma tampa abre e expõe um núcleo/bateria volátil,
que o jogador pega e leva até o duto de descarte da esteira. É tarefa
física extra — o documento de especificação que introduziu essa mecânica
não liga isso a pontuação, então continua valendo só o resultado dos 3
desafios frontais (ver "Pontuação").

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

Expandido além do desenho original de duas rotas — agora inclui identidade
de jogador (nome + PIN) e progressão de fases persistente. Contrato
implementado (`/api` já existe no repositório):

```
POST  /api/settings/register   { name, pin }               → cria conta; 409 se nome já existe
POST  /api/settings/login      { name, pin }                → resolve playerId numa máquina nova
GET   /api/settings/{playerId}
PATCH /api/settings/{playerId} { name?, settings? }
POST  /api/scores              { playerId, score, deathsCaused }
GET   /api/leaderboard
GET   /api/progress/{playerId}
PATCH /api/progress/{playerId} { highestPhaseUnlocked?, currentPhase? }
```

Como frontend e API ficam sob o mesmo domínio quando publicados como Azure
Static Web App, não há problema de CORS a resolver.

Identidade: o jogador se registra com nome + **PIN numérico de 4-6 dígitos**
(não senha alfanumérica completa — o cadastro acontece pelo teclado virtual
do navegador do Quest, e não há dado sensível em jogo, então não compensa o
custo de um sistema de auth completo). O `playerId` (UUID) retornado no
registro/login é guardado no `localStorage` do frontend e funciona como a
credencial de fato para `scores`/`progress`/`settings` dali em diante — o
PIN só é reapresentado para "logar" numa máquina nova que ainda não tem esse
ID salvo. Trocar de nome não afeta progresso, histórico nem leaderboard,
porque nenhum dos três é indexado por nome, só por `playerId`.

> Detalhamento completo (schema do Table Storage, modelo de ameaça da
> identidade por PIN, pendências) em `api/instrucao.md` — segue o mesmo
> padrão do `game-3d/instrucao.md`, não repetido aqui.

### Estrutura de pastas sugerida

```
/frontend        → HTML/CSS, telas, chamadas à API
/game-3d         → cena Three.js, WebXR, BombManager, módulos
/api             → Azure Functions (settings, scores, leaderboard, progress) — ver detalhes abaixo
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
│   ├── functions/
│   │   ├── settingsRegister.js → POST  /api/settings/register
│   │   ├── settingsLogin.js    → POST  /api/settings/login
│   │   ├── settings.js         → GET/PATCH /api/settings/{playerId}
│   │   ├── scores.js           → POST  /api/scores
│   │   ├── leaderboard.js      → GET   /api/leaderboard
│   │   └── progress.js         → GET/PATCH /api/progress/{playerId}
│   └── lib/                    → TableClient, hash de PIN e CRUD de players
│                                  compartilhados entre as 6 functions
├── host.json
├── package.json
├── instrucao.md            → decisões de design e schema, ver seção acima
└── local.settings.json     → connection strings locais (NÃO commitar)
```

O código-fonte de cada endpoint é a referência definitiva (não duplicado
aqui); `api/instrucao.md` documenta o schema do Table Storage e o porquê das
decisões.

Persistência: **Azure Table Storage** (mais simples e barato que Cosmos DB
para os dados envolvidos — pontuação, progresso e settings são todos
registros pequenos e a leitura mais pesada, o leaderboard, é só um top 10).

### Desenvolvimento local

```bash
npm install -g @azure/static-web-apps-cli
npm install -g azure-functions-core-tools@4
npm install -g azurite
```

O `local.settings.json` do `/api` aponta `AzureWebJobsStorage` e
`AZURE_TABLES_CONNECTION_STRING` para `UseDevelopmentStorage=true` — precisa
do **Azurite** (emulador de Storage) rodando num terminal separado (`azurite`
na raiz de algum diretório de dados) antes de `func start`/`swa start`
funcionarem local, senão as chamadas às tabelas falham.

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

### Puxão (force pull) e arremesso

Duas mecânicas extras que preservam o teleporte fixo (não o substituem):

- **Puxão**: o jogador mira um objeto pegável fora do alcance normal de
  grab, segura o gatilho e puxa o pulso pra trás — o objeto voa até a mão.
  Serve pra resgatar bombas/ferramentas jogadas ou fora de alcance sem
  precisar teleportar até lá. Desativado dentro do modo de desarme (mesmo
  travamento do teleporte).
- **Arremesso**: soltar o grip com velocidade suficiente faz bombas (e o
  núcleo/bateria da etapa traseira) herdarem essa velocidade e caírem com
  gravidade simples, em vez de só cair no lugar — é como a esteira agora
  recebe entregas (ver "Objetos macro").

Nenhuma das duas usa motor de física real (a regra da seção "Stack
tecnológica" continua valendo) — é velocidade/gesto medido diretamente
pela posição do controller, sem colisão de verdade.

## Sistema de áudio e feedback

- **Música de tensão**: nos últimos ~15s da partida (ver "Ideia central").
- **Alarme de proximidade**: toda bomba com fusível ativo acima de um
  limiar de urgência ganha um bipe **3D posicional** (não mono) que
  acelera e fica mais agudo conforme o tempo acaba — o jogador consegue
  localizar a direção da bomba crítica pelo próprio áudio espacializado,
  mesmo estando em outra estação. Também pulsa o controller que estiver
  segurando essa bomba, se houver.
- **Haptics**: pulsos curtos de vibração em pegar objeto, confirmar um
  puxão, e no alarme de proximidade acima. Ainda não cobre todos os
  pontos de feedback tátil originalmente cotados (corte de fio, toque em
  botões físicos) — ver `game-3d/instrucao.md` para o estado exato.

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

### Fase 11 — Loop Overcooked (implementada)

Depois do MVP completo, o fluxo linear acima foi expandido pra um loop
mais caótico: alavancas físicas (dispenser, purga do scanner), scanner por
inserção com crise de superaquecimento e holograma de apoio, rotação +
etapa traseira na bancada, esteira por arremesso, e alarme de proximidade
3D — todas as seções deste documento já refletem esse estado atual. O
histórico de decisões e suposições tomadas durante essa implementação
(o que ficou parcial, valores placeholder como o tempo do fusível, etc.)
fica documentado em `game-3d/instrucao.md`, que não repete o que já está
aqui — só referencia.