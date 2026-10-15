/* Cuidare — consulta de valores (compartilhado pelas 3 páginas).
   Opções, perguntas condicionais, estado da consulta e cálculo do valor da
   configuração escolhida.
   Os valores ficam em precos.js (modo local) ou no servidor (modo servidor). */
(function () {
  'use strict';

  var KEY = 'cuidare.consulta.v1';

  var SERVICOS = [
    { v: 'residencia', t: 'Cuidados em residência', s: 'Em casa', icon: 'home',
      d: 'Apoio na rotina no conforto de casa, com companhia, segurança e atenção.',
      tags: ['Rotina', 'Companhia', 'Segurança'],
      intro: 'Um(a) cuidador(a) na sua casa, no período contratado, auxiliando na rotina com companhia, segurança e atenção, respeitando as limitações de quem recebe o cuidado.' },
    { v: 'hospital', t: 'Acompanhamento hospitalar', s: 'No hospital', icon: 'hospital',
      d: 'Presença de um(a) cuidador(a) durante a internação, no período contratado.',
      tags: ['Internação', 'Presença', 'Atenção'],
      intro: 'Um(a) cuidador(a) acompanhando a internação no período contratado, com companhia e atenção à rotina do paciente.' },
    { v: 'pos_operatorio', t: 'Pós-operatório', s: 'Recuperação', icon: 'heart',
      d: 'Apoio na rotina durante a recuperação, seguindo as orientações da equipe de saúde.',
      tags: ['Recuperação', 'Rotina', 'Atenção'],
      intro: 'Apoio na rotina durante a recuperação, nas atribuições do(a) cuidador(a) e conforme as orientações da equipe de saúde responsável.' },
    { v: 'consultas', t: 'Consultas e exames', s: 'Consultas', icon: 'calendar',
      d: 'Acompanhamento em consultas médicas e exames.',
      tags: ['Consultas', 'Exames', 'Companhia'],
      intro: 'Um(a) cuidador(a) acompanhando consultas médicas e exames, com companhia e atenção durante todo o período contratado.' }
  ];

  var DURACOES = [
    { v: '6h', t: '6 horas por dia', n: '6h', d: 'Presença diária para organizar a rotina.' },
    { v: '8h', t: '8 horas por dia', n: '8h', d: 'Mais tempo de acompanhamento durante o dia.' },
    { v: '12h_dia', t: '12 horas durante o dia', n: '12h', icon: 'sun', d: 'Cuidado prolongado no período diurno.' },
    { v: '12h_noite', t: '12 horas durante a noite', n: '12h', icon: 'moon', d: 'Cuidado prolongado no período noturno.' },
    { v: 'nao_sei', t: 'Ainda não sei', n: '?', d: 'A equipe ajuda a definir a duração ideal.' }
  ];

  var FREQUENCIAS = [
    { v: 'seg_sex', t: 'Segunda a sexta', d: '22 dias por mês', dias: 22 },
    { v: 'seg_sab', t: 'Segunda a sábado', d: '26 dias por mês', dias: 26 },
    { v: 'todos', t: 'Todos os dias', d: '30 dias por mês', dias: 30 },
    { v: 'pontual', t: 'Atendimento pontual', d: 'Valor por diária' }
  ];

  var STEPS = [
    { id: 'servico', label: 'Atendimento', title: 'Qual atendimento você procura?',
      help: 'Escolha uma opção. Em seguida, você define a duração e a frequência.' },
    { id: 'duracao', label: 'Duração', title: 'Quantas horas de cuidado por dia?',
      help: 'Escolha a duração desejada. Se ainda não souber, a equipe ajuda a definir.' },
    { id: 'frequencia', label: 'Frequência', title: 'Com que frequência?',
      help: 'Os planos mensais consideram 22, 26 ou 30 dias. O atendimento pontual é cobrado por diária.' }
  ];

  var LISTS = { servico: SERVICOS, duracao: DURACOES, frequencia: FREQUENCIAS };

  function find(list, v) { return list.filter(function (o) { return o.v === v; })[0]; }
  function labelOf(field, v) { var o = find(LISTS[field] || [], v); return o ? o.t : ''; }
  function servico(v) { return find(SERVICOS, v); }

  // Opções disponíveis conforme as escolhas anteriores (perguntas condicionais).
  function optionsFor(field, a) {
    a = a || {};
    var list = (LISTS[field] || []).slice();
    if (field === 'duracao' && a.servico === 'consultas') {
      list = list.filter(function (o) { return ['6h', '8h', 'nao_sei'].indexOf(o.v) > -1; });
    }
    if (field === 'frequencia' && a.servico === 'consultas') {
      list = ['pontual', 'seg_sex', 'seg_sab', 'todos'].map(function (v) { return find(FREQUENCIAS, v); });
      list[0] = Object.assign({}, list[0], { tag: 'Mais comum para consultas' });
    }
    return list;
  }

  // Mantém só escolhas que continuam válidas depois de mudar uma anterior.
  function sanitize(a) {
    var out = Object.assign({}, a || {});
    ['servico', 'duracao', 'frequencia'].forEach(function (k) {
      if (out[k] && !find(optionsFor(k, out), out[k])) delete out[k];
    });
    // campos da versão anterior (bairro, início, necessidades) não são mais usados
    delete out.bairro; delete out.inicio; delete out.necessidades;
    return out;
  }

  function stepDone(id, a) { return !!(a || {})[id]; }
  function firstIncomplete(a) {
    for (var i = 0; i < STEPS.length; i++) if (!stepDone(STEPS[i].id, a)) return i;
    return -1;
  }
  function isComplete(a) { return firstIncomplete(a) === -1; }

  /* ---------- Valor ---------- */
  function money(v) { return 'R$ ' + String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  // Calcula o valor SOMENTE da configuração escolhida. Nunca inventa: sem valor validado,
  // devolve status 'sob_consulta' (proposta personalizada).
  function calcular(tabela, a) {
    a = a || {};
    if (!a.servico || !a.duracao || !a.frequencia) return { status: 'incompleto' };
    if (!tabela) return { status: 'sob_consulta', motivo: 'indisponivel' };
    if ((tabela.servicos || []).indexOf(a.servico) < 0) return { status: 'sob_consulta', motivo: 'servico' };
    if (a.duracao === 'nao_sei') return { status: 'sob_consulta', motivo: 'duracao' };
    var valor, modalidade, dias;
    if (a.frequencia === 'pontual') {
      modalidade = 'diaria';
      valor = tabela.diaria && tabela.diaria[a.duracao];
    } else {
      modalidade = 'mensal';
      var linha = tabela.mensal && tabela.mensal[a.duracao];
      valor = linha && linha[a.frequencia];
      dias = (find(FREQUENCIAS, a.frequencia) || {}).dias;
    }
    if (typeof valor !== 'number' || !isFinite(valor) || valor <= 0) return { status: 'sob_consulta', motivo: 'sem_preco' };
    var r = { status: 'ok', valor: valor, modalidade: modalidade, versao: tabela.versao || '', validadeDias: tabela.validadeDias || 0 };
    if (dias) r.dias = dias;
    return r;
  }

  // Textos do valor para exibição e mensagens.
  function priceText(r, a) {
    if (!r || r.status !== 'ok') return { valor: '', unidade: '', detalhe: '', linha: 'Proposta personalizada (valor definido com a equipe)' };
    var freq = labelOf('frequencia', (a || {}).frequencia).toLowerCase();
    var unidade = r.modalidade === 'diaria' ? 'por diária' : 'por mês';
    var detalhe = r.modalidade === 'diaria'
      ? 'Atendimento pontual · ' + labelOf('duracao', a.duracao)
      : r.dias + ' dias de atendimento (' + freq + ')';
    return { valor: money(r.valor), unidade: unidade, detalhe: detalhe, linha: money(r.valor) + ' ' + unidade + (r.dias ? ' (' + r.dias + ' dias)' : '') };
  }

  function obterPreco(a) {
    var cfg = (window.CUIDARE_CONFIG || {}).precos || {};
    if (cfg.modo !== 'servidor') return Promise.resolve(calcular(window.CUIDARE_PRECOS, a));
    if (!a || !a.servico || !a.duracao || !a.frequencia) return Promise.resolve({ status: 'incompleto' });
    if (location.protocol === 'file:') return Promise.resolve({ status: 'sob_consulta', motivo: 'indisponivel' });
    var q = new URLSearchParams({ servico: a.servico, duracao: a.duracao, frequencia: a.frequencia });
    var ctrl = 'AbortController' in window ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, cfg.timeoutMs || 8000);
    return fetch((cfg.endpoint || '/api/preco') + '?' + q, { signal: ctrl ? ctrl.signal : undefined, headers: { accept: 'application/json' } })
      .then(function (res) { if (!res.ok) throw new Error('http_' + res.status); return res.json(); })
      .then(function (r) { clearTimeout(timer); return r && (r.status === 'ok' || r.status === 'sob_consulta') ? r : { status: 'sob_consulta', motivo: 'indisponivel' }; })
      .catch(function () { clearTimeout(timer); return { status: 'sob_consulta', motivo: 'indisponivel' }; });
  }

  /* ---------- Resumo ---------- */
  function summaryRows(a) {
    a = a || {};
    return [
      { k: 'servico', step: 0, label: 'Atendimento', value: labelOf('servico', a.servico) },
      { k: 'duracao', step: 1, label: 'Duração', value: labelOf('duracao', a.duracao) },
      { k: 'frequencia', step: 2, label: 'Frequência', value: labelOf('frequencia', a.frequencia) }
    ];
  }

  /* ---------- Estado (somente nesta aba do navegador) ---------- */
  function load() {
    try { var raw = sessionStorage.getItem(KEY); var s = raw ? JSON.parse(raw) : null; return { a: sanitize((s && s.a) || {}) }; }
    catch (e) { return { a: {} }; }
  }
  function save(state) {
    try { sessionStorage.setItem(KEY, JSON.stringify({ a: state.a, updatedAt: Date.now() })); } catch (e) { /* modo privado */ }
  }
  function clear() { try { sessionStorage.removeItem(KEY); } catch (e) { /* noop */ } }

  window.CuidareConsulta = {
    KEY: KEY, STEPS: STEPS, SERVICOS: SERVICOS, DURACOES: DURACOES, FREQUENCIAS: FREQUENCIAS,
    optionsFor: optionsFor, sanitize: sanitize, labelOf: labelOf, servico: servico,
    stepDone: stepDone, firstIncomplete: firstIncomplete, isComplete: isComplete,
    calcular: calcular, obterPreco: obterPreco, money: money, priceText: priceText,
    summaryRows: summaryRows,
    load: load, save: save, clear: clear
  };
})();
