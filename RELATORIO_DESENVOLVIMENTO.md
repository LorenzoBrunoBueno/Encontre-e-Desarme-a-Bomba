# Relatório de desenvolvimento — Defuse VR

Registro das alterações feitas em cada etapa do roteiro definido em
`CLAUDE.md`. Atualizado a cada fase concluída.

---

## Fase 1 — Cena básica + sessão WebXR

**Arquivos criados:** `game-3d/package.json`, `game-3d/vite.config.js`,
`game-3d/index.html`, `game-3d/src/main.js`, `.gitignore` (raiz).

- Projeto `game-3d` inicializado com Vite + Three.js (`three@0.185.1`,
  `vite@8.2.2`, `vite-plugin-mkcert@2.1.0`).
- `main.js`: cena, câmera, `WebGLRenderer` com `xr.enabled = true`,
  `VRButton`, luz (hemisférica + direcional), chão, e os dois controllers
  visíveis via `XRControllerModelFactory`.
- `THREE.Clock` foi descartado em favor de `THREE.Timer` — a versão
  instalada do Three.js (r185+) já emite aviso de depreciação para `Clock`
  desde r183, recomendando `Timer` como substituto direto.
- Validado com a extensão Chrome "Immersive Web Emulator": build de
  produção sem erros, sessão VR simulada inicia, controllers visíveis
  respondem ao emulador.

## Fase 2 — Estação de bomba fixa com módulo de corte de fio

**Arquivos criados:** `game-3d/src/bombStation.js`,
`game-3d/src/wireCuttingModule.js`. **Modificado:** `main.js`.

- Primeira versão do módulo de corte de fio: 5 fios coloridos, um correto
  sorteado, detecção por proximidade (distância ponto-segmento) entre a
  ponta do controller e cada fio.
- `bombStation.js`: máquina de estados `countdown → resolved → respawn`,
  com timer visual desenhado em `<canvas>`/`CanvasTexture`. Decisões
  confirmadas com o usuário: fio errado explode a bomba na hora (estilo
  KTANE), e uma nova bomba nasce automaticamente após o resultado, criando
  um loop de teste contínuo.
- **Bug encontrado e corrigido em produção**: a estação foi originalmente
  posicionada a 4,5m da câmera (fora do alcance do braço), porque a Fase 2
  ainda não tem locomoção/teleporte — o jogador fica fixo no ponto de
  spawn. Corrigido reposicionando a estação a ~0,7m à frente da câmera.
- Testado com sucesso no Immersive Web Emulator (câmera, controllers e,
  após a correção de posição, a movimentação/interação).

## Fase 3 — Teclado numérico + sequência de botões + randomização por bomba

**Arquivos criados:** `game-3d/src/random.js`, `game-3d/src/textPanel.js`,
`game-3d/src/keypadModule.js`, `game-3d/src/buttonSequenceModule.js`.
**Modificados:** `bombStation.js`, `wireCuttingModule.js`, `main.js`.

### O que mudou e por quê

O CLAUDE.md pede que "cada bomba sorteie 1-2 módulos com parâmetros
aleatórios ao ser criada" — isso exigiu trocar o contrato de módulo único
hardcoded (Fase 2) por um contrato genérico que qualquer módulo implementa,
permitindo ao `bombStation` combinar módulos livremente:

```js
{
  group,                 // THREE.Object3D a ser montado no painel
  update(dt, tipPositions), // checagem contínua de toque (teclado, botões)
  handleTrigger(point),     // reação ao gatilho (só o corte de fio usa)
  dispose(),                 // libera geometrias/materiais/texturas
}
```

Cada bomba agora sorteia 1 ou 2 tipos de módulo distintos (de um total de
3) via `pickModuleFactories()` em `bombStation.js`, usando o novo
`shuffle()` extraído para `random.js` (antes duplicado dentro de
`wireCuttingModule.js`). A bomba só é desarmada quando **todos** os
módulos sorteados forem resolvidos; o timer e o "fio errado explode na
hora" continuam valendo como antes.

### Novos módulos

- **`keypadModule.js`** — teclado numérico 3×4 (layout de telefone), com
  um código de 4 dígitos sorteado e exibido acima do teclado (via
  `textPanel.js`). Interação por **toque direto** (sem gatilho): a ponta
  do controller encostando num botão já "aperta" ele, com debounce por
  frame para não repetir o toque enquanto a mão permanece parada em cima
  do botão. Dígito errado só reseta o buffer digitado — não faz a bomba
  explodir (diferente do módulo de fio, de propósito: nem todo módulo
  precisa ser punitivo, e KTANE também trata teclados como "módulos de
  digitação", não de risco instantâneo).
- **`buttonSequenceModule.js`** — 4 botões coloridos, cada um com um
  número (a ordem sorteada de pressão) afixado nele; o jogador precisa
  tocar na ordem indicada pelos números. Tocar fora de ordem só reinicia a
  sequência, mesma lógica de "sem punição instantânea" do teclado.

Ambos os módulos de toque reaproveitam o mesmo padrão de detecção por
proximidade já usado no corte de fio (distância entre a ponta do
controller e a posição mundial do alvo), só que verificado a cada frame
(`update`) em vez de apenas no evento de gatilho.

### `textPanel.js` (novo utilitário)

Extraído do código de exibição do timer (que antes vivia dentro de
`bombStation.js`), porque agora é reaproveitado em 3 lugares: o timer da
bomba, o código exibido no teclado, e os números nos botões da sequência.
Encapsula a criação de `<canvas>` + `CanvasTexture` + `PlaneGeometry`, com
`setText(texto, cor, fundo)` e `dispose()`.

### Ciclo de vida dos módulos (evitando vazamento de memória)

Como cada bomba pode sortear tipos de módulo diferentes da anterior, o
`bombStation` não reaproveita instâncias — cria módulos novos a cada
`spawnBomb()` e descarta os antigos chamando `mod.dispose()` (que libera
geometrias, materiais e texturas de canvas) antes de removê-los da cena.
Isso evita acumular objetos WebGL órfãos ao longo de um loop de teste
longo.

### Ajustes de balanceamento

- `TIMER_SECONDS` subiu de 45s (Fase 2) para 60s, já que bombas com 2
  módulos são naturalmente mais demoradas de resolver.
- Pedestal da estação alargado (0,5m → 0,9m) para acomodar dois módulos
  lado a lado sem sobreposição visual.

### Verificação

- `npm run build`: 19 módulos, sem erros.
- Pendente: teste manual no Immersive Web Emulator/Quest 3 (aproximar o
  controller do teclado/botões e verificar toque direto; testar as
  combinações de 1 e 2 módulos por bomba).

---

## Fase 4 — Múltiplas estações + BombManager + integridade da base

**Arquivos criados:** `game-3d/src/bombManager.js`, `game-3d/src/teleport.js`,
`game-3d/src/hud.js`. **Modificados:** `bombStation.js`, `main.js`.

### Por que essa fase também trouxe teleporte (não estava no pedido original)

O roteiro do CLAUDE.md não lista "implementar teleporte" como uma fase
própria, mas o documento já havia confirmado a decisão de locomoção
("teleporte com pontos fixos"), e a Fase 4 é a primeira em que existe mais
de uma estação. Sem locomoção, a maioria das estações ficaria fisicamente
fora do alcance do jogador — o mesmo tipo de bug já corrigido na Fase 2
(estação a 4,5m de distância), só que agora estrutural: com estações
espalhadas ao redor da sala, não dá para resolver só reposicionando uma
estação mais perto. Por isso a locomoção por teleporte entrou como parte
necessária desta fase, e não como polimento futuro.

### `bombManager.js` (novo)

Implementado exatamente como o CLAUDE.md descreve na seção "Sistema de
spawn (BombManager)": independente da cena 3D, só decide *quando* e *onde*
uma bomba nasce e dispara um evento (`onSpawn(stationIndex)`) para quem
desenha a cena reagir — não conhece Three.js nem `bombStation.js`
diretamente.

- `getNextSpawnInterval()` (interno, `nextSpawnInterval()`): começa em 18s,
  cai linearmente até um piso de 7s ao longo de 3 minutos de partida
  (`DIFFICULTY_RAMP_SECONDS = 180`) — dentro da faixa sugerida pelo
  CLAUDE.md (15-20s inicial, piso de 6-8s).
- `maxSimultaneous`: começa em 1, sobe linearmente até o número de
  estações (3) também ao longo dos mesmos 3 minutos.
- Escolha de estação: aleatória entre as livres, conforme o CLAUDE.md
  aceita para o MVP (sem lógica de "evitar estações próximas").
- Integridade da base: `maxIntegrity` (padrão 3 "vidas"); cada explosão
  decrementa 1 e chama `onIntegrityChange`; ao chegar a 0, chama
  `onGameOver()` e para de spawnar novas bombas.
- `reportResult(stationIndex, outcome)` é chamado pela estação quando
  resolve uma bomba, liberando a estação para o manager voltar a
  sortear-la depois.

### `bombStation.js` — de "auto-loop" para "controlada pelo manager"

Na Fase 2/3, a estação nascia e se auto-respawnava sozinha. Isso não faz
mais sentido com múltiplas estações — quem decide se/quando uma estação
ganha uma nova bomba agora é o `BombManager`. Mudança de contrato:

- Estado novo `idle` (sem bomba, display de timer escondido, indicador
  apagado) além dos já existentes `countdown`/`resolved`.
- `activate(onResolved)` substitui o antigo comportamento de auto-spawn —
  chamado pelo `BombManager` via `onSpawn`. Ao resolver (defusar ou
  explodir) e passar o tempo de exibição do resultado, a estação volta a
  `idle` e chama `onResolved(outcome)`, que o `main.js` encaminha para
  `bombManager.reportResult(...)`.
- Novo indicador luminoso (`PointLight` + esfera emissiva) que pisca
  enquanto a bomba está ativa — telegraphing visual pedido pelo CLAUDE.md
  para o jogador perceber bombas fora do campo de visão. O áudio
  posicional complementar continua planejado para a Fase 6.
- `createBombStation` ganhou o parâmetro `rotationY`, porque agora as
  estações ficam espalhadas em círculo e cada uma precisa girar para que a
  face dos módulos aponte de volta para o centro da sala (de onde o
  jogador vai interagir depois de teleportar).

### `teleport.js` (novo) — locomoção por teleporte com pontos fixos

- Discos fixos no chão (`RingGeometry`) marcam os pontos de teleporte: um
  perto de cada estação (a 0,7m, dentro do alcance do braço) e um ponto
  central de "casa".
- Cada controller ganha uma linha (raycasting) que mira no chão; ao
  encostar num disco, a linha muda de cor (feedback de mira) e o
  **grip/squeeze** (não o gatilho, que já é usado para cortar fio)
  teleporta o jogador para aquele ponto.
- Teleportar é só `camera.position.set(x, camera.position.y, z)` — no
  WebXR do Three.js, a posição do objeto `camera` funciona como o
  transform do "rig" do jogador, sobre o qual a pose rastreada do headset
  é composta; por isso já era assim que a Fase 1 posicionava o jogador no
  spawn, e mover essa posição em runtime tem exatamente o efeito de
  teleportar.

### `hud.js` (novo) — HUD mínimo de integridade

Painel de texto (reaproveitando `textPanel.js`) anexado como filho da
própria câmera (`camera.add(...)`), o que exige que a câmera esteja na
árvore da cena (`scene.add(camera)`, adicionado em `main.js`) para ser
renderizada. Mostra "INTEGRIDADE: X/3" e substitui o texto por "GAME OVER"
quando a integridade zera. É deliberadamente mínimo — a tela de game
over/pontuação de verdade é o objetivo da Fase 5; isto aqui só existe para
a integridade ser visível durante o playtest desta fase.

### `main.js` — layout da sala

- Câmera de spawn mudou de `(0, 1.6, 3)` (Fase 2/3, de frente para uma
  única estação) para `(0, 1.6, 0)` (centro da sala), já que agora há 3
  estações dispostas em círculo ao redor do jogador (raio 1,6m, a 0°,
  120° e 240°) — conforme o CLAUDE.md pede "3-4 estações fixas ao redor do
  jogador".
- O corte de fio (`selectstart`) agora é despachado para todas as
  estações (cada uma ignora o toque se não estiver com bomba ativa),
  já que existe mais de uma estação candidata.

### Verificação

- `npm run build`: 22 módulos, sem erros.
- Pendente: teste manual no Immersive Web Emulator — apontar o controller
  para um disco de teleporte, apertar o grip (padrão: botão direito do
  mouse acionando `squeezestart`) e confirmar o teleporte; testar as 3
  estações recebendo bombas ao longo do tempo e o HUD de integridade
  atualizando ao explodir uma bomba.

---

## Fase 5 — Curva de dificuldade + contrato de eventos / pontuação

**Arquivos criados:** `game-3d/src/game.js`. **Modificados:**
`bombManager.js`, `bombStation.js`, `hud.js`, `main.js`.

### Escopo revisado: "tela de game over/pontuação" é do Frontend, não do game-3d

Antes de implementar, reli a seção "Divisão do projeto em três frentes" do
CLAUDE.md: ela atribui explicitamente a "tela de game over/pontuação" à
**Interface 2D (Frontend)** — "tudo fora da sessão imersiva". Isso muda o
que a Fase 5 significa para o `game-3d`: não é ele quem deve desenhar essa
tela, e sim **emitir os eventos** que um futuro `/frontend` consumiria. O
CLAUDE.md já define esse contrato exato na seção "Contrato de eventos
entre Frontend e Cena 3D":

```js
game.start()
game.pause()
game.on('bombDefused', (bombId, points) => {...})
game.on('bombExploded', (bombId) => {...})
game.on('gameOver', (finalScore) => {...})
```

Como `/frontend` ainda não existe neste projeto (só `game-3d` foi
construído até aqui), implementar esse contrato agora é o que sobra de
"Fase 5" dentro do escopo do game-3d. A curva de dificuldade em si (spawn
rate aumentando) já tinha sido implementada na Fase 4, dentro do
`BombManager` — não houve mudança nela agora, só confirmação de que já
atende ao pedido da Fase 5.

### `game.js` (novo) — a fachada do jogo

Todo o conteúdo que antes vivia solto em `main.js` (montagem de cena,
câmera, renderer, controllers, estações, teleporte, HUD, BombManager, loop
de renderização) foi movido para dentro de `createGame()`, que devolve
`{ start, pause, on }` — exatamente a forma que o CLAUDE.md especifica.
`main.js` virou um bootstrap fino:

```js
const game = createGame();
game.on('bombDefused', (bombId, points) => console.log(...));
game.on('bombExploded', (bombId) => console.log(...));
game.on('gameOver', (finalScore) => console.log(...));
game.start();
```

Os `console.log` em `main.js` existem só para verificar visualmente (no
console do navegador) que os eventos disparam corretamente — é o
"substituto provisório" do que um Frontend real faria com esses eventos
(atualizar uma tela, chamar a API de pontuação, etc.).

- **Pontuação**: cada bomba desarmada rende `moduleCount * 100 +
  round(timeLeft * 2)` pontos — bombas com mais módulos valem mais, e
  sobrar tempo dá um bônus de velocidade. Bomba explodida não pontua (só
  consome integridade, como já valia desde a Fase 4).
- **Bug corrigido antes de testar**: a primeira versão de `start()` fazia
  `bombManager.start()` toda vez que era chamada, então um eventual
  `pause()` seguido de `start()` (para retomar) dispararia uma bomba extra
  indevida. Corrigido com uma flag `hasStarted` separada de `running`, que
  garante que a montagem da cena e o primeiro spawn só acontecem na
  primeira chamada — chamadas seguintes só alternam se o loop de jogo está
  rodando ou pausado.

### `bombManager.js` — `start()` explícito

Antes, a primeira bomba nascia sozinha assim que `createBombManager(...)`
era chamado (efeito colateral no construtor). Isso não combina com um
contrato onde `game.start()` é quem decide quando a partida começa de
verdade — então o auto-spawn foi removido do construtor e virou um método
`start()` explícito, chamado por `game.js` só na primeira ativação.

### `bombStation.js` — callback de resolução mais rico

`onResolvedCallback` passava só a string `outcome` ('defused'/'exploded').
Para calcular pontos, o `game.js` precisa saber também quantos módulos a
bomba tinha e quanto tempo sobrou — então o callback agora entrega
`{ outcome, moduleCount, timeLeft }`.

### `hud.js` — pontuação e aviso de fim de jogo

Ganhou um painel de pontuação (`PONTOS: N`) ao lado do de integridade, e o
painel de "game over" agora mostra a pontuação final
(`GAME OVER — 1234 pts`). Comentário explícito no topo do arquivo deixando
claro que isto **não** é a tela de game over/pontuação da Fase 5 — é só um
substituto dentro da cena, porque o Frontend real ainda não foi construído.

### O que fica pendente (fora do escopo do game-3d)

- `/frontend`: página inicial com "Entrar em VR", tela de game
  over/pontuação de verdade, formulário de nome do jogador — nada disso
  foi iniciado.
- `/api` e Azure Table Storage: adiado desde o planejamento inicial (o
  usuário ainda não tem assinatura Azure configurada).
- Sem esses dois, os eventos `bombDefused`/`bombExploded`/`gameOver` não
  chegam a lugar nenhum além do console do navegador.

### Verificação

- `npm run build`: 23 módulos, sem erros.
- Servidor de dev validado (`https://localhost:5174/`): todos os arquivos
  novos/modificados (`game.js`, `bombManager.js`, `teleport.js`, `hud.js`,
  `bombStation.js`, `main.js`) responderam 200 via requisição direta.
- Pendente: teste manual completo no Immersive Web Emulator/Quest 3 do
  ciclo inteiro (várias bombas, integridade caindo, `console.log` dos
  eventos disparando, mensagem de "GAME OVER" aparecendo ao zerar a
  integridade).
- Limpeza: processos de dev server órfãos de sessões de teste anteriores
  (o `TaskStop` do ambiente nem sempre mata o processo Node subjacente no
  Windows) foram encontrados e finalizados manualmente via `taskkill`
  algumas vezes ao longo do desenvolvimento — vale ficar de olho nisso ao
  testar localmente (`netstat -ano | findstr :517`) se portas parecerem
  "presas" com código antigo.

---

## Fase 6 — Polimento (não iniciada)

Conforme o próprio CLAUDE.md antecipa, esta fase pode ser cortada sem
perder a essência do jogo se o prazo apertar. Itens previstos e ainda não
implementados: áudio de tensão e áudio posicional (`THREE.PositionalAudio`)
para telegraphing sonoro das bombas (hoje só há o indicador luminoso
piscando, da Fase 4), feedback visual adicional, vibração do controller ao
errar um módulo, e tutorial inicial. Não iniciada porque as fases 1-5 já
consomem o essencial do MVP jogável, e o CLAUDE.md marca isso como
opcional em caso de aperto de prazo — mas posso seguir para ela também se
for a prioridade.
