/* Cuidare — consulta de valores (compartilhado pelas 3 páginas).
   Dois planos, cada um com a sua tabela de valores:
   - Planos Mensais: durações nas linhas; segunda a sexta, segunda a sábado e todos os dias nas colunas.
   - Planos Diários: durações nas linhas; segunda a sexta e sábados, domingos e feriados nas colunas.
   Os valores ficam em precos.js (modo local) ou no servidor (modo servidor). */
(function () {
  'use strict';

  var KEY = 'cuidare.consulta.v1';

  // As chaves 'residencia' e 'consultas' foram mantidas para não perder consultas já salvas.
  var SERVICOS = [
    { v: 'residencia', t: 'Planos Mensais', s: 'Mensal', icon: 'home', modalidade: 'mensal',
      d: 'Cuidados contínuos com segurança, rotina e tranquilidade para toda a família.',
      tags: ['Rotina', 'Segurança', 'Tranquilidade'],
      cols: [{ k: 'seg_sex', t: 'Segunda a sexta' }, { k: 'seg_sab', t: 'Segunda a sábado' }, { k: 'todos', t: 'Todos os dias' }],
      unidade: 'por mês', linhaLabel: 'Plano',
      intro: 'Um(a) cuidador(a) com rotina fixa ao longo do mês, em casa ou durante uma internação, com companhia, segurança e atenção.' },
    { v: 'consultas', t: 'Planos Diários', s: 'Diário', icon: 'clock', modalidade: 'diaria',
      d: 'Cuidado por dia, com flexibilidade e segurança para as suas necessidades.',
      tags: ['Flexibilidade', 'Segurança', 'Por dia'],
      cols: [{ k: 'util', t: 'Segunda a sexta' }, { k: 'fds', t: 'Sábados, domingos e feriados' }],
      unidade: 'por dia', linhaLabel: 'Duração',
      intro: 'Um(a) cuidador(a) somente nos dias em que você precisar, com companhia, segurança e atenção durante todo o período contratado.' }
  ];

  var DURACOES = [
    { v: '6h', t: '6 horas', h: '6 horas', p: 'dia' },
    { v: '8h', t: '8 horas', h: '8 horas', p: 'dia' },
    { v: '12h_dia', t: '12 horas diurnas', h: '12 horas', sub: 'diurnas', p: 'dia', icon: 'sun' },
    { v: '12h_noite', t: '12 horas noturnas', h: '12 horas', sub: 'noturnas', p: 'noite', icon: 'moon' },
    { v: '24h', t: '24 horas', h: '24 horas', sub: 'dia e noite', p: 'integral' }
  ];

  var STEPS = [
    { id: 'servico', label: 'Plano', title: 'Qual plano você procura?',
      help: 'Toque em um plano para ver a tabela de valores.' }
  ];

  function find(list, v) { return list.filter(function (o) { return o.v === v; })[0]; }
  function labelOf(field, v) { var o = find(field === 'servico' ? SERVICOS : field === 'duracao' ? DURACOES : [], v); return o ? o.t : ''; }
  function servico(v) { return find(SERVICOS, v); }

  function porDiaria(a) { var s = servico((a || {}).servico); return !!(s && s.modalidade === 'diaria'); }
  function isMensal(a) { var s = servico((a || {}).servico); return !!(s && s.modalidade === 'mensal'); }
  function stepsFor() { return STEPS; }
  function journeyLabels() { return ['Plano', 'Valores', 'Detalhes']; }
  function optionsFor(field) { return field === 'servico' ? SERVICOS.slice() : []; }

  // Mantém só um plano válido (consultas antigas de hospital ou pós-operatório são descartadas).
  function sanitize(a) {
    var out = {};
    if (a && servico(a.servico)) out.servico = a.servico;
    return out;
  }

  function stepDone(id, a) { return !!(a || {})[id]; }
  function firstIncomplete(a) { return stepDone('servico', a) ? -1 : 0; }
  function isComplete(a) { return firstIncomplete(a) === -1; }

  /* ---------- Valores ---------- */
  function money(v) { return 'R$ ' + String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function ok(v) { return typeof v === 'number' && isFinite(v) && v > 0; }

  // Tabela do plano escolhido. Nunca inventa: sem valor validado, a duração não aparece
  // (ou a célula fica "Sob consulta"); sem nenhuma linha, devolve 'sob_consulta'.
  function calcular(tabela, a) {
    a = a || {};
    var s = servico(a.servico);
    if (!s) return { status: 'incompleto' };
    if (!tabela) return { status: 'sob_consulta', motivo: 'indisponivel' };
    if ((tabela.servicos || []).indexOf(s.v) < 0) return { status: 'sob_consulta', motivo: 'servico' };
    var linhas = [];
    DURACOES.forEach(function (d) {
      var vals = s.cols.map(function (c) {
        var v = s.modalidade === 'mensal'
          ? ((tabela.mensal || {})[d.v] || {})[c.k]
          : ((c.k === 'fds' ? tabela.diariaFds : tabela.diaria) || {})[d.v];
        return ok(v) ? v : null;
      });
      if (vals[0] !== null) linhas.push({ duracao: d.v, valores: vals });
    });
    if (!linhas.length) return { status: 'sob_consulta', motivo: 'sem_preco' };
    return { status: 'ok', modalidade: s.modalidade, linhas: linhas, versao: tabela.versao || '', validadeDias: tabela.validadeDias || 0 };
  }

  // Textos da tabela para exibição.
  function priceText(r, a) {
    var s = servico((a || {}).servico) || SERVICOS[0];
    if (!r || r.status !== 'ok') return { tabela: false, linha: 'Proposta personalizada (valor definido com a equipe)' };
    var linhas = (r.linhas || []).map(function (l) {
      var d = find(DURACOES, l.duracao) || {};
      return { duracao: l.duracao, h: d.h || '', sub: d.sub || '', periodo: d.p || 'dia', icon: d.icon || (d.p === 'integral' ? '24' : 'sun'),
        valores: (l.valores || []).map(function (v) { return v ? money(v) : ''; }) };
    });
    return {
      tabela: true, linhas: linhas, unidade: s.unidade, cols: s.cols.map(function (c) { return c.t; }), linhaLabel: s.linhaLabel,
      linha: s.t + ': ' + linhas.map(function (l) { return l.h + (l.sub ? ' ' + l.sub : '') + ' ' + l.valores.join(' / '); }).join('; ')
    };
  }

  function obterPreco(a) {
    var cfg = (window.CUIDARE_CONFIG || {}).precos || {};
    if (cfg.modo !== 'servidor') return Promise.resolve(calcular(window.CUIDARE_PRECOS, a));
    if (!isComplete(a)) return Promise.resolve({ status: 'incompleto' });
    if (location.protocol === 'file:') return Promise.resolve({ status: 'sob_consulta', motivo: 'indisponivel' });
    var q = new URLSearchParams({ servico: a.servico });
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
      { k: 'servico', step: 0, label: 'Plano', value: labelOf('servico', a.servico) },
      { k: 'modalidade', label: 'Valores', value: porDiaria(a) ? 'Por dia, conforme a duração e o dia da semana' : isMensal(a) ? 'Por mês, conforme a duração e os dias da semana' : '', fixed: true }
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
    KEY: KEY, STEPS: STEPS, stepsFor: stepsFor, journeyLabels: journeyLabels, porDiaria: porDiaria, isMensal: isMensal,
    SERVICOS: SERVICOS, DURACOES: DURACOES,
    optionsFor: optionsFor, sanitize: sanitize, labelOf: labelOf, servico: servico,
    stepDone: stepDone, firstIncomplete: firstIncomplete, isComplete: isComplete,
    calcular: calcular, obterPreco: obterPreco, money: money, priceText: priceText,
    summaryRows: summaryRows,
    load: load, save: save, clear: clear
  };
})();
