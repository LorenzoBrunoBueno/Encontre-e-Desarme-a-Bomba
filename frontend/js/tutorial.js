// Tutorial passo a passo mostrado a cada "Entrar em VR" (CLAUDE.md, roteiro
// fase 10 — "tutorial inicial"). Fica inteiramente no /frontend (2D), fora
// da sessão WebXR: é conteúdo explicativo, não interação física, então não
// há motivo pra pagar a complexidade de raycasting/controller dentro da
// cena por isso (time iniciante em WebXR, CLAUDE.md pede simplicidade).
//
// Sem persistência de "já vi": aparece toda vez, mas fechar (✕ ou "Pular
// tutorial") é 1 clique — quem já sabe jogar não é travado por isso.
const STEPS = [
  {
    icon: '🏭',
    title: 'Onde você está',
    body:
      'Você trabalha na Defuse Inc., numa sala de triagem que recebe bombas ' +
      'em fluxo contínuo, sem fases nem ondas separadas. Enquanto uma bomba ' +
      'não é entregue, outra já está a caminho. O tempo total da partida é ' +
      'oculto, sem contador na tela, então não dá pra "esperar parado" pra ' +
      'ver quanto falta.',
  },
  {
    icon: '🕹️',
    title: 'Como se locomover',
    body:
      'A movimentação é por teleporte. Mire o controle num dos discos azuis ' +
      'no chão e aperte o gatilho para se mover até ali. É assim que você ' +
      'circula entre as estações da sala. Dentro do modo de desarme, na ' +
      'mesa, a locomoção fica travada até você sair de lá.',
  },
  {
    icon: '📦',
    title: 'Dispenser',
    body:
      'Uma luz acende no dispenser do teto quando uma nova bomba está pronta. ' +
      'Vá até a caixa de coleta e puxe a alavanca física para soltá-la. Se ' +
      'você demorar demais, ela cai sozinha mesmo assim.',
  },
  {
    icon: '📡',
    title: 'Scanner',
    body:
      'Insira a bomba no slot: a própria inserção já dispara o scan, sem ' +
      'precisar de botão. Ao terminar, sai um panfleto com as instruções ' +
      '(fica preso na bomba) e o holograma no teto central se atualiza. A ' +
      'cada 3 bombas escaneadas o scanner superaquece; resolva puxando a ' +
      'alavanca de purga no centro da sala (3 puxões). Também dá para pular ' +
      'o scanner e levar a bomba direto para a mesa, mas você fica sem o ' +
      'panfleto e o risco de errar o desarme aumenta.',
  },
  {
    icon: '🔧',
    title: 'Mesa de desarme',
    body:
      'Coloque a bomba na mesa e entre no modo de desarme. Toda bomba traz ' +
      '3 desafios ao mesmo tempo: o alicate do cinto (lado direito) corta o ' +
      'fio certo, um botão certo entre 4 cores e uma senha numérica de 4 ' +
      'dígitos. Um botão dedicado gira a bomba 180° e expõe a etapa ' +
      'traseira: 4 parafusos (chave de fenda do cinto) e um núcleo. Essa ' +
      'parte é opcional e não afeta sua nota.',
  },
  {
    icon: '🛫',
    title: 'Esteira',
    body:
      'Arremesse a bomba desarmada contra o carrinho que desliza sobre a ' +
      'esteira para entregá-la. Se você retirou o núcleo na etapa traseira, ' +
      'descarte-o no duto ao lado (arremessando ou só aproximando).',
  },
  {
    icon: '💀',
    title: 'Risco: fusível e reanimação',
    body:
      'Cada bomba tem seu próprio fusível, correndo desde que sai do ' +
      'dispenser, em qualquer estação, o tempo todo. Um alarme sonoro que ' +
      'fica mais rápido e agudo avisa quando o tempo está acabando. Se o ' +
      'fusível zerar, a bomba explode e mata você na hora: a tela escurece ' +
      'e, depois de alguns segundos, você reaparece numa câmara de ' +
      'reanimação, perdendo só um tempo precioso. Se outra bomba explodir ' +
      'antes de você voltar para o jogo, é fim de partida.',
  },
  {
    icon: '🏁',
    title: 'Pontuação',
    body:
      'Você não sabe na hora se acertou ou errou: o resultado de cada bomba ' +
      'só aparece no relatório final, junto da sua pontuação e do número de ' +
      'mortes. Uma música de tensão nos últimos ~15 segundos é o único ' +
      'aviso de que o tempo está acabando.',
  },
];

export function setupTutorialModal({ onDone }) {
  const scrim = document.getElementById('tutorial-scrim');
  const iconEl = document.getElementById('tutorial-icon');
  const titleEl = document.getElementById('tutorial-title');
  const bodyEl = document.getElementById('tutorial-body');
  const dotsEl = document.getElementById('tutorial-dots');
  const prevBtn = document.getElementById('tutorial-prev');
  const nextBtn = document.getElementById('tutorial-next');
  const skipBtn = document.getElementById('tutorial-skip');
  const closeBtn = document.getElementById('tutorial-close');

  let stepIndex = 0;

  dotsEl.innerHTML = STEPS.map((_, i) => `<span class="tutorial-dot" data-index="${i}"></span>`).join('');
  const dots = Array.from(dotsEl.querySelectorAll('.tutorial-dot'));
  dots.forEach((dot) => {
    dot.addEventListener('click', () => renderStep(Number(dot.dataset.index)));
  });

  function renderStep(index) {
    stepIndex = index;
    const step = STEPS[stepIndex];
    iconEl.textContent = step.icon;
    titleEl.textContent = step.title;
    bodyEl.textContent = step.body;
    dots.forEach((dot, i) => dot.classList.toggle('active', i === stepIndex));
    prevBtn.disabled = stepIndex === 0;
    const isLast = stepIndex === STEPS.length - 1;
    nextBtn.textContent = isLast ? 'Jogar' : 'Próximo';
  }

  function open() {
    scrim.hidden = false;
    renderStep(0);
  }

  function close() {
    scrim.hidden = true;
  }

  prevBtn.addEventListener('click', () => {
    if (stepIndex > 0) renderStep(stepIndex - 1);
  });

  nextBtn.addEventListener('click', () => {
    if (stepIndex < STEPS.length - 1) {
      renderStep(stepIndex + 1);
    } else {
      close();
      onDone();
    }
  });

  // Fechar por qualquer via (✕ ou "pular") equivale a "já sei jogar" — vai
  // direto pra VR, não volta pra home sem fazer nada.
  skipBtn.addEventListener('click', () => {
    close();
    onDone();
  });
  closeBtn.addEventListener('click', () => {
    close();
    onDone();
  });

  return { open, close };
}
