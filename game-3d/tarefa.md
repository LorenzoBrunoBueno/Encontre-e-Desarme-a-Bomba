# Instrução para Claude Code — Setup do IWER (Immersive Web Emulation Runtime)

## Objetivo
Configurar o IWER neste projeto WebXR para permitir testes automatizados de interações
controladas (posição de controle, raycasting, input de botões), sem depender do headset físico
ou de emulação manual via IWE (Immersive Web Emulator).

O caso de uso principal é testar fluxos de input precisos, como digitar um PIN em um teclado
virtual, garantindo que cada tecla registre o valor correto ao ser "pressionada" pelo controle
virtual.

## Antes de começar: investigue o projeto
Antes de escrever qualquer código, faça o seguinte reconhecimento e me reporte o que encontrar:

1. Qual biblioteca/engine WebXR o projeto usa (Three.js puro, `@react-three/xr`, Babylon.js,
   A-Frame, WebXR API nativa, etc.) — procure em `package.json` e nos imports do código-fonte.
2. Como o input dos controles é capturado hoje: via `session.inputSources`, eventos
   `selectstart`/`selectend`/`squeeze`, ou uma abstração de mais alto nível de alguma lib.
3. Onde fica o código do teclado virtual (componente, cena ou módulo), e como ele determina
   qual tecla foi "clicada" (raycasting, colisão, distância, etc.) — preciso saber as coordenadas
   ou hitboxes de cada tecla, ou como obtê-las programaticamente.
4. Se já existe alguma suíte de testes automatizados no projeto (Jest, Vitest, Playwright,
   Puppeteer) e qual gerenciador de pacotes é usado (npm, yarn, pnpm).
5. Confirme a versão exata do pacote `iwer` no npm e leia o README/documentação oficial do
   repositório antes de assumir nomes de métodos — a API pode ter mudado desde o treinamento.
   Não invente assinaturas de função; valide no `node_modules/iwer` ou na documentação real.

Se qualquer um desses pontos não estiver claro no código, pare e me pergunte antes de prosseguir,
em vez de assumir uma estrutura genérica.

## O que preciso que você configure

1. **Instalação**: adicione `iwer` como dependência de desenvolvimento e, se ainda não existir,
   configure Playwright (ou Puppeteer, se já for o padrão do projeto) para rodar o app em um
   navegador headless/headed apontando para o build local.

2. **Bootstrap do IWER**: crie um script de setup que injete o polyfill do IWER na página antes
   da aplicação inicializar a sessão WebXR (`navigator.xr.requestSession`), criando um headset e
   pelo menos dois controles virtuais (mão esquerda e direita) com poses iniciais configuráveis.

3. **Helper de input**: escreva uma função utilitária, por exemplo `moveControllerTo(pose)` e
   `pressTrigger()` (ou nomes equivalentes que façam sentido dado o binding real do projeto), que:
   - Atualiza a pose (posição + orientação) do controle virtual.
   - Dispara o evento de input correto (`selectstart` → `selectend`, ou `squeeze`, conforme o
     binding usado no jogo).
   - Aguarda o(s) frame(s) necessário(s) para a aplicação processar o input antes de continuar.

4. **Teste do teclado de PIN**: usando os helpers acima, escreva um teste que:
   - Posicione o controle na coordenada de cada tecla do teclado virtual (usando as coordenadas
     reais do projeto, não valores inventados).
   - Simule a sequência completa de dígitos de um PIN válido e verifique que o app reconhece o
     PIN como correto.
   - Cubra pelo menos um caso de PIN incorreto e, se fizer sentido para o projeto, um caso de
     clique fora da hitbox da tecla.
   - Exponha (se ainda não existir) um hook de debug/teste (ex.: `window.__debugState` ou
     equivalente) para leitura do estado atual do PIN digitado, documentando claramente que é
     exclusivo para testes.

5. **Organização**: coloque os scripts em uma pasta de testes E2E existente ou crie uma nova
   (ex.: `tests/e2e/webxr/`), seguindo a convenção já usada no projeto.

## Restrições importantes
- Não assuma que o IWER emula performance real do Meta Quest 3, hand tracking físico, haptics
  ou passthrough — isso continua exigindo teste no hardware. O objetivo aqui é validar lógica de
  input e estado da aplicação, não performance ou fidelidade sensorial.
- Não modifique lógica de produção do teclado só para "facilitar" o teste, a menos que seja
  necessário e você me avise exatamente o que e por que mudou.
- Ao final, rode o teste do PIN e me mostre o resultado (passou/falhou) antes de considerar a
  tarefa concluída.

## Entregável esperado
- Dependência `iwer` instalada e configurada.
- Script(s) de setup do IWER integrados ao runner de testes escolhido.
- Pelo menos um teste E2E funcional cobrindo o fluxo de PIN no teclado virtual.
- Um breve resumo do que foi criado/alterado, incluindo qualquer suposição que você tenha feito
  sobre a arquitetura do projeto.