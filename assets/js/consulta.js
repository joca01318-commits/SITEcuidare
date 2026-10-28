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
      duracoes: ['12h_dia', '12h_noite', '24h', 'nao_sei'],
      d: 'Presença de um(a) cuidador(a) durante a internação, no período contratado.',
      tags: ['Internação', 'Presença', 'Atenção'],
      intro: 'Um(a) cuidador(a) acompanhando a internação no período contratado, com companhia e atenção à rotina do paciente.' },
    { v: 'consultas', t: 'Atendimento por dia', s: 'Por dia', icon: 'calendar',
      diaria: ['6h', '8h', '12h_dia', '12h_noite', '24h'], linhaLabel: 'Duração do atendimento',
      d: 'Acompanhamento em consultas médicas e exames.',
      tags: ['Consultas', 'Exames', 'Companhia'],
      intro: 'Um(a) cuidador(a) acompanhando consultas médicas e exames, com companhia e atenção durante todo o período contratado.' }
  ];

  var DURACOES = [
    { v: '6h', t: '6 horas por dia', n: '6h', h: '6 horas', p: 'dia', d: 'Presença diária para organizar a rotina.' },
    { v: '8h', t: '8 horas por dia', n: '8h', h: '8 horas', p: 'dia', d: 'Mais tempo de acompanhamento durante o dia.' },
    { v: '12h_dia', t: '12 horas durante o dia', n: '12h', h: '12 horas', sub: 'diurno', p: 'dia', icon: 'sun', d: 'Cuidado prolongado no período diurno.' },
    { v: '12h_noite', t: '12 horas durante a noite', n: '12h', h: '12 horas', sub: 'noturno', p: 'noite', icon: 'moon', d: 'Cuidado prolongado no período noturno.' },
    { v: '24h', t: '24 horas por dia', n: '24h', h: '24 horas', sub: 'dia e noite', p: 'integral', d: 'Cobertura integral para uma rotina que exige presença contínua.' },
    { v: 'nao_sei', t: 'Ainda não sei', n: '?', d: 'A equipe ajuda a definir a duração ideal.' }
  ];

  var FREQUENCIAS = [
    { v: 'seg_sex', t: 'Segunda a sexta', d: 'Plano mensal · 22 plantões', dias: 22 },
    { v: 'seg_sab', t: 'Segunda a sábado', d: 'Plano mensal · 26 plantões', dias: 26 },
    { v: 'todos', t: 'Segunda a segunda', d: 'Plano mensal · 30 plantões', dias: 30 }
  ];

  var STEPS = [
    { id: 'servico', label: 'Atendimento', title: 'Qual atendimento você procura?',
      help: 'Toque em uma opção para avançar. Em atendimento por dia, a tabela de valores por dia aparece em seguida.' },
    { id: 'duracao', label: 'Duração', title: 'Quantas horas de cuidado por dia?',
      help: 'Toque na duração desejada. Se ainda não souber, a equipe ajuda a definir.' },
    { id: 'frequencia', label: 'Frequência', title: 'Com que frequência?',
      help: 'Planos mensais de 22, 26 ou 30 plantões. Toque em uma opção para ver o valor.' }
  ];

  var LISTS = { servico: SERVICOS, duracao: DURACOES, frequencia: FREQUENCIAS };

  function find(list, v) { return list.filter(function (o) { return o.v === v; })[0]; }
  function labelOf(field, v) { var o = find(LISTS[field] || [], v); return o ? o.t : ''; }
  function servico(v) { return find(SERVICOS, v); }

  // Atendimento por dia: tabela de diárias (todas as durações), sem outras etapas.
  // Residência e hospital: planos mensais (duração e frequência); hospital com plantões de 12h e 24h.
  function porDiaria(a) { var s = servico((a || {}).servico); return !!(s && s.diaria); }
  function isMensal(a) { return !!(a && a.servico && !porDiaria(a)); }
  function stepsFor(a) { return porDiaria(a) ? STEPS.slice(0, 1) : STEPS; }
  function journeyLabels(a) {
    return porDiaria(a) ? ['Atendimento', 'Valores', 'Detalhes'] : stepsFor(a).map(function (s) { return s.label; }).concat(['Valor', 'Detalhes']);
  }

  // Opções disponíveis conforme as escolhas anteriores (perguntas condicionais).
  function optionsFor(field, a) {
    a = a || {};
    var list = (LISTS[field] || []).slice();
    var s = servico(a.servico);
    if (field === 'duracao' && s && s.duracoes) list = list.filter(function (o) { return s.duracoes.indexOf(o.v) > -1; });
    return list;
  }

  // Mantém só escolhas que continuam válidas depois de mudar uma anterior.
  function sanitize(a) {
    var out = Object.assign({}, a || {});
    ['servico', 'duracao', 'frequencia'].forEach(function (k) {
      if (out[k] && !find(optionsFor(k, out), out[k])) delete out[k];
    });
    if (porDiaria(out)) { delete out.duracao; delete out.frequencia; }
    // campos da versão anterior (bairro, início, necessidades) não são mais usados
    delete out.bairro; delete out.inicio; delete out.necessidades;
    return out;
  }

  function stepDone(id, a) { return !!(a || {})[id]; }
  function firstIncomplete(a) {
    var st = stepsFor(a);
    for (var i = 0; i < st.length; i++) if (!stepDone(st[i].id, a)) return i;
    return -1;
  }
  function isComplete(a) { return firstIncomplete(a) === -1; }

  /* ---------- Valor ---------- */
  function money(v) { return 'R$ ' + String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

  // Calcula o valor SOMENTE da configuração escolhida. Nunca inventa: sem valor validado,
  // devolve status 'sob_consulta' (proposta personalizada).
  function calcular(tabela, a) {
    a = a || {};
    var diaria = porDiaria(a);
    if (!a.servico || (!diaria && (!a.duracao || !a.frequencia))) return { status: 'incompleto' };
    if (!tabela) return { status: 'sob_consulta', motivo: 'indisponivel' };
    if ((tabela.servicos || []).indexOf(a.servico) < 0) return { status: 'sob_consulta', motivo: 'servico' };
    var ok = function (v) { return typeof v === 'number' && isFinite(v) && v > 0; };
    var r = { status: 'ok', versao: tabela.versao || '', validadeDias: tabela.validadeDias || 0 };
    if (diaria) {
      // tabela de diárias: cada duração do atendimento, de segunda a sexta e em sábados, domingos e feriados
      var linhas = [];
      servico(a.servico).diaria.forEach(function (d) {
        var util = tabela.diaria && tabela.diaria[d], fds = tabela.diariaFds && tabela.diariaFds[d];
        if (!ok(util)) return; // sem valor validado: a duração não aparece
        var l = { duracao: d, valor: util };
        if (ok(fds)) l.valorFds = fds;
        linhas.push(l);
      });
      if (!linhas.length) return { status: 'sob_consulta', motivo: 'sem_preco' };
      r.modalidade = 'diaria'; r.linhas = linhas;
      return r;
    }
    if (a.duracao === 'nao_sei') return { status: 'sob_consulta', motivo: 'duracao' };
    var f = find(FREQUENCIAS, a.frequencia) || {};
    var linha = tabela.mensal && tabela.mensal[a.duracao];
    var valor = linha && linha[a.frequencia];
    if (!ok(valor)) return { status: 'sob_consulta', motivo: 'sem_preco' };
    r.modalidade = 'mensal'; r.valor = valor;
    if (f.dias) r.dias = f.dias;
    var pl = tabela.profissionais && tabela.profissionais[a.duracao];
    if (pl && pl[a.frequencia]) r.profissionais = pl[a.frequencia];
    return r;
  }

  // Textos do valor para exibição.
  function priceText(r, a) {
    if (!r || r.status !== 'ok') return { valor: '', unidade: '', detalhe: '', linha: 'Proposta personalizada (valor definido com a equipe)' };
    a = a || {};
    if (r.modalidade === 'diaria') {
      var linhas = (r.linhas || []).map(function (l) {
        var d = find(DURACOES, l.duracao) || {};
        return { duracao: l.duracao, h: d.h || d.t || '', sub: d.sub || '', periodo: d.p || 'dia', icon: d.icon || (d.p === 'integral' ? '24' : 'sun'),
          valor: money(l.valor), fds: l.valorFds ? money(l.valorFds) : '' };
      });
      return {
        tabela: true, linhas: linhas, unidade: 'por dia',
        cab: { duracao: (servico(a.servico) || {}).linhaLabel || 'Duração', util: 'Segunda a sexta', fds: 'Sábados, domingos e feriados' },
        linha: 'Valores por diária: ' + linhas.map(function (l) { return l.h + (l.sub ? ' ' + l.sub : '') + ' ' + l.valor + (l.fds ? ' / ' + l.fds : ''); }).join('; ')
      };
    }
    var prof = r.profissionais ? ' · ' + r.profissionais + (r.profissionais > 1 ? ' profissionais' : ' profissional') : '';
    return {
      valor: money(r.valor), unidade: 'por mês', fds: null,
      detalhe: r.dias + ' plantões (' + labelOf('frequencia', a.frequencia).toLowerCase() + ')' + prof,
      linha: money(r.valor) + ' por mês' + (r.dias ? ' (' + r.dias + ' plantões)' : '')
    };
  }

  function obterPreco(a) {
    var cfg = (window.CUIDARE_CONFIG || {}).precos || {};
    if (cfg.modo !== 'servidor') return Promise.resolve(calcular(window.CUIDARE_PRECOS, a));
    if (!isComplete(a)) return Promise.resolve({ status: 'incompleto' });
    if (location.protocol === 'file:') return Promise.resolve({ status: 'sob_consulta', motivo: 'indisponivel' });
    var params = porDiaria(a) ? { servico: a.servico } : { servico: a.servico, duracao: a.duracao, frequencia: a.frequencia };
    var q = new URLSearchParams(params);
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
    if (porDiaria(a)) return [
      { k: 'servico', step: 0, label: 'Atendimento', value: labelOf('servico', a.servico) },
      { k: 'modalidade', label: 'Valores', value: 'Por diária, conforme a duração', fixed: true }
    ];
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
    KEY: KEY, STEPS: STEPS, stepsFor: stepsFor, journeyLabels: journeyLabels, porDiaria: porDiaria, SERVICOS: SERVICOS, DURACOES: DURACOES, FREQUENCIAS: FREQUENCIAS,
    optionsFor: optionsFor, sanitize: sanitize, labelOf: labelOf, servico: servico,
    stepDone: stepDone, firstIncomplete: firstIncomplete, isComplete: isComplete,
    calcular: calcular, obterPreco: obterPreco, money: money, priceText: priceText, isMensal: isMensal,
    summaryRows: summaryRows,
    load: load, save: save, clear: clear
  };
})();
