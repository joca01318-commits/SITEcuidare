/* Cuidare — página 3: resumo, detalhes do atendimento escolhido, dados e WhatsApp. */
(function () {
  'use strict';
  var C = window.Cuidare, K = window.CuidareConsulta;
  if (!C || !K) return;
  var $ = C.$, $$ = C.$$, esc = C.esc;
  var CFG = C.cfg, LEAD = CFG.lead || { mode: 'netlify', formName: 'consulta' };
  var ICON = function (id) { return '<svg aria-hidden="true"><use href="#i-' + id + '"/></svg>'; };
  var SENT_KEY = 'cuidare.consulta.registrada', ID_KEY = 'cuidare.consulta.id';

  var a = K.load().a;
  var form = $('[data-lead-form]');
  var statusBox = $('[data-status]');
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
      'Você envia a solicitação pelo WhatsApp, com o resumo desta consulta.',
      'A equipe confirma os detalhes e agenda a visita de avaliação, gratuita.',
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

    var contato = [
      'WhatsApp comercial: ' + esc((CFG.whatsapp && CFG.whatsapp.display) || '(11) 91634-9800') + '.',
      'Ao continuar, a conversa abre com o resumo desta consulta. Você revisa antes de enviar.',
      'Precisa ajustar algo? Use “Editar” no resumo ou escreva nas observações.'
    ];

    $('[data-dt-info]').innerHTML =
      card('shield', 'O que está incluído', incluido) +
      card('info', 'O que não está incluído', naoInclui, 'ticks--no') +
      card('doc', 'Como funciona a contratação', contratacao, 'ticks--steps') +
      card('eye', 'Como é feita a avaliação', avaliacao) +
      card('calendar', 'Condições a confirmar', condicoes) +
      card('wa', 'Contato com a equipe', contato, '', false);

    var title = s.t || 'seu atendimento';
    var cut = title.lastIndexOf(' ');
    $('[data-dt-title]').innerHTML = cut > 0 ? esc(title.slice(0, cut)) + ' <em>' + esc(title.slice(cut + 1)) + '.</em>' : '<em>' + esc(title) + '.</em>';
    $('[data-dt-intro]').textContent = s.intro || '';
    document.title = title + ' — detalhes e solicitação · Cuidare Vila Mariana';
  }

  /* ---------- Formulário ---------- */
  function digits(v) { return String(v || '').replace(/\D/g, ''); }
  function maskPhone(v) {
    var d = digits(v).slice(0, 11);
    if (d.length <= 2) return d.length ? '(' + d : '';
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  function validPhone(v) { var d = digits(v); return (d.length === 10 || d.length === 11) && +d.slice(0, 2) >= 11 && (d.length === 10 || d[2] === '9'); }
  function validName(v) { var parts = String(v || '').trim().split(/\s+/).filter(function (p) { return p.length >= 2; }); return parts.length >= 2; }
  function validEmail(v) { v = String(v || '').trim(); return !v || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }

  function setInvalid(name, on) {
    var f = $('[data-field="' + name + '"]', form); if (!f) return;
    f.classList.toggle('is-invalid', on);
    var input = $('input', f);
    if (input) { if (on) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
  }
  function validate() {
    var errs = [], ok;
    ok = validName(form.nome.value); setInvalid('nome', !ok); if (!ok) errs.push(['nome', 'Informe seu nome completo.']);
    ok = validPhone(form.whatsapp.value); setInvalid('whatsapp', !ok); if (!ok) errs.push(['whatsapp', 'Informe um WhatsApp válido, com DDD.']);
    ok = validEmail(form.email.value); setInvalid('email', !ok); if (!ok) errs.push(['email', 'Confira o e-mail ou deixe em branco.']);
    ok = form.consentimento.checked; setInvalid('consentimento', !ok); if (!ok) errs.push(['consentimento', 'Precisamos da sua autorização para continuar.']);
    return errs;
  }
  function showErrors(errs) {
    var box = $('[data-form-errors]');
    if (!errs.length) { box.classList.remove('is-on'); box.textContent = ''; return; }
    box.textContent = errs.length === 1 ? errs[0][1] : 'Revise os campos: ' + errs.map(function (e) { return e[1]; }).join(' ');
    box.classList.add('is-on');
    var first = $('[data-field="' + errs[0][0] + '"] input', form);
    (first || box).focus();
  }

  function requestId() {
    var id = C.store.get(ID_KEY);
    if (id) return id;
    id = 'CVM-' + Date.now().toString(36).toUpperCase().slice(-6) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    C.store.set(ID_KEY, id);
    return id;
  }
  function contact() {
    return {
      nome: form.nome.value.trim().replace(/\s+/g, ' '),
      email: form.email.value.trim(),
      whatsapp: maskPhone(form.whatsapp.value),
      observacoes: form.observacoes.value.trim().slice(0, 500),
      id: requestId()
    };
  }
  function fill(c) {
    var o = C.store.get('cuidare.origem', {}) || {};
    var p = K.priceText(price, a);
    var v = {
      servico: K.labelOf('servico', a.servico),
      duracao: K.labelOf('duracao', a.duracao),
      frequencia: K.labelOf('frequencia', a.frequencia),
      bairro: (a.bairro || '').trim(),
      inicio: K.labelOf('inicio', a.inicio),
      necessidades: (a.necessidades || []).map(function (n) { return K.labelOf('necessidades', n); }).join(', '),
      valor_apresentado: p.linha,
      versao_precos: price.versao || '',
      prioridade: K.priority(a),
      resumo: K.whatsappMessage(a, price, c),
      origem: o.utm_source || o.referrer || 'direto',
      midia: o.utm_medium || '', campanha: o.utm_campaign || '', utm_term: o.utm_term || '', utm_content: o.utm_content || '',
      gclid: o.gclid || '', fbclid: o.fbclid || '', pagina_entrada: o.landing || '', site_referencia: o.referrer || '',
      id_solicitacao: c.id,
      enviado_em: new Date().toISOString()
    };
    Object.keys(v).forEach(function (k) { if (form[k]) form[k].value = v[k]; });
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('timeout')); }, ms);
      promise.then(function (r) { clearTimeout(t); resolve(r); }, function (e) { clearTimeout(t); reject(e); });
    });
  }
  function postNetlify() {
    var body = new URLSearchParams(new FormData(form)).toString();
    return fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body, keepalive: true })
      .then(function (r) { if (!r.ok) throw new Error('http_' + r.status); return r; });
  }
  function postWebhook() {
    if (!LEAD.webhookUrl) return Promise.reject(new Error('webhook_nao_configurado'));
    var data = {}; new FormData(form).forEach(function (val, key) { if (key !== 'empresa' && key !== 'form-name') data[key] = val; });
    return fetch(LEAD.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), keepalive: true })
      .then(function (r) { if (!r.ok) throw new Error('http_' + r.status); return r; });
  }
  function deliver() {
    var mode = LEAD.mode || 'netlify';
    if (mode === 'off') return Promise.reject(new Error('registro_desativado'));
    if (location.protocol === 'file:') return Promise.reject(new Error('arquivo_local'));
    var jobs = [];
    if (mode === 'netlify' || mode === 'both') jobs.push(postNetlify());
    if (mode === 'webhook' || mode === 'both') jobs.push(postWebhook());
    if (!jobs.length) return Promise.reject(new Error('sem_destino'));
    return withTimeout(Promise.allSettled(jobs).then(function (rs) {
      if (rs.some(function (r) { return r.status === 'fulfilled'; })) return true;
      throw rs[0].reason;
    }), LEAD.timeoutMs || 12000);
  }

  function status(state, url, id, opened) {
    var lead = opened
      ? '<h3 tabindex="-1">Sua mensagem está pronta no WhatsApp.</h3><p>Abrimos a conversa com a Cuidare Vila Mariana em outra aba. Envie a mensagem para falar com a equipe.</p>'
      : '<h3 tabindex="-1">Falta só abrir o WhatsApp.</h3><p>O navegador não abriu a conversa automaticamente. Use o botão abaixo: a mensagem já está pronta.</p>';
    var reg = {
      pending: '<p>Registrando sua solicitação para a equipe…</p>',
      ok: '<p>Sua solicitação também foi registrada para a equipe. Código: <code>' + esc(id) + '</code>.</p>',
      fail: '<p>O registro automático não foi concluído. Para garantir o atendimento, envie a mensagem no WhatsApp.</p>'
    }[state] || '';
    statusBox.innerHTML = lead + reg +
      '<a class="btn ' + (opened ? 'btn--glass' : 'btn--primary') + ' btn--sm" href="' + esc(url) + '" target="_blank" rel="noopener" data-wa-again>' + ICON('wa') + '<span>' + (opened ? 'Abrir o WhatsApp novamente' : 'Abrir o WhatsApp') + '</span></a>';
    statusBox.hidden = false;
  }

  function onSubmit(e) {
    e.preventDefault();
    var errs = validate();
    showErrors(errs);
    if (errs.length) { C.track('lead_form_invalid', { campos: errs.map(function (x) { return x[0]; }).join(',') }); return; }

    var c = contact();
    fill(c);
    var url = C.waLink(K.whatsappMessage(a, price, c));
    var win = null;
    try { win = window.open(url, '_blank'); if (win) win.opener = null; } catch (err) { win = null; }
    C.track('whatsapp_click', { location: 'formulario', prioridade: K.priority(a) });

    var sentFor = C.store.get(SENT_KEY);
    if (sentFor === c.id) { status('ok', url, c.id, !!win); return focusStatus(); }
    status('pending', url, c.id, !!win);
    focusStatus();
    C.track('lead_submit_attempt', { prioridade: K.priority(a) });
    deliver().then(function () {
      C.store.set(SENT_KEY, c.id);
      C.track('lead_submit_success', { prioridade: K.priority(a) });
      status('ok', url, c.id, !!win);
    }, function (err) {
      C.track('lead_submit_error', { motivo: String(err && err.message || 'erro').slice(0, 40) });
      status('fail', url, c.id, !!win);
    });
  }
  function focusStatus() { var h = $('h3', statusBox); if (h) h.focus({ preventScroll: true }); statusBox.scrollIntoView({ behavior: C.reduce ? 'auto' : 'smooth', block: 'center' }); }

  if (form) {
    form.whatsapp.addEventListener('input', function () {
      var pos = form.whatsapp.value.length; form.whatsapp.value = maskPhone(form.whatsapp.value);
      if (pos === form.whatsapp.value.length && validPhone(form.whatsapp.value)) setInvalid('whatsapp', false);
    });
    form.nome.addEventListener('input', function () { if (validName(form.nome.value)) setInvalid('nome', false); });
    form.email.addEventListener('input', function () { if (validEmail(form.email.value)) setInvalid('email', false); });
    form.consentimento.addEventListener('change', function () { if (form.consentimento.checked) setInvalid('consentimento', false); });
    form.observacoes.addEventListener('input', function () { $('[data-obs-count]', form).textContent = String(form.observacoes.value.length); });
    form.addEventListener('submit', onSubmit);
    statusBox.addEventListener('click', function (e) { if (e.target.closest('[data-wa-again]')) C.track('whatsapp_click', { location: 'status' }); });
  }

  /* ---------- Início ---------- */
  if (!hasConfig()) { empty(); return; }
  K.obterPreco(a).then(function (r) {
    price = r;
    renderSummary();
    renderInfo();
    C.track('details_view', { status: r.status, duracao: a.duracao, frequencia: a.frequencia });
    if (location.hash) { var t = $(location.hash); if (t) t.scrollIntoView(); }
  });
})();
