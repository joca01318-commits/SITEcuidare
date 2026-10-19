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

  $$('[data-reviews]').forEach(function (a) { if (CFG.reviewsUrl) a.href = CFG.reviewsUrl; });

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
    d.innerHTML =
      '<div class="privacy__inner">' +
      '<button type="button" class="privacy__close" data-close aria-label="Fechar">×</button>' +
      '<p class="eyebrow">Privacidade</p>' +
      '<h2 id="privacy-title">Aviso de privacidade</h2>' +
      '<h3>Quais dados usamos</h3><p>Somente as escolhas desta consulta: tipo de atendimento, duração e frequência. O site não pede nome, telefone, e-mail, endereço, documentos nem dados clínicos.</p>' +
      '<h3>Para quê</h3><p>Para mostrar o valor da configuração escolhida e o resumo do atendimento.</p>' +
      '<h3>Onde ficam</h3><p>Apenas nesta aba do seu navegador. São apagadas ao fechá-la, e o site não registra dados pessoais.</p>' +
      '<h3>Medição</h3><p>Ferramentas de análise só são ativadas se você autorizar e nunca recebem dados pessoais.</p>' +
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
  /* Títulos que entram palavra por palavra */
  function split(el) {
    if (!el || el.hasAttribute('data-split-done')) return;
    var n = 0;
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          if (!c.textContent.trim()) return;
          var frag = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach(function (t) {
            if (!t) return;
            if (/^\s+$/.test(t)) { frag.appendChild(document.createTextNode(t)); return; }
            var w = document.createElement('span'), i = document.createElement('span');
            w.className = 'w'; i.className = 'w__i'; i.style.setProperty('--wi', n++); i.textContent = t;
            w.appendChild(i); frag.appendChild(w);
          });
          node.replaceChild(frag, c);
        } else if (c.nodeType === 1 && c.tagName !== 'BR' && c.tagName.toLowerCase() !== 'svg') walk(c);
      });
    })(el);
    el.setAttribute('data-split-done', '');
    el.classList.add('is-split');
  }

  function reveal(scope) {
    var els = $$('[data-reveal], [data-stagger], [data-split]:not([data-intro])', scope);
    els.forEach(function (el) {
      if (el.hasAttribute('data-split')) split(el);
      if (el.hasAttribute('data-stagger')) Array.prototype.forEach.call(el.children, function (c, i) { c.style.setProperty('--si', i); });
    });
    $$('[data-split][data-intro]', scope).forEach(function (el) { split(el); el.classList.add('is-in'); });
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
    // A imagem só entra no cartão depois de carregada; carregamento "lazy" impediria o download
    // (ela ainda não está na página), então o pedido é feito na hora, com prioridade baixa.
    if ('fetchPriority' in img) img.fetchPriority = 'low';
    img.onload = function () { slot.insertBefore(img, slot.firstChild); slot.classList.add('has-photo'); };
    img.src = /^(data:|https?:)/.test(src) ? src : root + src;
  }
  function photos(scope) { $$('[data-photo]', scope).forEach(photo); }

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- Tabela de diárias (hospital e consultas), páginas 2 e 3 ---------- */
  // p = CuidareConsulta.priceText(...) de um atendimento por diária. Uma linha por duração,
  // separada pelo horário (dia, noite, 24 horas), com o valor de segunda a sexta e o de fim de semana.
  function tabelaDiarias(p, servicoNome, compact) {
    var ic = function (id) { return '<svg aria-hidden="true"><use href="#i-' + id + '"/></svg>'; };
    var cab = p.cab || {};
    var cell = function (v, k) {
      return '<td class="ptab__td' + (k ? ' ptab__td--fds' : '') + '"><span class="ptab__c" style="--c:' + (k ? 2 : 1) + '">' +
        (v ? '<span class="ptab__v">' + esc(v) + '</span><span class="ptab__u">por dia</span>' : '<span class="ptab__u">Sob consulta</span>') + '</span></td>';
    };
    return '<div class="ptab' + (compact ? ' ptab--compact' : '') + '" data-ptab>' +
      '<table class="ptab__t"><caption class="sr-only">Valores por dia' + (servicoNome ? ' de ' + esc(servicoNome.toLowerCase()) : '') + ', conforme a duração e o dia da semana</caption>' +
      '<thead><tr><th scope="col" class="ptab__th ptab__th--dur">' + esc(cab.duracao || 'Duração') + '</th>' +
      '<th scope="col" class="ptab__th"><span class="ptab__hi">' + ic('calendar') + '</span><span>' + esc(cab.util || 'Segunda a sexta') + '</span></th>' +
      '<th scope="col" class="ptab__th ptab__th--fds"><span class="ptab__hi">' + ic('calendar') + '</span><span>' + esc(cab.fds || 'Sábados, domingos e feriados') + '</span></th></tr></thead>' +
      '<tbody>' + (p.linhas || []).map(function (l, k) {
        var badge = l.icon === '24' ? '<b aria-hidden="true">24</b>' : ic(l.icon);
        return '<tr class="ptab__row ptab__row--' + esc(l.periodo) + '" style="--i:' + k + '">' +
          '<th scope="row" class="ptab__dur"><span class="ptab__c" style="--c:0"><span class="ptab__ic ptab__ic--' + esc(l.periodo) + '">' + badge + '</span>' +
          '<span class="ptab__dt"><span class="ptab__h">' + esc(l.h) + '</span>' + (l.sub ? '<span class="ptab__sub">' + esc(l.sub) + '</span>' : '') + '</span></span></th>' +
          cell(l.valor, 0) + cell(l.fds, 1) + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

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

  /* ---------- Indicador de etapas (páginas do valor e dos detalhes) ---------- */
  function journey(labels, cur) {
    var j = $('[data-jstep]');
    if (j) j.innerHTML = labels.map(function (l, i) {
      if (i < cur) return '<li class="is-done"><span class="n" aria-hidden="true"><svg><use href="#i-check"/></svg></span>' + l + '</li>';
      if (i === cur) return '<li class="is-current" aria-current="step"><span class="n">' + (i + 1) + '</span>' + l + '</li>';
      return '<li><span class="n">' + (i + 1) + '</span>' + l + '</li>';
    }).join('');
    var bar = $('.jbar');
    if (bar && labels[cur]) {
      bar.firstElementChild.textContent = 'Etapa ' + (cur + 1) + ' de ' + labels.length + ' · ' + (labels[cur] === 'Valor' ? 'Seu valor' : labels[cur]);
      var fill = $('.jbar__track span', bar); if (fill) fill.style.width = Math.round((cur + 1) / labels.length * 100) + '%';
    }
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
    pageUrl: pageUrl, asset: function (p) { return /^(data:|https?:)/.test(p) ? p : root + p; }, track: track, journey: journey, reveal: reveal, split: split, intro: doc.classList.contains('intro-on'), cena: cena, esc: esc, photo: photo, tabelaDiarias: tabelaDiarias
  };
})();
