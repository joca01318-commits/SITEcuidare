/* Cuidare — avaliação personalizada e conversão (/avaliacao) */
(function () {
  'use strict';
  var C = window.Cuidare, J = window.CuidareJornada;
  if (!C || !J) return;
  var $ = C.$, $$ = C.$$;
  var CFG = C.cfg, LEAD = CFG.lead || { mode: 'netlify', formName: 'avaliacao' };
  var SENT_KEY = 'cuidare.lead.enviado', PENDING_KEY = 'cuidare.lead.pendente';

  var answers = J.sanitize((J.load().answers) || {});
  var views = { form: $('[data-view="form"]'), done: $('[data-view="done"]'), empty: $('[data-view="empty"]') };
  var form = $('[data-lead-form]');
  var sending = false;

  function show(name) {
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== name; });
  }
  function hasAnswers() { return Object.keys(answers).some(function (k) { return answers[k]; }); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function digits(s) { return String(s || '').replace(/\D/g, ''); }
  function maskPhone(v) {
    var d = digits(v).slice(0, 11);
    if (d.length <= 2) return d.length ? '(' + d : '';
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  function validPhone(v) { var d = digits(v); return (d.length === 10 || d.length === 11) && +d.slice(0, 2) >= 11 && (d.length === 10 || d[2] === '9'); }

  /* ---------- Resumo editável ---------- */
  function renderSummary() {
    var rows = J.summaryRows(answers);
    var complete = J.isComplete(answers);
    var fi = J.firstIncomplete(answers);
    var html = '<h2 class="summary__t">Resumo da sua solicitação</h2><dl class="summary__list">' +
      rows.map(function (r) {
        var href = C.pageUrl('experiencia', '?etapa=' + (r.step + 1) + '&retorno=1');
        return '<div class="summary__row"><dt>' + r.label + '</dt><dd' + (r.value ? '' : ' class="empty"') + '><span>' + (r.value ? esc(r.value) : 'Não informado') + '</span>' +
          '<a class="edit" href="' + href + '" aria-label="Editar ' + r.label + '">Editar</a></dd></div>';
      }).join('') + '</dl>';
    if (!complete && fi > -1) {
      html += '<p class="note note--warn" style="margin-top:16px"><svg aria-hidden="true"><use href="#i-info"/></svg><span>Faltam algumas respostas. <a class="link" href="' +
        C.pageUrl('experiencia', '?etapa=' + (fi + 1) + '&retorno=1') + '">Completar agora</a></span></p>';
    }
    $('[data-av-summary]').innerHTML = html;
    var back = $('[data-back-exp]');
    if (back) back.href = C.pageUrl('experiencia', '?etapa=' + J.STEPS.length);
  }

  /* ---------- Validação ---------- */
  function setInvalid(name, on) {
    var f = $('[data-field="' + name + '"]', form); if (!f) return;
    f.classList.toggle('is-invalid', on);
    var input = $('input', f); if (input) { if (on) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
  }
  function validate() {
    var errs = [];
    var nome = form.nome.value.trim();
    var ok = nome.length >= 2; setInvalid('nome', !ok); if (!ok) errs.push(['nome', 'Informe seu nome.']);
    ok = validPhone(form.whatsapp.value); setInvalid('whatsapp', !ok); if (!ok) errs.push(['whatsapp', 'Informe um WhatsApp válido, com DDD.']);
    ok = !!$('input[name="periodo"]:checked', form); setInvalid('periodo', !ok); if (!ok) errs.push(['periodo', 'Escolha o melhor período para contato.']);
    ok = form.consentimento.checked; setInvalid('consentimento', !ok); if (!ok) errs.push(['consentimento', 'Precisamos da sua autorização para entrar em contato.']);
    if (!J.isComplete(answers)) errs.unshift(['', 'Complete as respostas da experiência antes de enviar.']);
    return errs;
  }
  function showErrors(errs) {
    var box = $('[data-form-errors]');
    if (!errs.length) { box.classList.remove('is-on'); box.textContent = ''; return; }
    box.innerHTML = errs.length === 1 ? esc(errs[0][1]) : 'Revise os campos: ' + errs.map(function (e) { return esc(e[1]); }).join(' ');
    box.classList.add('is-on');
    var first = errs[0][0] ? $('[data-field="' + errs[0][0] + '"] input', form) : null;
    (first || box).focus();
  }

  /* ---------- Dados enviados ---------- */
  function requestId() {
    var p = C.store.get(PENDING_KEY);
    if (p) return p;
    var id = 'CVM-' + Date.now().toString(36).toUpperCase().slice(-6) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    C.store.set(PENDING_KEY, id);
    return id;
  }
  function fill() {
    var o = C.store.get('cuidare.origem', {}) || {};
    var periodo = ($('input[name="periodo"]:checked', form) || {}).value || '';
    var v = {
      cuidado_para: J.labelOf('pessoa', answers.pessoa),
      local: J.labelOf('local', answers.local),
      necessidade: J.labelOf('necessidade', answers.necessidade),
      duracao: J.labelOf('horas', answers.horas),
      dias: J.labelOf('dias', answers.dias),
      inicio: J.labelOf('inicio', answers.inicio),
      bairro: (answers.bairro || '').trim(),
      situacao: J.labelOf('situacao', answers.situacao),
      observacoes: (answers.observacoes || '').trim().slice(0, 500),
      prioridade: J.priority(answers),
      resumo: J.summaryText(answers) + '\n• Melhor período para contato: ' + periodo,
      origem: o.utm_source || o.referrer || 'direto',
      midia: o.utm_medium || '', campanha: o.utm_campaign || '', utm_term: o.utm_term || '', utm_content: o.utm_content || '',
      gclid: o.gclid || '', fbclid: o.fbclid || '', pagina_entrada: o.landing || '',
      site_referencia: o.referrer || '',
      id_solicitacao: requestId(),
      enviado_em: new Date().toISOString()
    };
    Object.keys(v).forEach(function (k) { if (form[k]) form[k].value = v[k]; });
    return v;
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      promise.then(function (r) { clearTimeout(t); resolve(r); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function postNetlify() {
    var body = new URLSearchParams(new FormData(form)).toString();
    return fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body })
      .then(function (r) { if (!r.ok) throw new Error('http_' + r.status); return r; });
  }
  function postWebhook() {
    if (!LEAD.webhookUrl) return Promise.reject(new Error('webhook_nao_configurado'));
    var data = {}; new FormData(form).forEach(function (val, key) { if (key !== 'empresa' && key !== 'form-name') data[key] = val; });
    return fetch(LEAD.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { if (!r.ok) throw new Error('http_' + r.status); return r; });
  }
  function deliver() {
    var mode = LEAD.mode || 'netlify';
    if (location.protocol === 'file:') return Promise.reject(new Error('arquivo_local'));
    var jobs = [];
    if (mode === 'netlify' || mode === 'both') jobs.push(postNetlify());
    if (mode === 'webhook' || mode === 'both') jobs.push(postWebhook());
    // Sucesso se pelo menos um destino confirmar o recebimento.
    return withTimeout(Promise.allSettled(jobs).then(function (rs) {
      if (rs.some(function (r) { return r.status === 'fulfilled'; })) return true;
      throw rs[0].reason;
    }), LEAD.timeoutMs || 15000);
  }

  /* ---------- WhatsApp ---------- */
  function contact() {
    var p = ($('input[name="periodo"]:checked', form) || {}).value;
    return { nome: form.nome.value.trim(), periodo: p };
  }
  $('[data-wa-continue]').addEventListener('click', function (e) {
    e.currentTarget.href = C.waLink(J.whatsappMessage(answers, contact()));
    C.track('whatsapp_click', { location: 'avaliacao', prioridade: J.priority(answers) });
  });

  /* ---------- Envio ---------- */
  form.whatsapp.addEventListener('input', function (e) {
    var t = e.target, end = t.selectionEnd === t.value.length;
    t.value = maskPhone(t.value);
    if (end) t.setSelectionRange(t.value.length, t.value.length);
    if (validPhone(t.value)) setInvalid('whatsapp', false);
  });
  function refreshErrors() {
    var box = $('[data-form-errors]');
    if (!box.classList.contains('is-on') || sending) return;
    var errs = validate();
    if (!errs.length) { box.classList.remove('is-on'); box.textContent = ''; return; }
    box.innerHTML = errs.length === 1 ? esc(errs[0][1]) : 'Revise os campos: ' + errs.map(function (x) { return esc(x[1]); }).join(' ');
  }
  form.addEventListener('input', function (e) {
    if (e.target.name === 'nome' && e.target.value.trim().length >= 2) setInvalid('nome', false);
    refreshErrors();
  });
  form.addEventListener('change', function (e) {
    if (e.target.name === 'periodo') setInvalid('periodo', false);
    if (e.target.name === 'consentimento' && e.target.checked) setInvalid('consentimento', false);
    refreshErrors();
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (sending) return;
    if (form.empresa.value) return; // robô
    var errs = validate();
    showErrors(errs);
    if (errs.length) { C.track('lead_form_invalid', { campos: errs.map(function (x) { return x[0]; }).join(',') }); return; }
    var v = fill();
    var btn = $('[data-submit]', form);
    sending = true;
    btn.classList.add('is-loading'); btn.setAttribute('aria-busy', 'true');
    C.track('lead_submit_attempt', { prioridade: v.prioridade });
    deliver().then(function () {
      var c = contact();
      C.store.set(SENT_KEY, { id: v.id_solicitacao, nome: c.nome.split(' ')[0], periodo: c.periodo, wa: maskPhone(form.whatsapp.value), resumo: J.summaryText(answers) });
      C.store.del(PENDING_KEY);
      C.track('lead_submit_success', { prioridade: v.prioridade, origem: v.origem });
      J.clear();
      done();
    }).catch(function (err) {
      sending = false;
      btn.classList.remove('is-loading'); btn.removeAttribute('aria-busy');
      var box = $('[data-form-errors]');
      box.innerHTML = 'Não foi possível enviar agora. Tente novamente em instantes ou use <strong>Continuar pelo WhatsApp</strong>: suas respostas vão junto na mensagem.';
      box.classList.add('is-on'); box.focus();
      C.track('lead_submit_error', { motivo: String(err && err.message || err).slice(0, 40) });
    });
  });

  /* ---------- Confirmação ---------- */
  function done() {
    var s = C.store.get(SENT_KEY);
    if (!s) return;
    show('done');
    $('[data-done-title]').textContent = 'Recebemos sua solicitação' + (s.nome ? ', ' + s.nome : '') + '.';
    $('[data-done-contact]').textContent = 'Entramos em contato pelo WhatsApp ' + (s.wa || 'informado') + (s.periodo ? ', no período da ' + s.periodo : '') + '.';
    $('[data-done-code]').textContent = s.id;
    $('[data-wa-done]').href = C.waLink('Olá! Acabei de enviar uma solicitação pelo site da Cuidare Vila Mariana (código ' + s.id + ').' + (s.resumo ? '\n\n' + s.resumo : ''));
    $('[data-wa-done]').addEventListener('click', function () { C.track('whatsapp_click', { location: 'confirmacao' }); });
    $('[data-new-request]').addEventListener('click', function () { C.store.del(SENT_KEY); });
    var back = $('[data-back-exp]'); if (back) back.hidden = true;
    window.scrollTo({ top: 0, behavior: 'instant' });
    $('[data-done-title]').focus({ preventScroll: true });
  }

  /* ---------- Início ---------- */
  if (!hasAnswers() && C.store.get(SENT_KEY)) done();
  else if (!hasAnswers()) { show('empty'); var b = $('[data-back-exp]'); if (b) b.hidden = true; }
  else { C.store.del(SENT_KEY); show('form'); renderSummary(); C.track('review_view', { completo: J.isComplete(answers) }); }
})();
