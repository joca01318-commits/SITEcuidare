/* Cuidare — experiência interativa (/experiencia) */
(function () {
  'use strict';
  var C = window.Cuidare, J = window.CuidareJornada;
  if (!C || !J) return;
  var $ = C.$, $$ = C.$$;
  var STEPS = J.STEPS, N = STEPS.length;
  var SAFE_TRACK = ['pessoa', 'horas', 'dias', 'inicio']; // nunca enviar local/necessidade a ferramentas de análise

  var stage = $('[data-stage]');
  var state = J.load();
  var answers = J.sanitize(state.answers || {});
  var params = new URLSearchParams(location.search);
  var returnMode = params.get('retorno') === '1';
  var current = null, busy = false, pointerPick = false, autoTimer = 0;
  var guide = {};
  var orb = null;

  /* ---------- Esfera 3D que acompanha as respostas ---------- */
  var orbWrap = $('[data-flow-orb]');
  C.orb($('canvas', orbWrap), {
    satellites: answered(), particles: C.finePointer ? 90 : 40,
    palette: { deep: '#082B59', mid: '#1769E0', rim: '#FFFFFF', spec: '#FFFFFF', particle: '#0757B8' },
    layout: function (aspect, hw, hh) { return { x: 0, y: 0, s: Math.min(hw, hh) * 0.62, a: 1 }; },
    onReady: function () { orbWrap.classList.add('is-3d'); },
    onFail: function () { orbWrap.classList.remove('is-3d'); }
  }).then(function (inst) { orb = inst; if (orb) orb.setSatellites(answered()); });

  function answered() {
    return STEPS.reduce(function (n, s) {
      if (s.type === 'form') return n + (answers.bairro && answers.bairro.trim().length >= 2 ? 1 : 0);
      return n + (answers[s.id] ? 1 : 0);
    }, 0);
  }
  function persist() { state.answers = answers; state.step = current; J.save(state); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var ICON = function (id) { return '<svg aria-hidden="true"><use href="#i-' + id + '"/></svg>'; };

  /* ---------- Telas ---------- */
  function introHTML() {
    var has = answered() > 0;
    return '<div class="step intro">' +
      '<p class="step__kicker">Experiência Cuidare</p>' +
      '<h1 class="step__title" id="st-title" tabindex="-1">Descubra o cuidado ideal para sua <em>família.</em></h1>' +
      '<p class="step__help">Sete perguntas rápidas sobre quem vai receber o cuidado e a rotina desejada. No final, você revisa tudo e escolhe como prefere ser contatado.</p>' +
      '<div class="intro__meta"><span>' + ICON('clock') + 'Cerca de 2 minutos</span><span>' + ICON('doc') + 'Sem documentos nem dados clínicos</span><span>' + ICON('lock') + 'Respostas salvas só nesta aba</span></div>' +
      '<div class="intro__actions">' +
      (has
        ? '<button type="button" class="btn btn--primary" data-act="resume"><span class="btn__label">Continuar de onde parei</span>' + ICON('arrow').replace('<svg', '<svg class="arrow"') + '</button><button type="button" class="link" data-act="restart">Recomeçar</button>'
        : '<button type="button" class="btn btn--primary" data-act="start"><span class="btn__label">Começar</span>' + ICON('arrow').replace('<svg', '<svg class="arrow"') + '</button>') +
      '</div></div>';
  }

  function nextLabel(i) {
    if (returnMode) return 'Salvar e voltar ao resumo';
    return i === N - 1 ? 'Revisar e finalizar' : 'Continuar';
  }

  function stepHTML(i) {
    var s = STEPS[i];
    var h = '<form class="step" novalidate data-step="' + i + '">' +
      '<p class="step__kicker"><span>Etapa ' + pad(i + 1) + ' de ' + pad(N) + '</span><span aria-hidden="true">·</span><span>' + s.kicker + '</span></p>' +
      '<h1 class="step__title" id="st-title" tabindex="-1">' + s.title + '</h1>' +
      '<p class="step__help">' + s.help + '</p>';
    if (s.type === 'form') {
      h += '<div class="fields">' +
        '<div class="field" data-field="bairro"><label for="f-bairro">Bairro onde ocorrerá o atendimento</label>' +
        '<input id="f-bairro" name="bairro" type="text" maxlength="60" autocomplete="address-level3" placeholder="Ex.: Vila Mariana" aria-describedby="h-bairro e-bairro" required>' +
        '<p class="hint" id="h-bairro">Apenas o bairro. Não precisamos do endereço.</p><p class="err" id="e-bairro">Informe o bairro para continuarmos.</p></div>' +
        '<fieldset class="field"><legend class="lbl">O familiar já possui um cuidador? <span class="opt-l">(opcional)</span></legend><div class="pills">' +
        J.SITUACAO.map(function (o) { return '<label class="pill"><input type="radio" name="situacao" value="' + o.v + '"' + (answers.situacao === o.v ? ' checked' : '') + '><span>' + o.t + '</span></label>'; }).join('') +
        '</div></fieldset>' +
        '<div class="field"><label for="f-obs">Alguma necessidade específica ou informação que a equipe deva conhecer? <span class="opt-l">(opcional)</span></label>' +
        '<textarea id="f-obs" name="observacoes" maxlength="500" aria-describedby="h-obs"></textarea>' +
        '<p class="hint" id="h-obs">Ex.: rotina, preferências, mobilidade. Evite incluir dados clínicos detalhados. <span data-obs-count>0</span>/500</p></div>' +
        '</div>';
    } else {
      h += '<fieldset aria-labelledby="st-title"><div class="opts">';
      J.optionsFor(s.id, answers).forEach(function (o, k) {
        h += '<label class="opt" style="--i:' + k + '"><input type="radio" name="' + s.id + '" value="' + o.v + '"' + (answers[s.id] === o.v ? ' checked' : '') + '>' +
          '<span class="opt__box"><span class="opt__key" aria-hidden="true">' + String.fromCharCode(65 + k) + '</span>' +
          '<span><span class="opt__t">' + o.t + '</span>' + (o.d ? '<span class="opt__d">' + o.d + '</span>' : '') + (o.tag ? '<span class="opt__tag">' + o.tag + '</span>' : '') + '</span>' +
          '<span class="opt__check" aria-hidden="true">' + ICON('check') + '</span></span></label>';
      });
      h += '</div></fieldset>';
    }
    h += '<div data-extra aria-live="polite"></div>' +
      '<div class="step__actions"><button type="button" class="step__back" data-act="back">' + ICON('arrow') + 'Voltar</button>' +
      '<button type="submit" class="btn btn--primary" data-next><span class="btn__label">' + nextLabel(i) + '</span>' + ICON('arrow').replace('<svg', '<svg class="arrow"') + '</button></div>' +
      '</form>';
    return h;
  }

  /* ---------- Conteúdo contextual (notas, orientação) ---------- */
  function noteHTML(text, warn) { return '<p class="note' + (warn ? ' note--warn' : '') + '">' + ICON('info') + '<span>' + text + '</span></p>'; }

  function suggestion() {
    if (guide.periodo === 'parte') return '6h';
    if (guide.periodo === 'noite') return '12h_noite';
    if (guide.periodo === 'dia' && guide.familia === 'sim') return '8h';
    if (guide.periodo === 'dia' && guide.familia === 'nao') return '12h_dia';
    return null;
  }
  function guideHTML() {
    var sug = suggestion();
    var pill = function (name, v, t) { return '<label class="pill"><input type="radio" name="' + name + '" value="' + v + '"' + (guide[name.slice(2)] === v ? ' checked' : '') + '><span>' + t + '</span></label>'; };
    var h = '<div class="guide"><h3>Vamos encontrar um ponto de partida</h3>' +
      '<p class="q" id="gq1">Em que período a pessoa mais precisa de apoio?</p><div class="pills" role="radiogroup" aria-labelledby="gq1">' +
      pill('g-periodo', 'parte', 'Parte do dia') + pill('g-periodo', 'dia', 'O dia inteiro') + pill('g-periodo', 'noite', 'À noite') + '</div>';
    if (guide.periodo === 'dia') {
      h += '<p class="q" id="gq2">Há alguém da família presente durante parte do dia?</p><div class="pills" role="radiogroup" aria-labelledby="gq2">' +
        pill('g-familia', 'sim', 'Sim') + pill('g-familia', 'nao', 'Não') + '</div>';
    }
    if (sug) {
      h += '<div class="guide__out"><p class="muted">Sugestão para conversarmos na avaliação</p><strong>' + J.labelOf('horas', sug) + '</strong>' +
        '<p class="muted" style="font-size:.84rem;margin-top:6px">É apenas um ponto de partida. O formato é definido com a equipe.</p>' +
        '<div class="row"><button type="button" class="btn btn--primary btn--sm" data-act="use-sugg" data-v="' + sug + '">Usar esta sugestão</button>' +
        '<button type="button" class="link" data-act="keep-unknown">Prefiro definir na avaliação</button></div></div>';
    }
    return h + '</div>';
  }

  function renderExtra(i) {
    var box = $('[data-extra]', stage); if (!box) return;
    var s = STEPS[i], v = answers[s.id], h = '';
    if (s.notes && v && s.notes[v]) h += noteHTML(s.notes[v]);
    if (s.id === 'horas' && v === 'nao_sei') {
      h += answers.local === 'consultas' ? noteHTML('Sem problema. Na avaliação, a equipe ajuda a definir a duração adequada para as consultas e exames.') : guideHTML();
    }
    box.innerHTML = h;
  }

  /* ---------- Resumo ---------- */
  function renderSummary(changedId) {
    var rows = STEPS.map(function (s, i) {
      var val = s.type === 'form' ? (answers.bairro || '').trim() : J.labelOf(s.id, answers[s.id]);
      return { i: i, id: s.type === 'form' ? 'bairro' : s.id, label: s.type === 'form' ? 'Bairro' : s.label, value: val };
    });
    var html = '<h2 class="summary__t">Sua solicitação</h2><dl class="summary__list">' +
      rows.map(function (r) {
        return '<div class="summary__row' + (r.id === changedId ? ' is-new' : '') + '"><dt>' + r.label + '</dt><dd' + (r.value ? '' : ' class="empty"') + '><span>' +
          (r.value ? esc(r.value) : '—') + '</span>' + (r.value ? '<button type="button" class="edit" data-goto="' + r.i + '" aria-label="Alterar ' + r.label + '">Alterar</button>' : '') + '</dd></div>';
      }).join('') + '</dl>' +
      '<p class="summary__foot">Cada proposta é personalizada: depende do tipo de atendimento, do período contratado e das necessidades identificadas na avaliação.</p>' +
      (answered() ? '<button type="button" class="summary__reset" data-act="restart">Limpar respostas</button>' : '');
    $$('[data-summary]').forEach(function (el) { el.innerHTML = html; });
    var c = $('[data-answer-count]'); if (c) c.textContent = String(answered());
  }

  function renderProgress() {
    var i = current;
    $('[data-progress-label]').innerHTML = i < 0 ? 'Início'
      : '<span class="long">Etapa ' + (i + 1) + ' de ' + N + '</span><span class="short" aria-hidden="true">' + (i + 1) + '/' + N + '</span>';
    var w = i < 0 ? '0%' : ((i + 1) / N * 100) + '%';
    $('[data-progress-bar]').style.width = w;
    $('[data-progress-mbar]').style.width = w;
    document.title = (i < 0 ? 'Descubra o cuidado ideal para sua família' : STEPS[i].title) + ' — Cuidare Vila Mariana';
  }

  /* ---------- Navegação ---------- */
  function urlFor(i) {
    if (i < 0) return C.pageUrl('experiencia');
    return C.pageUrl('experiencia', '?etapa=' + (i + 1) + (returnMode ? '&retorno=1' : ''));
  }

  function go(i, dir, fromPop) {
    if (busy || i === current) return;
    var prev = current;
    clearTimeout(autoTimer);
    if (!fromPop) {
      try { history[current === null ? 'replaceState' : 'pushState']({ step: i }, '', urlFor(i)); } catch (e) { /* file:// */ }
    }
    var old = stage.querySelector('.step');
    var animate = !C.reduce && old && current !== null;
    var swap = function () {
      current = i;
      stage.innerHTML = i < 0 ? introHTML() : stepHTML(i);
      var el = stage.querySelector('.step');
      if (i >= 0 && STEPS[i].type === 'form') {
        $('#f-bairro', el).value = answers.bairro || '';
        $('#f-obs', el).value = answers.observacoes || '';
        $('[data-obs-count]', el).textContent = String((answers.observacoes || '').length);
      }
      if (i >= 0) renderExtra(i);
      if (!C.reduce) {
        el.classList.add(dir < 0 ? 'enter-back' : 'enter-fwd');
        el.addEventListener('animationend', function h(e) { if (e.target === el) { el.classList.remove('enter-back', 'enter-fwd'); el.removeEventListener('animationend', h); } });
      }
      renderProgress();
      persist();
      var top = stage.getBoundingClientRect().top + window.scrollY - 120;
      if (window.scrollY > top) window.scrollTo({ top: Math.max(0, top), behavior: C.reduce ? 'auto' : 'smooth' });
      var title = $('#st-title', el);
      if (title && prev !== null) title.focus({ preventScroll: true });
      busy = false;
    };
    if (animate) {
      busy = true;
      old.classList.add(dir < 0 ? 'exit-back' : 'exit-fwd');
      setTimeout(swap, 280);
    } else swap();
  }

  function next() {
    var i = current, s = STEPS[i];
    clearTimeout(autoTimer);
    if (s.type === 'form') {
      var f = $('[data-field="bairro"]', stage), inp = $('#f-bairro', stage);
      answers.bairro = inp.value.trim();
      if (answers.bairro.length < 2) { f.classList.add('is-invalid'); inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
    } else if (!answers[s.id]) {
      var box = $('[data-extra]', stage);
      box.innerHTML = noteHTML('Escolha uma opção para continuar.', true);
      var first = $('input[type="radio"]', stage); if (first) first.focus();
      return;
    }
    persist();
    C.track('step_complete', { step: i + 1, step_id: s.id, value: SAFE_TRACK.indexOf(s.id) > -1 ? answers[s.id] : undefined });
    if (returnMode || i === N - 1) {
      var fi = J.firstIncomplete(answers);
      if (fi === -1) return finish();
      return go(fi, fi > i ? 1 : -1);
    }
    go(i + 1, 1);
  }

  function finish() {
    var btn = $('[data-next]', stage);
    if (btn) btn.classList.add('is-loading');
    persist();
    C.track('experience_complete', { prioridade: J.priority(answers) });
    location.href = C.pageUrl('avaliacao');
  }

  function restart() {
    J.clear();
    answers = {}; guide = {}; state = { answers: {} };
    if (orb) orb.setSatellites(0);
    renderSummary();
    C.track('experience_restart');
    if (current === -1) { stage.innerHTML = introHTML(); renderProgress(); var t = $('#st-title', stage); if (t) t.focus(); }
    else go(-1, -1);
  }

  /* ---------- Eventos ---------- */
  stage.addEventListener('pointerdown', function (e) { pointerPick = !!e.target.closest('.opt'); });
  stage.addEventListener('keydown', function () { pointerPick = false; });

  stage.addEventListener('change', function (e) {
    var t = e.target, i = current;
    if (t.name && t.name.indexOf('g-') === 0) { guide[t.name.slice(2)] = t.value; if (t.name === 'g-periodo' && t.value !== 'dia') delete guide.familia; renderExtra(i); return; }
    if (t.name === 'situacao') { answers.situacao = t.value; persist(); renderSummary('situacao'); return; }
    if (t.type !== 'radio' || i < 0 || STEPS[i].id !== t.name) return;
    answers[t.name] = t.value;
    answers = J.sanitize(answers);
    persist();
    renderSummary(t.name);
    renderExtra(i);
    if (orb) { orb.pulse(); orb.setSatellites(answered()); }
    var s = STEPS[i];
    var holds = (s.notes && s.notes[t.value]) || (s.id === 'horas' && t.value === 'nao_sei');
    if (pointerPick && !holds) autoTimer = setTimeout(next, C.reduce ? 150 : 480);
    pointerPick = false;
  });

  stage.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'f-bairro') {
      answers.bairro = t.value;
      if (t.value.trim().length >= 2) { t.closest('.field').classList.remove('is-invalid'); t.removeAttribute('aria-invalid'); }
      persist(); renderSummary('bairro'); if (orb) orb.setSatellites(answered());
    }
    if (t.id === 'f-obs') { answers.observacoes = t.value; $('[data-obs-count]', stage).textContent = String(t.value.length); persist(); }
  });

  stage.addEventListener('submit', function (e) { e.preventDefault(); next(); });

  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act], [data-goto]');
    if (!a) return;
    var act = a.getAttribute('data-act');
    if (a.hasAttribute('data-goto')) {
      var g = parseInt(a.getAttribute('data-goto'), 10);
      var sheet = $('[data-sheet]'); if (sheet && sheet.open) sheet.close();
      return go(g, g < current ? -1 : 1);
    }
    if (act === 'start') { C.track('experience_start'); return go(0, 1); }
    if (act === 'resume') { var fi = J.firstIncomplete(answers); C.track('experience_resume'); return go(fi === -1 ? N - 1 : fi, 1); }
    if (act === 'restart') return restart();
    if (act === 'back') return go(current <= 0 ? -1 : current - 1, -1);
    if (act === 'use-sugg') {
      answers.horas = a.getAttribute('data-v');
      persist(); renderSummary('horas');
      var r = $('input[name="horas"][value="' + answers.horas + '"]', stage); if (r) r.checked = true;
      renderExtra(current);
      if (orb) orb.pulse();
      var nb = $('[data-next]', stage); if (nb) nb.focus();
      return;
    }
    if (act === 'keep-unknown') return next();
  });

  window.addEventListener('popstate', function (e) {
    if (e.state && typeof e.state.step === 'number') go(e.state.step, e.state.step < current ? -1 : 1, true);
  });

  var sheet = $('[data-sheet]');
  $('[data-open-summary]').addEventListener('click', function () { if (sheet.showModal) sheet.showModal(); else sheet.setAttribute('open', ''); });
  sheet.addEventListener('click', function (e) { if (e.target === sheet || e.target.closest('[data-close-sheet]')) sheet.close(); });

  /* ---------- Início ---------- */
  var startAt = parseInt(params.get('etapa'), 10);
  var idx = -1;
  if (startAt >= 1 && startAt <= N) {
    idx = startAt - 1;
    var fi0 = J.firstIncomplete(answers);
    if (fi0 !== -1 && idx > fi0) idx = fi0;
  }
  renderSummary();
  go(idx, 1);
})();
