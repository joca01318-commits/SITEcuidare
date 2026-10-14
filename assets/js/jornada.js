/* Cuidare — modelo da jornada (perguntas, regras e resumo).
   Compartilhado por /experiencia e /avaliacao. Sem preços. */
(function () {
  'use strict';

  var STORAGE_KEY = 'cuidare.jornada.v1';

  var STEPS = [
    {
      id: 'pessoa', label: 'Cuidado para', kicker: 'Para quem',
      title: 'Para quem estamos buscando cuidado?',
      help: 'Escolha a opção que melhor descreve quem vai receber o cuidado.',
      options: [
        { v: 'mae', t: 'Minha mãe' },
        { v: 'pai', t: 'Meu pai' },
        { v: 'conjuge', t: 'Meu cônjuge' },
        { v: 'familiar', t: 'Outro familiar' },
        { v: 'outra', t: 'Outra pessoa' }
      ]
    },
    {
      id: 'local', label: 'Local', kicker: 'Onde',
      title: 'Onde o atendimento será realizado?',
      help: 'Isso nos ajuda a pensar na rotina e no perfil do profissional.',
      options: [
        { v: 'residencia', t: 'Na residência', d: 'Rotina, companhia e segurança em casa.' },
        { v: 'hospital', t: 'No hospital', d: 'Acompanhamento durante a internação.' },
        { v: 'consultas', t: 'Em consultas e exames', d: 'Companhia nos deslocamentos e na espera.' },
        { v: 'pos_operatorio', t: 'No pós-operatório', d: 'Apoio no período de recuperação.' },
        { v: 'orientacao', t: 'Ainda preciso de orientação', d: 'A equipe ajuda a definir o melhor formato.' }
      ],
      notes: {
        orientacao: 'Sem problema. Siga com o que você já sabe; na avaliação, a equipe ajuda a definir o formato mais adequado.'
      }
    },
    {
      id: 'necessidade', label: 'Necessidade', kicker: 'Necessidade',
      title: 'Qual é a principal necessidade?',
      help: 'Escolha a que mais pesa hoje. Os detalhes ficam para a conversa com a equipe.',
      options: [
        { v: 'companhia', t: 'Companhia e supervisão' },
        { v: 'atividades', t: 'Auxílio nas atividades diárias' },
        { v: 'mobilidade', t: 'Apoio na mobilidade' },
        { v: 'alzheimer_parkinson', t: 'Cuidados relacionados ao Alzheimer ou Parkinson' },
        { v: 'cirurgia', t: 'Recuperação após cirurgia' },
        { v: 'complexidade', t: 'Necessidades de maior complexidade assistencial' },
        { v: 'outra', t: 'Outra necessidade' }
      ],
      notes: {
        alzheimer_parkinson: 'A indicação do profissional depende da avaliação das necessidades e das atribuições legalmente permitidas. Procedimentos de enfermagem são realizados somente por profissionais habilitados.',
        complexidade: 'A indicação do profissional depende da avaliação das necessidades e das atribuições legalmente permitidas. Procedimentos de enfermagem são realizados somente por profissionais habilitados.',
        cirurgia: 'A indicação do profissional depende da avaliação das necessidades e das orientações da equipe de saúde responsável.'
      }
    },
    {
      id: 'horas', label: 'Duração', kicker: 'Duração',
      title: 'Quantas horas de cuidado por dia?',
      help: 'Se ainda não souber, ajudamos a encontrar um ponto de partida.',
      options: [
        { v: '6h', t: '6 horas por dia' },
        { v: '8h', t: '8 horas por dia' },
        { v: '12h_dia', t: '12 horas durante o dia' },
        { v: '12h_noite', t: '12 horas durante a noite' },
        { v: 'nao_sei', t: 'Ainda não sei qual duração é ideal' }
      ]
    },
    {
      id: 'dias', label: 'Dias', kicker: 'Frequência',
      title: 'Em quais dias será necessário?',
      help: 'Pode ser ajustado depois, na proposta.',
      options: [
        { v: 'seg_sex', t: 'Segunda a sexta' },
        { v: 'seg_sab', t: 'Segunda a sábado' },
        { v: 'todos', t: 'Todos os dias' },
        { v: 'pontual', t: 'Atendimento pontual' },
        { v: 'avaliar', t: 'Ainda preciso avaliar' }
      ]
    },
    {
      id: 'inicio', label: 'Início', kicker: 'Quando',
      title: 'Quando o atendimento precisa começar?',
      help: 'Assim organizamos o retorno da equipe na ordem certa.',
      options: [
        { v: 'breve', t: 'O mais breve possível' },
        { v: '7dias', t: 'Nos próximos 7 dias' },
        { v: 'semanas', t: 'Nas próximas semanas' },
        { v: 'pesquisando', t: 'Estou pesquisando para me planejar' }
      ],
      notes: {
        breve: 'Vamos priorizar o seu contato. A disponibilidade de profissionais é confirmada pela equipe.'
      }
    },
    {
      id: 'detalhes', label: 'Detalhes', kicker: 'Detalhes', type: 'form',
      title: 'Para finalizar, só o essencial.',
      help: 'Não pedimos documentos, endereço completo nem dados clínicos nesta etapa.'
    }
  ];

  var SITUACAO = [
    { v: 'procurando', t: 'Estou começando a procurar' },
    { v: 'ja_tem', t: 'Já tem cuidador(a) e quero avaliar outra opção' }
  ];

  // Opções disponíveis conforme respostas anteriores (perguntas condicionais).
  function optionsFor(stepId, a) {
    var step = byId(stepId);
    if (!step || !step.options) return [];
    var opts = step.options.slice();
    a = a || {};
    if (stepId === 'necessidade' && a.local === 'pos_operatorio') {
      opts.sort(function (x, y) { return (y.v === 'cirurgia') - (x.v === 'cirurgia'); });
      opts = opts.map(function (o) { return o.v === 'cirurgia' ? Object.assign({}, o, { tag: 'Combina com sua escolha' }) : o; });
    }
    if (stepId === 'horas' && a.local === 'consultas') {
      opts = opts.filter(function (o) { return ['6h', '8h', 'nao_sei'].indexOf(o.v) > -1; });
    }
    if (stepId === 'dias' && a.local === 'consultas') {
      opts = ['pontual', 'seg_sex', 'avaliar'].map(function (v) { return opts.filter(function (o) { return o.v === v; })[0]; });
      opts[0] = Object.assign({}, opts[0], { tag: 'Mais comum para consultas' });
    }
    if (stepId === 'dias' && a.local === 'hospital') {
      opts = opts.map(function (o) { return o.v === 'todos' ? Object.assign({}, o, { tag: 'Comum durante a internação' }) : o; });
    }
    return opts;
  }

  // Mantém só respostas ainda válidas depois de uma mudança anterior.
  function sanitize(a) {
    var out = Object.assign({}, a);
    ['necessidade', 'horas', 'dias'].forEach(function (id) {
      if (out[id] && !optionsFor(id, out).some(function (o) { return o.v === out[id]; })) delete out[id];
    });
    return out;
  }

  function byId(id) { return STEPS.filter(function (s) { return s.id === id; })[0]; }

  function labelOf(stepId, v) {
    if (stepId === 'situacao') { var s = SITUACAO.filter(function (o) { return o.v === v; })[0]; return s ? s.t : ''; }
    var step = byId(stepId);
    if (!step || !step.options) return v || '';
    var o = step.options.filter(function (x) { return x.v === v; })[0];
    return o ? o.t : '';
  }

  function isComplete(a) {
    a = a || {};
    return ['pessoa', 'local', 'necessidade', 'horas', 'dias', 'inicio'].every(function (k) { return !!a[k]; }) &&
      !!(a.bairro && a.bairro.trim().length >= 2);
  }

  function firstIncomplete(a) {
    a = a || {};
    for (var i = 0; i < STEPS.length; i++) {
      var s = STEPS[i];
      if (s.type === 'form') { if (!(a.bairro && a.bairro.trim().length >= 2)) return i; }
      else if (!a[s.id]) return i;
    }
    return -1;
  }

  // Prioridade comercial (não é exibida ao visitante).
  function priority(a) {
    var i = (a || {}).inicio;
    if (i === 'breve' || i === '7dias') return 'alta';
    if (i === 'semanas') return 'media';
    if (i === 'pesquisando') return 'baixa';
    return 'indefinida';
  }

  function summaryRows(a) {
    a = a || {};
    var rows = [
      { step: 0, k: 'pessoa', label: 'Pessoa que receberá os cuidados', value: labelOf('pessoa', a.pessoa) },
      { step: 1, k: 'local', label: 'Local do atendimento', value: labelOf('local', a.local) },
      { step: 2, k: 'necessidade', label: 'Tipo de necessidade', value: labelOf('necessidade', a.necessidade) },
      { step: 3, k: 'horas', label: 'Duração desejada', value: labelOf('horas', a.horas) },
      { step: 4, k: 'dias', label: 'Dias de atendimento', value: labelOf('dias', a.dias) },
      { step: 5, k: 'inicio', label: 'Previsão de início', value: labelOf('inicio', a.inicio) },
      { step: 6, k: 'bairro', label: 'Bairro', value: (a.bairro || '').trim() }
    ];
    if (a.situacao) rows.push({ step: 6, k: 'situacao', label: 'Situação atual', value: labelOf('situacao', a.situacao) });
    if (a.observacoes && a.observacoes.trim()) rows.push({ step: 6, k: 'observacoes', label: 'Observações', value: a.observacoes.trim() });
    return rows;
  }

  function summaryText(a) {
    return summaryRows(a).filter(function (r) { return r.value; })
      .map(function (r) { return '• ' + r.label + ': ' + r.value; }).join('\n');
  }

  function whatsappMessage(a, contact) {
    var lines = ['Olá! Vim pelo site da Cuidare Vila Mariana e gostaria de uma avaliação personalizada.'];
    var s = a && Object.keys(a).length ? summaryText(a) : '';
    if (s) lines.push('', s);
    contact = contact || {};
    var extra = [];
    if (contact.nome) extra.push('Meu nome é ' + contact.nome.trim() + '.');
    if (contact.periodo) extra.push('Prefiro contato no período da ' + contact.periodo + '.');
    if (extra.length) lines.push('', extra.join(' '));
    return lines.join('\n');
  }

  function load() {
    try { var raw = sessionStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : { answers: {} }; }
    catch (e) { return { answers: {} }; }
  }
  function save(state) {
    try { state.updatedAt = Date.now(); sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* modo privado */ }
  }
  function clear() { try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ } }

  window.CuidareJornada = {
    STEPS: STEPS, SITUACAO: SITUACAO,
    optionsFor: optionsFor, sanitize: sanitize, labelOf: labelOf,
    isComplete: isComplete, firstIncomplete: firstIncomplete, priority: priority,
    summaryRows: summaryRows, summaryText: summaryText, whatsappMessage: whatsappMessage,
    load: load, save: save, clear: clear
  };
})();
