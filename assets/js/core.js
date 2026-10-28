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
    }, { threshold: 0.01, rootMargin: '0px 0px 12% 0px' });
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

  /* ---------- Tabela de valores do plano (páginas 2 e 3) ---------- */
  // p = CuidareConsulta.priceText(...). Uma linha por duração (ícone de dia, noite ou 24 horas)
  // e uma coluna por período: 3 nos Planos Mensais, 2 nos Planos Diários.
  function tabela(p, nome, compact) {
    var ic = function (id) { return '<svg aria-hidden="true"><use href="#i-' + id + '"/></svg>'; };
    var cols = p.cols || [];
    return '<div class="ptab ptab--c' + cols.length + (compact ? ' ptab--compact' : '') + '" data-ptab>' +
      '<table class="ptab__t"><caption class="sr-only">Valores ' + esc(p.unidade || '') + (nome ? ' dos ' + esc(nome) : '') + ', conforme a duração e os dias</caption>' +
      '<thead><tr><th scope="col" class="ptab__th ptab__th--dur">' + esc(p.linhaLabel || 'Duração') + '</th>' +
      cols.map(function (c, k) {
        return '<th scope="col" class="ptab__th' + (k === cols.length - 1 ? ' ptab__th--last' : '') + '"><span class="ptab__hi">' + ic('calendar') + '</span><span class="ptab__hl">' + esc(c) + '</span><span class="ptab__hu">' + esc(p.unidade || '') + '</span></th>';
      }).join('') + '</tr></thead>' +
      '<tbody>' + (p.linhas || []).map(function (l, k) {
        var badge = l.icon === '24' ? '<b aria-hidden="true">24</b>' : ic(l.icon);
        return '<tr class="ptab__row ptab__row--' + esc(l.periodo) + '" style="--i:' + k + '">' +
          '<th scope="row" class="ptab__dur"><span class="ptab__c" style="--c:0"><span class="ptab__ic ptab__ic--' + esc(l.periodo) + '">' + badge + '</span>' +
          '<span class="ptab__dt"><span class="ptab__h">' + esc(l.h) + '</span>' + (l.sub ? '<span class="ptab__sub">' + esc(l.sub) + '</span>' : '') + '</span></span></th>' +
          (l.valores || []).map(function (v, j) {
            return '<td class="ptab__td' + (j === cols.length - 1 ? ' ptab__td--last' : '') + '"><span class="ptab__c" style="--c:' + (j + 1) + '">' +
              (v ? '<span class="ptab__v">' + esc(v) + '</span>' : '<span class="ptab__u">Sob consulta</span>') + '</span></td>';
          }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ---------- Interações 3D: inclinação com brilho ---------- */
  // [data-tilt]: segue o mouse; no celular, o dedo enquanto toca e a inclinação do aparelho
  // (quando o navegador permite sem pedir autorização). Desligado com "reduzir movimento".
  function tilt(scope) {
    if (reduce) return;
    $$('[data-tilt]', scope).forEach(function (el) {
      if (el.hasAttribute('data-tilt-on')) return;
      el.setAttribute('data-tilt-on', '');
      var max = parseFloat(el.getAttribute('data-tilt')) || 8, raf = 0, rx = 0, ry = 0, gx = 50, gy = 30;
      var apply = function () {
        raf = 0;
        el.style.setProperty('--rx', rx.toFixed(2) + 'deg'); el.style.setProperty('--ry', ry.toFixed(2) + 'deg');
        el.style.setProperty('--gx', gx.toFixed(1) + '%'); el.style.setProperty('--gy', gy.toFixed(1) + '%');
      };
      var at = function (x, y) {
        var b = el.getBoundingClientRect(); if (!b.width) return;
        var px = Math.max(0, Math.min(1, (x - b.left) / b.width)), py = Math.max(0, Math.min(1, (y - b.top) / b.height));
        ry = (px - 0.5) * max * 2; rx = -(py - 0.5) * max * 2; gx = px * 100; gy = py * 100;
        el.classList.add('is-tilting');
        if (!raf) raf = requestAnimationFrame(apply);
      };
      var rest = function () { rx = 0; ry = 0; gx = 50; gy = 30; el.classList.remove('is-tilting'); if (!raf) raf = requestAnimationFrame(apply); };
      el.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse' || e.pointerType === 'pen') at(e.clientX, e.clientY); });
      el.addEventListener('pointerleave', rest);
      el.addEventListener('touchmove', function (e) { var t = e.touches[0]; if (t) at(t.clientX, t.clientY); }, { passive: true });
      el.addEventListener('touchend', rest, { passive: true });
      el.addEventListener('touchcancel', rest, { passive: true });
    });
  }
  // Celular: inclinação suave de todos os [data-tilt] visíveis conforme o aparelho se move.
  if (!reduce && !finePointer && 'DeviceOrientationEvent' in window && typeof DeviceOrientationEvent.requestPermission !== 'function') {
    var oraf = 0, ob = 0, og = 0;
    window.addEventListener('deviceorientation', function (e) {
      if (e.beta == null) return;
      ob = Math.max(-1, Math.min(1, (e.beta - 45) / 30)); og = Math.max(-1, Math.min(1, (e.gamma || 0) / 25));
      if (oraf) return;
      oraf = requestAnimationFrame(function () {
        oraf = 0;
        $$('[data-tilt]:not(.is-tilting)').forEach(function (el) {
          var m = (parseFloat(el.getAttribute('data-tilt')) || 8) * 0.6;
          el.style.setProperty('--rx', (-ob * m).toFixed(2) + 'deg'); el.style.setProperty('--ry', (og * m).toFixed(2) + 'deg');
          el.style.setProperty('--gx', (50 + og * 40).toFixed(1) + '%'); el.style.setProperty('--gy', (30 + ob * 30).toFixed(1) + '%');
        });
      });
    }, { passive: true });
  }

  /* ---------- Enfeites animados por seção ([data-deco]) ---------- */
  // Camada decorativa (atrás do conteúdo, sem cliques): anéis orbitais, ícones flutuando,
  // pontos de luz, círculos translúcidos, ondas, linhas curvas luminosas, selos e partículas.
  // Só transform e opacity nas animações; no celular, menos partículas e menos peças.
  var DK = {
    // [tipo, x%, y%, tamanho(px), duração(s), extra]
    // a capa já tem a cena 3D: enfeites leves
    hero: [['ring', 8, 70, 220, 26], ['ring', 88, 18, 160, 18, 'rev'], ['dot', 30, 22, 10, 4], ['dot', 70, 78, 8, 5.5], ['dot', 92, 60, 12, 3.6],
      ['ico', 22, 14, 44, 7, 'calendar'], ['ico', 80, 84, 40, 9, 'check', 'd'], ['spark', 14]],
    planos: [['circ', 92, 12, 260, 12], ['circ', 4, 78, 180, 10], ['ring', 96, 70, 300, 30, 'rev'], ['ring', 2, 18, 140, 16], ['wave', 0, 100, 0, 14],
      ['line', 0, 10, 100, 30, 'b'], ['ico', 90, 32, 46, 8, 'home', 'd'], ['ico', 3, 52, 40, 6.5, 'heart', 'd'], ['ico', 94, 88, 38, 9.5, 'clock', 'd'], ['ico', 46, 6, 34, 7.5, 'calendar', 'd'],
      ['chip', 76, 6, 0, 8, 'Supervisão próxima', 'd'], ['chip', 2, 92, 0, 9, 'Faltas cobertas', 'd'], ['dot', 70, 20, 10, 4.2], ['dot', 12, 60, 8, 5], ['dot', 50, 96, 12, 3.4], ['spark', 30]],
    why: [['ring', 90, 20, 240, 24], ['circ', 6, 30, 200, 11], ['line', 0, 70, 100, 30, 'a'], ['ico', 10, 14, 40, 7, 'shield'], ['ico', 92, 70, 42, 8.5, 'users', 'd'],
      ['dot', 80, 10, 10, 4.4], ['dot', 20, 86, 8, 5.2], ['spark', 22]],
    tst: [['circ', 96, 20, 220, 12], ['ring', 4, 80, 180, 20, 'rev'], ['ico', 6, 20, 40, 7, 'star'], ['ico', 52, 90, 36, 9, 'heart', 'd'], ['chip', 70, 6, 0, 8.5, '4,8 de 5 estrelas', 'd'], ['dot', 40, 12, 10, 4], ['spark', 18]],
    final: [['ring', 92, 50, 260, 22], ['ring', 6, 30, 160, 16, 'rev'], ['ico', 12, 76, 42, 7.5, 'heart'], ['ico', 86, 18, 38, 6.5, 'check'], ['dot', 60, 14, 10, 4.2], ['dot', 30, 90, 8, 5.4], ['wave', 0, 100, 0, 16], ['spark', 16]],
    valor: [['circ', 4, 14, 220, 12], ['ring', 2, 60, 200, 26, 'rev'], ['ring', 98, 30, 260, 30], ['line', 0, 30, 100, 60, 'b'], ['wave', 0, 100, 0, 15],
      ['ico', 44, 10, 40, 7, 'calendar', 'd'], ['ico', 96, 84, 42, 9, 'shield', 'd'], ['ico', 40, 94, 34, 6.5, 'check'], ['chip', 40, 95, 0, 8.5, 'Valores de tabela', 'd'],
      ['dot', 30, 8, 10, 4.2], ['dot', 88, 12, 8, 5.6], ['dot', 60, 96, 10, 3.8], ['spark', 28]],
    detalhes: [['circ', 96, 8, 240, 12], ['ring', 98, 50, 280, 30, 'rev'], ['ring', 2, 80, 160, 18], ['line', 0, 20, 100, 50, 'a'], ['ico', 97, 4, 42, 7.5, 'shield', 'd'],
      ['ico', 1.5, 40, 38, 8.5, 'heart', 'd'], ['ico', 50, 3, 34, 6.5, 'check', 'd'], ['dot', 20, 10, 10, 4.4], ['dot', 70, 92, 8, 5], ['spark', 22]]
  };
  var WAVE = 'M0 60 C 150 20 300 100 450 60 S 750 20 900 60 S 1200 100 1350 60 S 1650 20 1800 60 S 2100 100 2400 60 V120 H0Z';
  var LINES = { a: 'M0 70 C 18 20 38 95 55 50 S 85 10 100 40', b: 'M0 30 C 20 80 40 0 60 45 S 90 85 100 20' };
  function deco(scope) {
    var phone = window.innerWidth < 760;
    $$('[data-deco]', scope).forEach(function (host) {
      if (host.querySelector(':scope > .deco')) return;
      var list = DK[host.getAttribute('data-deco')]; if (!list) return;
      var seed = 7, rnd = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      var h = list.map(function (d, k) {
        var t = d[0], pos = 'left:' + d[1] + '%;top:' + d[2] + '%;';
        var dur = '--t:' + d[4] + 's;--dl:' + (-(k * 1.7) % 9).toFixed(1) + 's;';
        var cls = (t === 'ico' || t === 'chip') && d[6] === 'd' ? ' dk--d' : '';
        if (t === 'ring') return '<span class="dk-ring' + (d[5] === 'rev' ? ' dk-ring--rev' : '') + '" style="' + pos + '--s:' + d[3] + 'px;' + dur + '"><i></i></span>';
        if (t === 'circ') return '<span class="dk-circ" style="' + pos + '--s:' + d[3] + 'px;' + dur + '"></span>';
        if (t === 'dot') return '<span class="dk-dot" style="' + pos + '--s:' + d[3] + 'px;' + dur + '"></span>';
        if (t === 'ico') return '<span class="dk-ico' + cls + '" style="' + pos + '--s:' + d[3] + 'px;' + dur + '"><svg><use href="#i-' + d[5] + '"/></svg></span>';
        if (t === 'chip') return '<span class="dk-chip' + cls + '" style="' + pos + dur + '"><b><svg><use href="#i-check"/></svg></b>' + esc(d[5]) + '</span>';
        if (t === 'wave') return '<span class="dk-wave" style="' + dur + '"><svg viewBox="0 0 2400 120" preserveAspectRatio="none"><path d="' + WAVE + '"/></svg><svg viewBox="0 0 2400 120" preserveAspectRatio="none"><path d="' + WAVE + '"/></svg></span>';
        if (t === 'line') return '<svg class="dk-line" style="top:' + d[2] + '%;height:' + d[4] + '%;" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="' + LINES[d[5]] + '" pathLength="100"/><path class="dk-line__run" d="' + LINES[d[5]] + '" pathLength="100"/></svg>';
        if (t === 'spark') {
          var n = Math.round(d[1] * (phone ? 0.25 : 0.5)), out = '';
          for (var i = 0; i < n; i++) out += '<span class="dk-spark" style="left:' + (rnd() * 100).toFixed(1) + '%;top:' + (rnd() * 100).toFixed(1) + '%;--s:' + (2 + rnd() * 3).toFixed(1) + 'px;--t:' + (6 + rnd() * 6).toFixed(1) + 's;--dl:' + (-rnd() * 10).toFixed(1) + 's;--o:' + (0.35 + rnd() * 0.5).toFixed(2) + '"></span>';
          return out;
        }
        return '';
      }).join('');
      var layer = document.createElement('div');
      layer.className = 'deco'; layer.setAttribute('aria-hidden', 'true');
      layer.innerHTML = '<span class="deco__glow"></span>' + h;
      host.insertBefore(layer, host.firstChild);
    });
    // Enfeites fora da tela ficam pausados (economiza bateria e deixa a rolagem leve).
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (en) { en.forEach(function (e) { e.target.classList.toggle('is-off', !e.isIntersecting); }); }, { rootMargin: '120px 0px' });
      $$('[data-deco]', scope).forEach(function (h) { io.observe(h); });
    }
    // Luz que percorre a borda dos cartões de destaque
    $$('.pcard--tabela, .info__card, .final__card', scope).forEach(function (el) {
      if (el.querySelector(':scope > .edge')) return;
      var e = document.createElement('span'); e.className = 'edge'; e.setAttribute('aria-hidden', 'true'); el.appendChild(e);
    });
  }

  /* ---------- Cena 3D (WebGL), sob demanda ---------- */
  function cena(canvas, opts) {
    if (!canvas || lowPower || !window.WebGLRenderingContext) return Promise.resolve(null);
    // Celulares: 3D nos aparelhos com 4 núcleos ou mais (qualidade ajustada sozinha); nos demais, versão leve em CSS.
    var phone = !finePointer || window.innerWidth < 760;
    if (phone && !((navigator.deviceMemory || 4) >= 2 && (navigator.hardwareConcurrency || 4) >= 4)) return Promise.resolve(null);
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
  deco();
  reveal();
  photos();
  tilt();
  requestAnimationFrame(function () { doc.classList.add('is-loaded'); });

  window.Cuidare = {
    cfg: CFG, $: $, $$: $$, store: store, reduce: reduce, finePointer: finePointer, lowPower: lowPower,
    pageUrl: pageUrl, asset: function (p) { return /^(data:|https?:)/.test(p) ? p : root + p; }, track: track, journey: journey, reveal: reveal, split: split, intro: doc.classList.contains('intro-on'), cena: cena, esc: esc, photo: photo, tabela: tabela, tilt: tilt, deco: deco
  };
})();
