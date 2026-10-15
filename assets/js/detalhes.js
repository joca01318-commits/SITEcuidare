/* Cuidare — página 3: resumo e detalhes do atendimento escolhido. */
(function () {
  'use strict';
  var C = window.Cuidare, K = window.CuidareConsulta;
  if (!C || !K) return;
  var $ = C.$, esc = C.esc;
  var ICON = function (id) { return '<svg aria-hidden="true"><use href="#i-' + id + '"/></svg>'; };

  var a = K.load().a;
  var price = { status: 'incompleto' };

  function editUrl(step) { return C.pageUrl('', '?etapa=' + (step + 1) + '&retorno=1') + '#consulta'; }
  function hasConfig() { return !!(a.servico && a.duracao && a.frequencia); }
  function mensal() { return a.frequencia && a.frequencia !== 'pontual'; }

  /* ---------- Sem consulta ---------- */
  function empty() {
    $('[data-full]').hidden = true;
    document.documentElement.setAttribute('data-dt', 'empty');
    var j = $('[data-jstep]');
    if (j) Array.prototype.forEach.call(j.children, function (li, i) { li.className = i === 0 ? 'is-current' : ''; });
  }

  /* ---------- Resumo ---------- */
  function rowIcon(k) { return { servico: (K.servico(a.servico) || {}).icon || 'heart', duracao: 'clock', frequencia: 'calendar', bairro: 'pin', inicio: 'clock', necessidades: 'heart' }[k]; }

  function renderSummary() {
    var p = K.priceText(price, a), ok = price.status === 'ok';
    var rows = K.summaryRows(a).filter(function (r) { return !r.optional || r.value; });
    $('[data-dt-sum]').innerHTML = '<h2 class="aside__t">Resumo do seu atendimento</h2>' +
      '<div class="sum">' + rows.map(function (r) {
        return '<div class="sum__row"><span class="sum__i">' + ICON(rowIcon(r.k)) + '</span><dl class="sum__txt"><dt>' + r.label + '</dt><dd' + (r.value ? '' : ' class="is-empty"') + '>' + (r.value ? esc(r.value) : 'A definir') + '</dd></dl>' +
          '<a class="sum__edit" href="' + editUrl(r.step) + '" aria-label="Editar ' + r.label + '">Editar</a></div>';
      }).join('') + '</div>' +
      '<div class="dt__price" data-dt-price>' +
      '<p class="pcard__label">' + (ok ? 'Valor correspondente' : 'Valor') + '</p>' +
      (ok
        ? '<p class="pcard__price"><span class="pcard__v">' + esc(p.valor) + '</span><span class="pcard__u">' + esc(p.unidade) + '</span></p><p class="pcard__d">' + esc(p.detalhe) + '</p>'
        : '<p class="pcard__price"><span class="pcard__v" style="font-size:2rem">Proposta personalizada</span></p><p class="pcard__d">Definido com a equipe, a partir da sua necessidade.</p>') +
      '</div>' +
      '<p class="aside__foot">' + ICON('info') + '<span>' + (ok ? 'Valor de tabela' + (price.validadeDias ? ', válido por ' + price.validadeDias + ' dias' : '') + '. Contratação confirmada após a avaliação gratuita.' : 'Sem valor de tabela para esta combinação. A equipe envia a proposta.') + '</span></p>';
  }

  /* ---------- Informações do serviço (somente o pertinente à escolha) ---------- */
  function card(icon, title, items, cls, wide) {
    return '<article class="info__card' + (wide ? ' info__card--wide' : '') + '"><h3><span class="ic">' + ICON(icon) + '</span>' + title + '</h3>' +
      '<ul class="ticks' + (cls ? ' ' + cls : '') + '">' + items.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></article>';
  }

  function renderInfo() {
    var s = K.servico(a.servico) || {};
    var nec = a.necessidades || [];
    var sensitive = a.servico === 'pos_operatorio' || nec.indexOf('alzheimer_parkinson') > -1 || nec.indexOf('cirurgia') > -1;
    var dias = price.validadeDias || 5;

    var incluido = [
      'Cuidador(a) ou técnico(a) de enfermagem selecionado(a) para o perfil do atendimento, com documentos, cursos, referências e entrevista presencial verificados.',
      'Auxílio na rotina, com companhia, segurança e atenção, respeitando as limitações de quem recebe o cuidado.',
      'Substituição do profissional em caso de falta.',
      'Troca do cuidador, se não houver adaptação.'
    ];
    if (mensal()) incluido.push('Acompanhamento da supervisão: visita mensal, relatórios do suporte ou grupo com a equipe.');
    incluido.push('Transporte do cuidador: responsabilidade da Cuidare.', 'Contratação pela Cuidare, sem vínculo trabalhista para a família.');

    var naoInclui = [
      'Procedimentos invasivos.',
      'Faxina, culinária e lavanderia dos demais moradores.',
      'Procedimentos de enfermagem são realizados somente por profissionais habilitados. O cuidador auxilia com os medicamentos conforme as orientações.'
    ];

    var contratacao = [
      'A equipe confirma os detalhes com você e agenda a visita de avaliação, gratuita.',
      'Você recebe a proposta, válida por ' + dias + ' dias.',
      'Pagamento por boleto, Pix ou transferência, antes do início do atendimento.',
      'Início do atendimento, com validação do cuidador nos primeiros 5 dias.'
    ];

    var avaliacao = [
      'A visita e a avaliação são gratuitas, com horário agendado.',
      'A equipe entende a rotina e as necessidades para buscar o perfil de profissional compatível.'
    ];
    if (sensitive) avaliacao.push('A indicação do profissional considera as atribuições permitidas ao cuidador e as orientações da equipe de saúde responsável.');

    var condicoes = ['Disponibilidade de profissional para o período e o início desejados.'];
    if (price.status === 'ok') condicoes.push('O valor apresentado é o de tabela para a configuração escolhida. A contratação é confirmada após a avaliação.');
    else condicoes.push('O valor desta configuração é definido na proposta personalizada.');
    condicoes.push('Alimentação do cuidador: responsabilidade da família. Se não for possível, há adicional de R$ 30 por dia.');
    if (mensal()) condicoes.push('Cancelamento sem multa, com aviso de 30 dias.');

    $('[data-dt-info]').innerHTML =
      card('shield', 'O que está incluído', incluido) +
      card('info', 'O que não está incluído', naoInclui, 'ticks--no') +
      card('doc', 'Como funciona a contratação', contratacao, 'ticks--steps') +
      card('eye', 'Como é feita a avaliação', avaliacao) +
      card('calendar', 'Condições a confirmar', condicoes, '', true);

    var title = s.t || 'seu atendimento';
    var cut = title.lastIndexOf(' ');
    $('[data-dt-title]').innerHTML = cut > 0 ? esc(title.slice(0, cut)) + ' <em>' + esc(title.slice(cut + 1)) + '.</em>' : '<em>' + esc(title) + '.</em>';
    $('[data-dt-intro]').textContent = s.intro || '';
    var h = $('[data-dt-title]'); h.setAttribute('data-intro', ''); h.setAttribute('data-split', '');
    C.reveal($('[data-full]'));
    document.title = title + ' — detalhes · Cuidare Vila Mariana';
  }

  function renderEnd() {
    $('[data-dt-end]').innerHTML =
      '<a class="btn btn--glass btn--lg" href="' + C.pageUrl('valor') + '">' + ICON('arrow').replace('<svg', '<svg style="transform:scaleX(-1)"') + '<span>Voltar ao valor</span></a>' +
      '<a class="price__change" href="' + editUrl(0) + '">' + ICON('edit') + 'Alterar minhas escolhas</a>';
  }

  /* ---------- Início ---------- */
  if (!hasConfig()) { empty(); return; }
  K.obterPreco(a).then(function (r) {
    price = r;
    renderSummary();
    renderInfo();
    renderEnd();
    C.track('details_view', { status: r.status, duracao: a.duracao, frequencia: a.frequencia });
    if (location.hash) { var t = $(location.hash); if (t) t.scrollIntoView(); }
  });
})();
