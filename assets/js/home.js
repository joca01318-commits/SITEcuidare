/* Cuidare — página inicial: capa 3D, consulta em 4 etapas, trilho de diferenciais e depoimentos. */
(function () {
  'use strict';
  var C = window.Cuidare, K = window.CuidareConsulta;
  if (!C || !K) return;
  var $ = C.$, $$ = C.$$, esc = C.esc;
  var ICON = function (id, cls) { return '<svg aria-hidden="true"' + (cls ? ' class="' + cls + '"' : '') + '><use href="#i-' + id + '"/></svg>'; };
  var N = K.STEPS.length;

  /* ---------- Capa: cena 3D ---------- */
  var hero = $('[data-hero]');
  var scene = null;
  if (hero) {
    C.cena($('[data-cena]', hero), {
      objects: function (aspect, hw, hh) {
        if (aspect < 0.9) {
          return [
            { shape: 'heart', x: hw * 0.62, y: hh * 0.7, z: -0.5, s: hh * 0.2, ry: -0.4, rz: 0.2 },
            { shape: 'heart', x: -hw * 0.8, y: -hh * 0.66, z: 0, s: hh * 0.11, ry: 0.5, rz: -0.25 },
            { shape: 'sphere', x: hw * 0.72, y: -hh * 0.82, z: 0.5, s: hh * 0.05 }
          ];
        }
        return [
          { shape: 'heart', x: hw * 0.68, y: hh * 0.04, z: 0, s: hh * 0.34, ry: -0.5, rz: 0.12, depth: 1 },
          { shape: 'heart', x: -hw * 0.72, y: -hh * 0.2, z: -1, s: hh * 0.24, ry: 0.6, rz: -0.18, depth: 0.7 },
          { shape: 'heart', x: -hw * 0.4, y: hh * 0.64, z: 0.6, s: hh * 0.085, ry: 1, rz: -0.2, depth: 1.3 },
          { shape: 'sphere', x: hw * 0.9, y: -hh * 0.42, z: 0.8, s: hh * 0.06, depth: 1.4 },
          { shape: 'sphere', x: hw * 0.88, y: hh * 0.76, z: -2, s: hh * 0.06, depth: 0.5 },
          { shape: 'heart', x: hw * 0.52, y: hh * 0.96, z: -2.5, s: hh * 0.07, ry: -0.8, depth: 0.4 }
        ];
      },
      onReady: function () { hero.classList.add('is-3d'); },
      onFail: function () { hero.classList.remove('is-3d'); }
    }).then(function (inst) { scene = inst; });
    window.addEventListener('scroll', function () {
      if (scene) scene.setScroll(Math.max(0, Math.min(1, window.scrollY / (hero.offsetHeight || 1))));
    }, { passive: true });
  }

  /* ---------- Consulta ---------- */
  var stage = $('[data-stage]');
  var aside = $('[data-aside]');
  var mini = $('[data-mini]');
  var stepper = $('[data-stepper]');
  var params = new URLSearchParams(location.search);
  var returnMode = params.get('retorno') === '1';
  var state = K.load();
  var a = state.a;
  var current = null, busy = false, autoTimer = 0, pointerPick = false;

  function persist() { state.a = a; K.save(state); }

  function serviceIcon(v) { var s = K.servico(v); return s ? s.icon : 'heart'; }

  /* Telas */
  function svcHTML() {
    return '<div class="svc" role="radiogroup" aria-labelledby="q-title">' + K.optionsFor('servico', a).map(function (o, k) {
      return '<label class="svc__card" style="--i:' + k + '"><input type="radio" name="servico" value="' + o.v + '"' + (a.servico === o.v ? ' checked' : '') + '>' +
        '<span class="svc__visual" data-photo="' + o.v + '" style="--a:' + (190 + k * 25) + 'deg">' +
        '<span class="svc__tag svc__tag--1">' + o.tags[0] + '</span><span class="svc__tag svc__tag--2">' + o.tags[1] + '</span><span class="svc__tag svc__tag--3">' + o.tags[2] + '</span>' +
        '<span class="svc__icon">' + ICON(o.icon) + '</span></span>' +
        '<span class="svc__body"><span class="svc__t">' + o.t + '</span><span class="svc__d">' + o.d + '</span></span>' +
        '<span class="svc__check" aria-hidden="true">' + ICON('check') + '</span></label>';
    }).join('') + '</div>';
  }

  function tilesHTML(field, four) {
    return '<div class="tiles' + (four ? ' tiles--4' : '') + '" role="radiogroup" aria-labelledby="q-title">' + K.optionsFor(field, a).map(function (o, k) {
      var head;
      if (field === 'duracao') head = '<span class="tile__n">' + (o.icon ? ICON(o.icon) : '') + o.n + '</span>';
      else head = '<span class="tile__i">' + ICON(o.v === 'pontual' ? 'clock' : 'calendar') + '</span>';
      return '<label class="tile" style="--i:' + k + '"><input type="radio" name="' + field + '" value="' + o.v + '"' + (a[field] === o.v ? ' checked' : '') + '>' +
        (o.tag ? '<span class="tile__tag">' + o.tag + '</span>' : '') +
        '<span class="tile__check" aria-hidden="true">' + ICON('check') + '</span>' + head +
        '<span class="tile__t">' + o.t + '</span><span class="tile__d">' + o.d + '</span></label>';
    }).join('') + '</div>';
  }

  function detailsHTML() {
    var nec = a.necessidades || [];
    return '<div class="fields">' +
      '<div class="field" data-field="bairro"><label for="f-bairro">Bairro onde o atendimento vai acontecer</label>' +
      '<input class="input" id="f-bairro" name="bairro" type="text" maxlength="60" autocomplete="address-level3" placeholder="Ex.: Vila Mariana" aria-describedby="h-bairro e-bairro" required value="' + esc(a.bairro || '') + '">' +
      '<p class="hint" id="h-bairro">Apenas o bairro. Não precisamos do endereço.</p><p class="err" id="e-bairro">Informe o bairro para continuar.</p></div>' +
      '<fieldset class="field" data-field="inicio" aria-describedby="e-inicio"><legend class="lbl">Quando o atendimento precisa começar?</legend><div class="pills">' +
      K.INICIO.map(function (o) { return '<label class="pill"><input type="radio" name="inicio" value="' + o.v + '"' + (a.inicio === o.v ? ' checked' : '') + '><span>' + o.t + '</span></label>'; }).join('') +
      '</div><p class="err" id="e-inicio">Escolha uma previsão de início.</p></fieldset>' +
      '<fieldset class="field"><legend class="lbl">Alguma necessidade relevante? <span class="opt-l">(opcional, escolha quantas quiser)</span></legend><div class="pills">' +
      K.NECESSIDADES.map(function (o) { return '<label class="pill"><input type="checkbox" name="necessidades" value="' + o.v + '"' + (nec.indexOf(o.v) > -1 ? ' checked' : '') + '><span>' + o.t + '</span></label>'; }).join('') +
      '</div></fieldset></div>';
  }

  function nextLabel(i) {
    if (i === N - 1) return 'Consultar meu valor';
    if (returnMode && K.isComplete(a)) return 'Salvar e ver o valor';
    return 'Continuar';
  }

  function stepHTML(i) {
    var s = K.STEPS[i], body;
    if (s.id === 'servico') body = svcHTML();
    else if (s.id === 'duracao') body = tilesHTML('duracao');
    else if (s.id === 'frequencia') body = tilesHTML('frequencia', true);
    else body = detailsHTML();
    var last = i === N - 1;
    return '<form class="q" novalidate data-step="' + i + '">' +
      '<p class="q__kicker"><span>Etapa ' + ('0' + (i + 1)).slice(-2) + ' de 0' + N + '</span><span aria-hidden="true">·</span><span>' + s.label + '</span></p>' +
      '<h3 class="q__title" id="q-title" tabindex="-1">' + s.title + '</h3>' +
      '<p class="q__help">' + s.help + '</p>' +
      '<div class="q__body">' + body + '</div>' +
      '<div data-extra aria-live="polite"></div>' +
      '<div class="q__actions">' +
      (i > 0 ? '<button type="button" class="q__back" data-act="back">' + ICON('arrow') + 'Voltar</button>' : '') +
      '<button type="submit" class="btn btn--primary' + (last ? ' btn--lg' : '') + '" data-next><span>' + nextLabel(i) + '</span>' +
      (last ? '<span class="btn__ico" aria-hidden="true">' + ICON('arrow') + '</span>' : ICON('arrow')) + '</button>' +
      '</div></form>';
  }

  function noteHTML(text, warn) { return '<p class="note' + (warn ? ' note--warn' : '') + '">' + ICON('info') + '<span>' + text + '</span></p>'; }

  function renderExtra() {
    var box = $('[data-extra]', stage); if (!box) return;
    var s = K.STEPS[current], h = '';
    if (s.id === 'duracao' && a.duracao === 'nao_sei') h = noteHTML('Sem problema. Siga para a frequência: na próxima tela, a equipe monta uma proposta personalizada com você.');
    if (s.id === 'frequencia' && a.frequencia === 'pontual') h = noteHTML('No atendimento pontual, o valor é por diária, para a duração escolhida.');
    if (s.id === 'detalhes') {
      var n = a.necessidades || [];
      if (n.indexOf('alzheimer_parkinson') > -1 || n.indexOf('cirurgia') > -1) {
        h = noteHTML('A indicação do profissional depende da avaliação das necessidades e das atribuições permitidas ao cuidador. Procedimentos de enfermagem são realizados somente por profissionais habilitados.');
      }
    }
    box.innerHTML = h;
  }

  /* Resumo lateral e chips (celular) */
  function rowIcon(k) { return { servico: serviceIcon(a.servico), duracao: 'clock', frequencia: 'calendar', bairro: 'pin', inicio: 'clock', necessidades: 'heart' }[k]; }
  function renderAside(changed) {
    var rows = K.summaryRows(a);
    if (aside) {
      aside.className = 'cfg__aside aside';
      aside.innerHTML = '<h3 class="aside__t">Seu atendimento</h3><p class="aside__s">Suas escolhas aparecem aqui. Você pode alterar a qualquer momento.</p>' +
        '<div class="sum">' + rows.filter(function (r) { return !r.optional || r.value; }).map(function (r) {
          return '<div class="sum__row' + (r.k === changed ? ' is-new' : '') + '"><span class="sum__i">' + ICON(rowIcon(r.k)) + '</span>' +
            '<dl class="sum__txt"><dt>' + r.label + '</dt><dd' + (r.value ? '' : ' class="is-empty"') + '>' + (r.value ? esc(r.value) : 'A definir') + '</dd></dl>' +
            (r.value && current !== null ? '<button type="button" class="sum__edit" data-goto="' + r.step + '" aria-label="Alterar ' + r.label + '">Alterar</button>' : '') + '</div>';
        }).join('') + '</div>' +
        '<p class="aside__foot">' + ICON('lock') + '<span>O valor aparece na próxima tela, somente para a configuração escolhida.</span></p>';
    }
    if (mini) {
      var chips = rows.filter(function (r) { return r.value && r.k !== 'necessidades'; });
      mini.hidden = !chips.length;
      mini.innerHTML = chips.map(function (r) {
        return '<button type="button" data-goto="' + r.step + '" aria-label="Alterar ' + r.label + ': ' + esc(r.value) + '">' + esc(r.value) + ICON('edit') + '</button>';
      }).join('');
    }
  }

  function reachable(i) { var fi = K.firstIncomplete(a); return fi === -1 || i <= fi; }
  function renderStepper() {
    if (!stepper) return;
    stepper.innerHTML = K.STEPS.map(function (s, i) {
      var cur = i === current, done = !cur && K.stepDone(s.id, a);
      return '<li class="' + (cur ? 'is-current' : done ? 'is-done' : '') + '"><button type="button" data-goto="' + i + '"' + (cur ? ' aria-current="step"' : '') + (!cur && reachable(i) ? '' : ' disabled') + '>' +
        '<span class="stepper__n" aria-hidden="true">' + (done ? ICON('check') : i + 1) + '</span><span class="stepper__t">' + s.label + '</span>' + (done ? '<span class="sr-only">, concluída</span>' : '') + '</button></li>';
    }).join('') + '<li><span class="stepper__b"><span class="stepper__n" aria-hidden="true">' + (N + 1) + '</span><span class="stepper__t">Seu valor</span></span></li>';
  }

  /* Navegação entre etapas */
  function stepUrl(i) { return C.pageUrl('', '?etapa=' + (i + 1) + (returnMode ? '&retorno=1' : '')) + '#consulta'; }

  function go(i, dir, opts) {
    opts = opts || {};
    if (busy || i === current) return;
    clearTimeout(autoTimer);
    var first = current === null;
    if (!first && !opts.fromPop) { try { history.pushState({ etapa: i }, '', stepUrl(i)); } catch (e) { /* file:// */ } }
    var old = $('.q', stage);
    var swap = function () {
      current = i;
      stage.innerHTML = stepHTML(i);
      var el = $('.q', stage);
      $$('[data-photo]', el).forEach(C.photo);
      renderExtra();
      if (!C.reduce && !first) {
        el.classList.add(dir < 0 ? 'enter-back' : 'enter-fwd');
        el.addEventListener('animationend', function h(e) { if (e.target === el) { el.classList.remove('enter-back', 'enter-fwd'); el.removeEventListener('animationend', h); } });
      }
      renderStepper(); renderAside();
      if (!first) {
        // alinha o indicador de etapas logo abaixo do cabeçalho
        var hdrH = (document.querySelector('[data-hdr]') || {}).offsetHeight || 72;
        var target = (stepper || stage).getBoundingClientRect().top + window.scrollY - hdrH - 14;
        if (Math.abs(window.scrollY - target) > 40) window.scrollTo({ top: Math.max(0, target), behavior: C.reduce ? 'auto' : 'smooth' });
        var t = $('#q-title', el); if (t) t.focus({ preventScroll: true });
      }
      busy = false;
    };
    if (old && !first && !C.reduce) { busy = true; old.classList.add(dir < 0 ? 'exit-back' : 'exit-fwd'); setTimeout(swap, 260); }
    else swap();
  }

  function invalid(field, on) {
    var f = $('[data-field="' + field + '"]', stage); if (!f) return;
    f.classList.toggle('is-invalid', on);
    var inp = $('input', f);
    if (inp && inp.type === 'text') { if (on) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid'); }
  }

  function next() {
    clearTimeout(autoTimer);
    var s = K.STEPS[current];
    if (s.id === 'detalhes') {
      var inp = $('#f-bairro', stage);
      a.bairro = inp.value.trim();
      var okB = a.bairro.length >= 2, okI = !!a.inicio;
      invalid('bairro', !okB); invalid('inicio', !okI);
      persist();
      if (!okB) { inp.focus(); return; }
      if (!okI) { var r = $('input[name="inicio"]', stage); if (r) r.focus(); return; }
    } else if (!a[s.id]) {
      $('[data-extra]', stage).innerHTML = noteHTML('Escolha uma opção para continuar.', true);
      var first = $('input[type="radio"]', stage); if (first) first.focus();
      return;
    }
    persist();
    C.track('step_complete', { step: current + 1, step_id: s.id, value: (s.id === 'duracao' || s.id === 'frequencia') ? a[s.id] : undefined });
    if (current === N - 1 || (returnMode && K.isComplete(a))) {
      var fi = K.firstIncomplete(a);
      if (fi === -1) return finish();
      return go(fi, fi > current ? 1 : -1);
    }
    go(current + 1, 1);
  }

  function finish() {
    var btn = $('[data-next]', stage); if (btn) btn.classList.add('is-loading');
    persist();
    C.track('consulta_complete', { duracao: a.duracao, frequencia: a.frequencia, prioridade: K.priority(a) });
    location.href = C.pageUrl('valor');
  }

  if (stage) {
    stage.addEventListener('pointerdown', function (e) { pointerPick = !!e.target.closest('.svc__card, .tile'); });
    stage.addEventListener('keydown', function () { pointerPick = false; });

    stage.addEventListener('change', function (e) {
      var t = e.target;
      if (t.name === 'necessidades') {
        a.necessidades = $$('input[name="necessidades"]:checked', stage).map(function (x) { return x.value; });
        persist(); renderAside('necessidades'); renderExtra(); return;
      }
      if (t.name === 'inicio') { a.inicio = t.value; invalid('inicio', false); persist(); renderAside('inicio'); renderStepper(); return; }
      if (t.type !== 'radio' || K.STEPS[current].id !== t.name) return;
      a[t.name] = t.value;
      a = K.sanitize(a);
      persist();
      renderAside(t.name); renderStepper(); renderExtra();
      var hold = t.name === 'duracao' && t.value === 'nao_sei';
      if (pointerPick && !hold) autoTimer = setTimeout(next, C.reduce ? 150 : 560);
      pointerPick = false;
    });

    stage.addEventListener('input', function (e) {
      if (e.target.id !== 'f-bairro') return;
      a.bairro = e.target.value;
      if (a.bairro.trim().length >= 2) invalid('bairro', false);
      persist(); renderAside('bairro'); renderStepper();
    });

    stage.addEventListener('submit', function (e) { e.preventDefault(); next(); });

    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-goto], [data-act]');
      if (!el || el.disabled) return;
      if (el.hasAttribute('data-goto')) {
        var g = parseInt(el.getAttribute('data-goto'), 10);
        if (!isNaN(g) && reachable(g)) go(g, g < current ? -1 : 1);
        return;
      }
      if (el.getAttribute('data-act') === 'back' && current > 0) go(current - 1, -1);
    });

    window.addEventListener('popstate', function (e) {
      var st = e.state && typeof e.state.etapa === 'number' ? e.state.etapa : 0;
      if (st !== current) go(Math.min(st, Math.max(0, K.firstIncomplete(a) === -1 ? N - 1 : K.firstIncomplete(a))), st < current ? -1 : 1, { fromPop: true });
    });

    // Etapa inicial: ?etapa=N (edição a partir das páginas 2 e 3) ou a primeira pendente.
    var want = parseInt(params.get('etapa'), 10), fi0 = K.firstIncomplete(a), start = 0;
    if (want >= 1 && want <= N) start = Math.min(want - 1, fi0 === -1 ? N - 1 : fi0);
    else if (fi0 > 0) start = fi0;
    try { history.replaceState({ etapa: start }, ''); } catch (err) { /* file:// */ }
    go(start, 1);
  }

  /* ---------- Destaque do menu ---------- */
  var links = $$('.nav a[href^="#"]');
  if (links.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        links.forEach(function (l) { l.setAttribute('aria-current', String(l.getAttribute('href') === '#' + en.target.id)); });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    links.forEach(function (l) { var sec = $(l.getAttribute('href')); if (sec) io.observe(sec); });
  }

  /* ---------- Trilho de diferenciais ---------- */
  var rail = $('[data-rail]');
  if (rail) {
    var track = $('[data-rail-track]', rail), bar = $('[data-rail-bar]', rail);
    var prevB = $('[data-rail-prev]', rail), nextB = $('[data-rail-next]', rail);
    var upd = function () {
      var max = track.scrollWidth - track.clientWidth;
      var vis = track.clientWidth / track.scrollWidth;
      bar.style.width = (vis * 100) + '%';
      bar.style.transform = 'translateX(' + (max > 0 ? (track.scrollLeft / max) * ((1 - vis) / vis) * 100 : 0) + '%)';
      prevB.disabled = track.scrollLeft <= 4;
      nextB.disabled = track.scrollLeft >= max - 4;
    };
    var by = function (d) { var card = $('.xcard', track); track.scrollBy({ left: d * ((card ? card.offsetWidth : 280) + 16), behavior: C.reduce ? 'auto' : 'smooth' }); };
    prevB.addEventListener('click', function () { by(-1); });
    nextB.addEventListener('click', function () { by(1); });
    track.addEventListener('scroll', upd, { passive: true });
    window.addEventListener('resize', upd, { passive: true });
    upd();
  }

  /* ---------- Depoimentos ---------- */
  var tst = $('[data-tst]');
  if (tst) {
    var items = $$('.tst__item', tst), cur = 0, cnt = $('[data-tst-cur]');
    items.forEach(function (it, i) { it.setAttribute('aria-hidden', String(i !== 0)); });
    var show = function (i) {
      cur = (i + items.length) % items.length;
      items.forEach(function (it, k) { it.classList.toggle('is-active', k === cur); it.setAttribute('aria-hidden', String(k !== cur)); });
      cnt.textContent = ('0' + (cur + 1)).slice(-2);
    };
    $('[data-tst-prev]').addEventListener('click', function () { show(cur - 1); });
    $('[data-tst-next]').addEventListener('click', function () { show(cur + 1); });
    var x0 = null;
    tst.addEventListener('pointerdown', function (e) { x0 = e.clientX; });
    tst.addEventListener('pointerup', function (e) { if (x0 !== null && Math.abs(e.clientX - x0) > 40) show(cur + (e.clientX < x0 ? 1 : -1)); x0 = null; });
  }
})();
