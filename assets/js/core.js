/* Cuidare — base compartilhada pelas três páginas. */
(function () {
  'use strict';

  var CFG = window.CUIDARE_CONFIG || {};
  var doc = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var conn = navigator.connection || {};
  var lowPower = conn.saveData === true || (navigator.hardwareConcurrency || 8) <= 2 ||
    (navigator.deviceMemory !== undefined && navigator.deviceMemory <= 2);
  var isFile = location.protocol === 'file:';
  var root = doc.getAttribute('data-root') || './';

  if (!reduce) doc.classList.add('motion');

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  var store = {
    get: function (k, fallback, local) {
      try { var v = (local ? localStorage : sessionStorage).getItem(k); return v === null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set: function (k, v, local) { try { (local ? localStorage : sessionStorage).setItem(k, JSON.stringify(v)); } catch (e) { /* noop */ } },
    del: function (k, local) { try { (local ? localStorage : sessionStorage).removeItem(k); } catch (e) { /* noop */ } }
  };

  /* ---------- URLs entre páginas (funciona no Netlify e abrindo do disco) ---------- */
  // Versão em arquivo único (dist/cuidare-vila-mariana.html): as páginas viram ?pagina=nome.
  var single = window.CUIDARE_SINGLE === true;
  function pageUrl(name, query) {
    if (single) {
      var q = (query || '').replace(/^\?/, '');
      return location.pathname + '?pagina=' + (name || 'inicio') + (q ? '&' + q : '');
    }
    var path = root + (name ? name + '/' : '');
    if (isFile) path += 'index.html';
    return path + (query || '');
  }
  if (isFile && !single) {
    $$('a[href]').forEach(function (a) {
      var href = a.getAttribute('href');
      if (/^(https?:|mailto:|tel:|#)/.test(href)) return;
      var u = new URL(href, location.href);
      if (u.protocol === 'file:' && /\/$/.test(u.pathname)) { u.pathname += 'index.html'; a.href = u.href; }
    });
  }

  /* ---------- WhatsApp ---------- */
  function waLink(message) {
    var n = (CFG.whatsapp && CFG.whatsapp.number) || '5511916349800';
    return 'https://wa.me/' + n + (message ? '?text=' + encodeURIComponent(message) : '');
  }
  $$('[data-wa]').forEach(function (a) {
    a.href = waLink(a.getAttribute('data-wa-msg') || 'Olá! Vim pelo site da Cuidare Vila Mariana e gostaria de falar com a equipe.');
    a.addEventListener('click', function () { track('whatsapp_click', { location: a.getAttribute('data-wa') || 'site' }); });
  });
  $$('[data-reviews]').forEach(function (a) { if (CFG.reviewsUrl) a.href = CFG.reviewsUrl; });
  $$('[data-phone]').forEach(function (a) {
    if (CFG.whatsapp) { a.href = 'tel:+' + CFG.whatsapp.number; a.textContent = CFG.whatsapp.display; }
  });

  /* ---------- Origem da visita (primeiro acesso da sessão) ---------- */
  (function captureOrigin() {
    if (store.get('cuidare.origem')) return;
    var q = new URLSearchParams(location.search);
    var o = { landing: location.pathname, referrer: '' };
    try { if (document.referrer && new URL(document.referrer).host !== location.host) o.referrer = new URL(document.referrer).host; } catch (e) { /* noop */ }
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'].forEach(function (k) {
      if (q.get(k)) o[k] = q.get(k).slice(0, 120);
    });
    store.set('cuidare.origem', o);
  })();

  /* ---------- Medição (somente com consentimento e se configurada) ---------- */
  var gtmId = CFG.analytics && CFG.analytics.gtmId;
  var consent = store.get('cuidare.consent', null, true); // 'granted' | 'denied' | null
  window.dataLayer = window.dataLayer || [];
  window.__cuidareEvents = []; // registro local (sem envio) — útil para testes

  function track(event, params) {
    var payload = Object.assign({ event: 'cuidare_' + event }, params || {});
    window.__cuidareEvents.push(payload);
    if (gtmId && consent === 'granted') window.dataLayer.push(payload);
  }
  function loadGtm() {
    if (!gtmId || document.getElementById('gtm-script')) return;
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    var s = document.createElement('script');
    s.id = 'gtm-script'; s.async = true;
    s.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(gtmId);
    document.head.appendChild(s);
  }
  function consentBanner() {
    if (!gtmId || consent) { if (consent === 'granted') loadGtm(); return; }
    var bar = document.createElement('div');
    bar.className = 'consent';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Preferências de privacidade');
    bar.innerHTML = '<p>Usamos ferramentas de medição para entender como o site é usado e melhorar o atendimento. ' +
      '<button type="button" class="link" data-open-privacy>Saiba mais</button></p>' +
      '<div class="consent__actions"><button type="button" class="btn btn--glass btn--sm" data-c="denied">Recusar</button>' +
      '<button type="button" class="btn btn--primary btn--sm" data-c="granted">Aceitar</button></div>';
    document.body.appendChild(bar);
    requestAnimationFrame(function () { bar.classList.add('is-in'); });
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-c]');
      if (!b) return;
      consent = b.getAttribute('data-c');
      store.set('cuidare.consent', consent, true);
      if (consent === 'granted') loadGtm();
      bar.classList.remove('is-in');
      setTimeout(function () { bar.remove(); }, 400);
    });
  }

  /* ---------- Aviso de privacidade (único, em todas as páginas) ---------- */
  function privacyDialog() {
    var d = document.createElement('dialog');
    d.className = 'privacy';
    d.id = 'privacidade';
    d.setAttribute('aria-labelledby', 'privacy-title');
    var phone = (CFG.whatsapp && CFG.whatsapp.display) || '(11) 91634-9800';
    d.innerHTML =
      '<div class="privacy__inner">' +
      '<button type="button" class="privacy__close" data-close aria-label="Fechar">×</button>' +
      '<p class="eyebrow">Privacidade</p>' +
      '<h2 id="privacy-title">Aviso de privacidade</h2>' +
      '<h3>Quais dados usamos</h3><p>As escolhas da consulta (tipo de atendimento, duração, frequência, bairro, previsão de início e, se você informar, necessidades), seu nome, seu WhatsApp e, se você quiser, seu e-mail e observações. Não pedimos CPF, documentos, endereço completo nem dados clínicos detalhados.</p>' +
      '<h3>Para quê</h3><p>Para mostrar o valor da configuração escolhida, entrar em contato com você e dar continuidade à sua solicitação. As informações sobre a necessidade de cuidado são usadas somente para esse fim.</p>' +
      '<h3>No seu navegador</h3><p>Suas escolhas ficam salvas apenas nesta aba do navegador e são apagadas ao fechá-la.</p>' +
      '<h3>WhatsApp</h3><p>Ao continuar pelo WhatsApp, a conversa acontece no aplicativo, com a mensagem que você revisa antes de enviar.</p>' +
      '<h3>Medição</h3><p>Ferramentas de análise só são ativadas se você autorizar. Elas não recebem seu nome, telefone, e-mail nem informações sobre a necessidade de cuidado.</p>' +
      '<h3>Seus direitos</h3><p>Você pode pedir acesso, correção ou exclusão dos seus dados a qualquer momento pelo WhatsApp ou telefone ' + phone + '.</p>' +
      '<p class="privacy__who">Responsável: Cuidare Vila Mariana.</p>' +
      '</div>';
    document.body.appendChild(d);
    d.addEventListener('click', function (e) {
      if (e.target === d || e.target.closest('[data-close]')) d.close();
    });
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-open-privacy]');
      if (!t) return;
      e.preventDefault();
      if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    });
  }

  /* ---------- Cabeçalho ---------- */
  var hdr = $('[data-hdr]');
  if (hdr) {
    var onScroll = function () { hdr.classList.toggle('is-scrolled', (window.scrollY || 0) > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Entradas suaves ---------- */
  function reveal(scope) {
    var els = $$('[data-reveal]', scope);
    if (reduce || !('IntersectionObserver' in window)) { els.forEach(function (el) { el.classList.add('is-in'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Fotos reais (opcionais, via config) ---------- */
  function photo(slot) {
    var src = (CFG.photos || {})[slot.getAttribute('data-photo')];
    if (!src || slot.classList.contains('has-photo')) return;
    var img = new Image();
    img.alt = slot.getAttribute('data-photo-alt') || '';
    img.decoding = 'async';
    img.loading = 'lazy';
    img.onload = function () { slot.insertBefore(img, slot.firstChild); slot.classList.add('has-photo'); };
    img.src = root + src;
  }
  function photos(scope) { $$('[data-photo]', scope).forEach(photo); }

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- Cena 3D (WebGL), sob demanda ---------- */
  function cena(canvas, opts) {
    if (!canvas || lowPower || !window.WebGLRenderingContext) return Promise.resolve(null);
    // Celulares: 3D só em aparelhos com folga de processamento; nos demais fica a versão leve em CSS.
    var phone = !finePointer || window.innerWidth < 760;
    if (phone && !((navigator.deviceMemory || 4) >= 4 && (navigator.hardwareConcurrency || 4) >= 6)) return Promise.resolve(null);
    return new Promise(function (resolve) {
      function start() {
        if (!window.CuidareCena) return resolve(null);
        resolve(window.CuidareCena.init(canvas, Object.assign({ reduce: reduce, mobile: phone }, opts || {})) || null);
      }
      function load() {
        if (window.CuidareCena) return start();
        var s = document.createElement('script');
        s.src = root + 'assets/js/cena.js';
        s.async = true;
        s.onload = start;
        s.onerror = function () { resolve(null); };
        document.head.appendChild(s);
      }
      if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 700 }); else setTimeout(load, 200);
    });
  }

  /* ---------- Rastreio de cliques em CTAs ---------- */
  document.addEventListener('click', function (e) {
    var cta = e.target.closest('[data-track]');
    if (cta) track('cta_click', { cta: cta.getAttribute('data-track') });
  });

  var year = $('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());

  privacyDialog();
  consentBanner();
  reveal();
  photos();
  requestAnimationFrame(function () { doc.classList.add('is-loaded'); });

  window.Cuidare = {
    cfg: CFG, $: $, $$: $$, store: store, reduce: reduce, finePointer: finePointer, lowPower: lowPower,
    pageUrl: pageUrl, waLink: waLink, track: track, reveal: reveal, cena: cena, esc: esc, photo: photo
  };
})();
