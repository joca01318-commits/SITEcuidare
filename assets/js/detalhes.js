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
  function hasConfig() { return K.isComplete(a); }
  function mensal() { return K.isMensal(a); }

  /* ---------- Sem consulta ---------- */
  function empty() {
    $('[data-full]').hidden = true;
    document.documentElement.setAttribute('data-dt', 'empty');
    var j = $('[data-jstep]');
    if (j) Array.prototype.forEach.call(j.children, function (li, i) { li.className = i === 0 ? 'is-current' : ''; });
  }

  /* ---------- Resumo ---------- */
  function rowIcon(k) { return { servico: (K.servico(a.servico) || {}).icon || 'heart', duracao: 'clock', frequencia: 'calendar', modalidade: 'calendar' }[k]; }

  function renderSummary() {
    var p = K.priceText(price, a), ok = price.status === 'ok';
    var rows = K.summaryRows(a);
    $('[data-dt-sum]').innerHTML = '<h2 class="aside__t">Resumo do seu atendimento</h2>' +
      '<div class="sum">' + rows.map(function (r) {
        return '<div class="sum__row"><span class="sum__i">' + ICON(rowIcon(r.k)) + '</span><dl class="sum__txt"><dt>' + r.label + '</dt><dd' + (r.value ? '' : ' class="is-empty"') + '>' + (r.value ? esc(r.value) : 'A definir') + '</dd></dl>' +
          (r.fixed ? '' : '<a class="sum__edit" href="' + editUrl(r.step) + '" aria-label="Editar ' + r.label + '">Editar</a>') + '</div>';
      }).join('') + '</div>' +
      '<div class="dt__price" data-dt-price>' +
      '<p class="pcard__label">' + (ok ? 'Valor correspondente' : 'Valor') + '</p>' +
      (ok
        ? '<p class="pcard__price"><span class="pcard__v">' + esc(p.valor) + '</span><span class="pcard__u">' + esc(p.unidade) + '</span></p><p class="pcard__d">' + esc(p.detalhe) + '</p>' +
          (p.fds ? '<p class="pcard__alt"><span class="pcard__alt-l">' + esc(p.fds.label) + '</span><span class="pcard__alt-v">' + esc(p.fds.valor) + ' <small>' + esc(p.fds.unidade) + '</small></span></p>' : '')
        : '<p class="pcard__price"><span class="pcard__v" style="font-size:2rem">Proposta personalizada</span></p><p class="pcard__d">Definido com a equipe, a partir da sua necessidade.</p>') +
      '</div>' +
      '<p class="aside__foot">' + ICON('info') + '<span>' + (ok ? 'Valor de tabela para esta configuração' + (price.validadeDias ? '. Orçamento válido por ' + price.validadeDias + ' dias' : '') + '.' : 'Sem valor de tabela para esta combinação. A equipe envia a proposta.') + '</span></p>';
  }

  /* ---------- Informações do serviço (somente o pertinente à escolha) ---------- */
  function card(icon, title, items, cls, wide) {
    return '<article class="info__card' + (wide ? ' info__card--wide' : '') + '"><h3><span class="ic">' + ICON(icon) + '</span>' + title + '</h3>' +
      '<ul class="ticks' + (cls ? ' ' + cls : '') + '">' + items.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></article>';
  }

  function renderInfo() {
    var s = K.servico(a.servico) || {};
    var dias = price.validadeDias || 5;

    // Textos da "Descrição dos serviços ofertados pela Cuidare" (Proposta Personalizada de Cuidados, 2026).
    var onde = {
      residencia: 'Acompanhamento e assistência de um cuidador no domicílio do assistido.',
      hospital: 'Acompanhamento e assistência de um cuidador durante a internação.',
      pos_operatorio: 'Acompanhamento e assistência de um cuidador durante a recuperação.',
      consultas: 'Acompanhamento e assistência de um cuidador em consultas e exames.'
    }[a.servico] || 'Acompanhamento e assistência de um cuidador.';

    var rotina = [
      onde,
      'Auxiliar o assistido nas atividades diárias: alimentação, higiene pessoal, lazer etc.',
      'Troca da roupa de cama do paciente.',
      'Favorecer sua inclusão social.',
      'Estimular a autonomia, autoestima e segurança pessoal.',
      'Evolução diária do assistido.'
    ];

    var saude = [
      'Profissionais com satisfatório conhecimento em Saúde Mental.',
      'Seguir as orientações dos terapeutas e da família (psiquiatra, geriatra, psicólogo, fisioterapeuta etc.).',
      'Auxiliar na segurança, integridade física e psíquica nas ocorrências de agitação psicomotora (crises) do assistido.',
      'Auxiliar na prevenção de crises e consequentes danos, traumas e riscos à saúde física e psíquica.',
      'Administração e checagem de medicação.',
      'Nos casos de pacientes diagnosticados com Diabetes Mellitus: verificação da glicemia.',
      'Verificação de sinais vitais (pressão arterial, temperatura, frequência cardíaca e frequência respiratória).'
    ];

    var suporte = [
      'Profissionais treinados e capacitados periodicamente, com documentos, cursos, referências e entrevista presencial verificados.',
      'A Cuidare responde de forma técnica, gerencial e legal pela equipe contratada.',
      'Substituição do profissional em caso de falta.',
      'Troca do cuidador, se não houver adaptação.'
    ];
    if (mensal()) suporte.push('Acompanhamento da supervisão: visita mensal, relatórios do suporte ou grupo com a equipe.');
    suporte.push('Transporte do cuidador: responsabilidade da Cuidare.');

    var contratacao = [
      'Orçamento válido por ' + dias + ' dias.',
      'Pagamento por boleto, Pix ou transferência, antes do início do atendimento.',
      'Início do atendimento, com validação do cuidador nos primeiros 5 dias.'
    ];
    if (mensal()) contratacao.push('Cancelamento sem multa, com aviso de 30 dias.');

    var condicoes = [
      'Não fazem parte das atribuições dos cuidadores serviços como faxina residencial, culinária e lavanderia para os demais residentes do local. Fazem parte a limpeza concorrente e o preparo de refeições simples (quando o assistido não corre risco; a prioridade sempre será o cuidado com o assistido).',
      'O cuidador não realiza procedimentos invasivos.',
      'É de responsabilidade do contratante a alimentação básica dos cuidadores.',
      'O contratante não possui qualquer vínculo empregatício com os profissionais contratados.',
      price.status === 'ok' ? 'O valor apresentado é o de tabela para a configuração escolhida, sujeito à disponibilidade de profissional.' : 'O valor desta configuração é definido na proposta personalizada.'
    ];

    $('[data-dt-info]').innerHTML =
      card('heart', 'Cuidado e rotina do assistido', rotina) +
      card('shield', 'Saúde, segurança e orientações', saude) +
      card('users', 'Suporte da Cuidare', suporte) +
      card('doc', 'Como funciona a contratação', contratacao, 'ticks--steps') +
      card('info', 'Condições do serviço', condicoes, '', true);

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
  var labels = K.journeyLabels(a);
  C.journey(labels, labels.length - 1);
  K.obterPreco(a).then(function (r) {
    price = r;
    renderSummary();
    renderInfo();
    renderEnd();
    C.track('details_view', { status: r.status, duracao: a.duracao, frequencia: a.frequencia });
    if (location.hash) { var t = $(location.hash); if (t) t.scrollIntoView(); }
  });
})();
