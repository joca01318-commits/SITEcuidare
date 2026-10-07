/* Cuidare Vila Mariana — interações
   JS puro, sem dependências. Efeitos se ajustam ao dispositivo e a prefers-reduced-motion. */
(function () {
  'use strict';

  var doc = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var conn = navigator.connection || {};
  var lowPower = conn.saveData === true ||
    (navigator.hardwareConcurrency || 8) <= 2 ||
    (navigator.deviceMemory !== undefined && navigator.deviceMemory <= 2);
  var mqMobile = window.matchMedia('(max-width: 760px)');

  if (!reduce) doc.classList.add('motion');

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var easeOutCubic = function (t) { return 1 - Math.pow(1 - t, 3); };
  var easeOutExpo = function (t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); };
  var fmt = function (n, decimals) {
    return n.toLocaleString('pt-BR', { minimumFractionDigits: decimals || 0, maximumFractionDigits: decimals || 0 });
  };

  /* ------------------------------------------------------------------
     WhatsApp — número existente: (11) 91634-9800
     ------------------------------------------------------------------ */
  var WA_NUMBER = '5511916349800';
  var WA_DEFAULT = 'Olá! Gostaria de agendar uma avaliação gratuita com a Cuidare Vila Mariana.';
  function waLink(msg) { return 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(msg); }
  $$('[data-wa]').forEach(function (a) { a.href = waLink(WA_DEFAULT); });

  /* ------------------------------------------------------------------
     Entrada cinematográfica
     ------------------------------------------------------------------ */
  var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([fontsReady, new Promise(function (r) { setTimeout(r, 700); })]).then(function () {
    requestAnimationFrame(function () {
      doc.classList.add('is-loaded');
      syncPills();
    });
  });

  /* ------------------------------------------------------------------
     Header, hero, parallax e CTA flutuante — um único loop de scroll
     ------------------------------------------------------------------ */
  var header = $('[data-header]');
  var heroFrame = $('[data-hero-frame]');
  var floatCta = $('[data-float-cta]');
  var ctaSection = $('#contato');
  var parallaxEls = (!reduce && !lowPower) ? $$('[data-speed]') : [];
  var ticking = false;

  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }

  function update() {
    ticking = false;
    var y = window.scrollY || window.pageYOffset;
    var vh = window.innerHeight;
    var heroH = heroFrame ? heroFrame.offsetHeight : vh;
    var headerH = header.offsetHeight;

    header.classList.toggle('is-scrolled', y > 8);
    header.setAttribute('data-mode', y + headerH < heroH - 24 ? 'dark' : 'light');

    var p = clamp(y / (heroH * 0.9), 0, 1);
    if (!reduce && heroFrame) heroFrame.style.setProperty('--p', p.toFixed(4));
    if (window.CuidareOrb && window.CuidareOrb.setScroll) window.CuidareOrb.setScroll(p);

    if (parallaxEls.length) {
      var reads = parallaxEls.map(function (el) {
        var r = el.parentElement.getBoundingClientRect();
        return (r.top + r.height / 2 - vh / 2);
      });
      parallaxEls.forEach(function (el, i) {
        var s = parseFloat(el.getAttribute('data-speed')) || 0;
        el.style.transform = 'translate3d(0,' + (reads[i] * s).toFixed(1) + 'px,0)';
      });
    }

    if (floatCta) {
      var nearEnd = ctaSection ? ctaSection.getBoundingClientRect().top < vh * 0.85 : false;
      var show = y > heroH * 0.75 && !nearEnd && !document.body.classList.contains('menu-open');
      if (show !== floatCta.classList.contains('is-visible')) {
        floatCta.classList.toggle('is-visible', show);
        floatCta.setAttribute('tabindex', show ? '0' : '-1');
        floatCta.setAttribute('aria-hidden', show ? 'false' : 'true');
      }
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();

  /* ------------------------------------------------------------------
     Ambiente por seção + link ativo no menu
     ------------------------------------------------------------------ */
  var navLinks = $$('.site-nav a');
  if ('IntersectionObserver' in window) {
    var secObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var amb = e.target.getAttribute('data-ambient');
        document.body.setAttribute('data-amb', amb === 'ice' ? 'ice' : 'light');
        var id = e.target.id;
        navLinks.forEach(function (a) {
          a.setAttribute('aria-current', a.getAttribute('href') === '#' + id ? 'true' : 'false');
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    $$('[data-ambient]').forEach(function (s) { secObserver.observe(s); });
  }

  /* ------------------------------------------------------------------
     Menu móvel
     ------------------------------------------------------------------ */
  var toggle = $('.menu-toggle');
  var menu = $('#menu-mobile');
  var menuTimer;

  function setMenu(open) {
    clearTimeout(menuTimer);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    document.body.classList.toggle('menu-open', open);
    if (open) {
      menu.hidden = false;
      void menu.offsetWidth;
      menu.classList.add('is-open');
      var first = $('a', menu);
      if (first) first.focus({ preventScroll: true });
    } else {
      menu.classList.remove('is-open');
      menuTimer = setTimeout(function () { menu.hidden = true; }, reduce ? 0 : 450);
    }
    update();
  }
  if (toggle && menu) {
    toggle.addEventListener('click', function () { setMenu(toggle.getAttribute('aria-expanded') !== 'true'); });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) setMenu(false); });
    document.addEventListener('keydown', function (e) {
      if (toggle.getAttribute('aria-expanded') !== 'true') return;
      if (e.key === 'Escape') { setMenu(false); toggle.focus(); return; }
      if (e.key === 'Tab') {
        var f = [toggle].concat($$('a', menu));
        var i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    });
    mqMobile.addEventListener && window.matchMedia('(min-width: 901px)').addEventListener('change', function (m) { if (m.matches) setMenu(false); });
  }

  /* ------------------------------------------------------------------
     Reveal no scroll
     ------------------------------------------------------------------ */
  var revealEls = $$('[data-reveal]');
  if (!reduce && 'IntersectionObserver' in window) {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); revealObs.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    revealEls.forEach(function (el) { revealObs.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ------------------------------------------------------------------
     Contadores dos números (valores finais idênticos ao original)
     ------------------------------------------------------------------ */
  function runCounter(el) {
    var original = el.textContent;
    var target = parseFloat(el.getAttribute('data-count'));
    var dec = parseInt(el.getAttribute('data-decimals') || '0', 10);
    var dur = 1700;
    var t0 = performance.now();
    (function step(now) {
      var t = clamp((now - t0) / dur, 0, 1);
      el.textContent = t < 1 ? fmt(target * easeOutExpo(t), dec) : original;
      if (t < 1) requestAnimationFrame(step);
    })(t0);
  }
  var stats = $$('.stat');
  if (!reduce && 'IntersectionObserver' in window) {
    var statObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        statObs.unobserve(e.target);
        var d = parseFloat(getComputedStyle(e.target).getPropertyValue('--d')) || 0;
        var delay = doc.classList.contains('is-loaded') ? d * 90 + 250 : d * 90 + 900;
        setTimeout(function () {
          var c = $('[data-count]', e.target);
          if (c) runCounter(c);
          e.target.classList.add('is-counted');
        }, delay);
      });
    }, { threshold: 0.4 });
    stats.forEach(function (s) { statObs.observe(s); });
  } else {
    stats.forEach(function (s) { s.classList.add('is-counted'); });
  }

  /* ------------------------------------------------------------------
     Microinterações: botões magnéticos, ripple, tilt 3D, spotlight
     ------------------------------------------------------------------ */
  if (!reduce) {
    document.addEventListener('pointerdown', function (e) {
      var btn = e.target.closest('.btn');
      if (!btn) return;
      var r = btn.getBoundingClientRect();
      var s = document.createElement('span');
      s.className = 'ripple';
      s.style.left = (e.clientX - r.left) + 'px';
      s.style.top = (e.clientY - r.top) + 'px';
      s.style.setProperty('--rs', String(Math.ceil(Math.max(r.width, r.height) / 5)));
      btn.appendChild(s);
      s.addEventListener('animationend', function () { s.remove(); });
    });
  }

  if (finePointer && !reduce) {
    $$('[data-magnetic]').forEach(function (el) {
      el.addEventListener('pointermove', function (e) {
        var r = el.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2);
        var dy = e.clientY - (r.top + r.height / 2);
        el.style.setProperty('--tx', (dx * 0.18).toFixed(1) + 'px');
        el.style.setProperty('--ty', (dy * 0.3).toFixed(1) + 'px');
      });
      el.addEventListener('pointerleave', function () {
        el.style.setProperty('--tx', '0px');
        el.style.setProperty('--ty', '0px');
      });
    });

    $$('[data-tilt], [data-spotlight]').forEach(function (el) {
      var tilt = el.hasAttribute('data-tilt') && !lowPower;
      var max = parseFloat(el.getAttribute('data-tilt')) || 5;
      var raf = 0, lx = 0, ly = 0;
      function apply() {
        raf = 0;
        var r = el.getBoundingClientRect();
        var px = (lx - r.left) / r.width;
        var py = (ly - r.top) / r.height;
        el.style.setProperty('--mx', (px * 100).toFixed(1) + '%');
        el.style.setProperty('--my', (py * 100).toFixed(1) + '%');
        if (tilt) {
          el.style.setProperty('--ry', ((px - 0.5) * max * 2).toFixed(2) + 'deg');
          el.style.setProperty('--rx', ((0.5 - py) * max * 2).toFixed(2) + 'deg');
        }
      }
      el.addEventListener('pointerenter', function () { el.style.setProperty('--spot', '1'); });
      el.addEventListener('pointermove', function (e) {
        lx = e.clientX; ly = e.clientY;
        if (!raf) raf = requestAnimationFrame(apply);
      });
      el.addEventListener('pointerleave', function () {
        el.style.setProperty('--spot', '0');
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* ------------------------------------------------------------------
     Indicador deslizante (comparativo + seletor de planos)
     ------------------------------------------------------------------ */
  function movePill(pill, btn) {
    if (!pill || !btn) return;
    pill.style.width = btn.offsetWidth + 'px';
    pill.style.transform = 'translateX(' + btn.offsetLeft + 'px)';
  }
  var pillGroups = [];
  function syncPills() {
    pillGroups.forEach(function (g) { movePill(g.pill, g.get()); });
  }
  window.addEventListener('resize', syncPills, { passive: true });

  /* ------------------------------------------------------------------
     Comparativo: contratar direto x Cuidare
     ------------------------------------------------------------------ */
  (function () {
    var group = $('.compare__switch');
    var stage = $('[data-compare-stage]');
    if (!group || !stage) return;
    var btns = $$('button', group);
    var pill = $('.compare__switch-pill', group);
    function set(which) {
      stage.setAttribute('data-active', which);
      btns.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-compare') === which)); });
      movePill(pill, $('[aria-pressed="true"]', group));
    }
    btns.forEach(function (b) { b.addEventListener('click', function () { set(b.getAttribute('data-compare')); }); });
    $$('.compare-card', stage).forEach(function (card) {
      card.addEventListener('click', function () { set(card.classList.contains('compare-card--direct') ? 'direct' : 'cuidare'); });
    });
    pillGroups.push({ pill: pill, get: function () { return $('[aria-pressed="true"]', group); } });
    set('cuidare');
  })();

  /* ------------------------------------------------------------------
     Diferenciais: carrossel em arco (arrastar, setas, teclado, trackpad)
     ------------------------------------------------------------------ */
  (function () {
    var root = $('[data-arc]');
    if (!root) return;
    var track = $('[data-arc-track]', root);
    var cards = $$('.arc-card', track);
    var n = cards.length;
    var cur = $('[data-arc-current]', root);
    $('[data-arc-total]', root).textContent = String(n);

    var pos = 0, step = 12, spacing = 320, range = 3;
    var prevOff = new Array(n);
    var mod = function (a) { return ((a % n) + n) % n; };

    cards.forEach(function (c, i) {
      c.setAttribute('aria-roledescription', 'slide');
      c.tabIndex = i === 0 ? 0 : -1;
    });

    function metrics() {
      var cs = getComputedStyle(root);
      var R = parseFloat(cs.getPropertyValue('--R')) || 1500;
      var w = cards[0].offsetWidth;
      spacing = w + Math.max(20, w * 0.1);
      step = (spacing / R) * 180 / Math.PI;
      range = Math.min(Math.ceil((window.innerWidth / 2) / spacing) + 0.5, n / 2 - 0.5);
    }

    function render() {
      var activeIdx = mod(Math.round(pos));
      cards.forEach(function (c, i) {
        var off = i - pos;
        off = ((off % n) + n) % n;
        if (off > n / 2) off -= n;
        if (prevOff[i] !== undefined && Math.abs(off - prevOff[i]) > n / 2) {
          c.style.transition = 'none';
          c.style.setProperty('--angle', (off * step).toFixed(3) + 'deg');
          void c.offsetWidth;
          c.style.transition = '';
        } else {
          c.style.setProperty('--angle', (off * step).toFixed(3) + 'deg');
        }
        prevOff[i] = off;
        c.classList.toggle('is-far', Math.abs(off) > range);
        c.classList.toggle('is-active', i === activeIdx);
        c.style.zIndex = String(100 - Math.round(Math.abs(off) * 10));
      });
      cur.textContent = String(activeIdx + 1);
    }

    function go(target, focus) {
      pos = target;
      render();
      var idx = mod(Math.round(pos));
      cards.forEach(function (c, i) { c.tabIndex = i === idx ? 0 : -1; });
      if (focus) cards[idx].focus({ preventScroll: true });
    }

    $('[data-arc-prev]', root).addEventListener('click', function () { go(Math.round(pos) - 1); });
    $('[data-arc-next]', root).addEventListener('click', function () { go(Math.round(pos) + 1); });

    root.addEventListener('keydown', function (e) {
      if (!e.target.classList.contains('arc-card')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(Math.round(pos) + 1, true); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(Math.round(pos) - 1, true); }
    });

    cards.forEach(function (c, i) {
      c.addEventListener('focus', function () {
        if (mod(Math.round(pos)) !== i) {
          var off = i - Math.round(pos);
          off = ((off % n) + n) % n; if (off > n / 2) off -= n;
          go(Math.round(pos) + off);
        }
      });
    });

    // Arrastar
    var startX = 0, startPos = 0, moved = false, down = false, pid = null;
    track.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      down = true; moved = false; startX = e.clientX; startPos = pos; pid = e.pointerId;
    });
    track.addEventListener('pointermove', function (e) {
      if (!down || e.pointerId !== pid) return;
      var dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 6) {
        moved = true;
        track.classList.add('is-dragging');
        try { track.setPointerCapture(pid); } catch (err) { /* noop */ }
      }
      if (moved) { pos = startPos - dx / spacing; render(); }
    });
    function end() {
      if (!down) return;
      down = false;
      track.classList.remove('is-dragging');
      if (moved) go(Math.round(pos));
    }
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
    track.addEventListener('click', function (e) {
      if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; return; }
      var card = e.target.closest('.arc-card');
      if (card) {
        var i = cards.indexOf(card);
        var off = i - Math.round(pos);
        off = ((off % n) + n) % n; if (off > n / 2) off -= n;
        if (off !== 0) go(Math.round(pos) + off);
      }
    }, true);

    // Trackpad horizontal
    var acc = 0, wheelLock = 0;
    track.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (Date.now() < wheelLock) return;
      acc += e.deltaX;
      if (Math.abs(acc) > 40) {
        go(Math.round(pos) + (acc > 0 ? 1 : -1));
        acc = 0; wheelLock = Date.now() + 380;
      }
    }, { passive: false });

    var rt;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { metrics(); render(); }, 120);
    }, { passive: true });

    metrics();
    render();
  })();

  /* ------------------------------------------------------------------
     Planos e preços — valores idênticos ao portfólio (sem cálculos)
     ------------------------------------------------------------------ */
  var PLAN_NAMES = { '24h': '+Cuidado 24H', '12h': '+Cuidado 12H', '8h': '+Cuidado 8H', '6h': '+Cuidado 6H' };
  var PLAN_DATA = {
    segseg: {
      label: 'Seg a seg',
      note: 'Seg a sex = 22 dias • Seg a sáb = 26 dias • Seg a seg = 30 dias • Orçamento válido por 5 dias.',
      plans: {
        '24h': { pre: '', price: 13497, meta: 'Seg a seg • 30 dias', extras: ['Seg a sex: R$ 9.997', 'Seg a sáb: R$ 11.997'] },
        '12h': { pre: '', price: 6900, meta: 'Diurno • Seg a seg • 30 dias', extras: ['Seg a sex: R$ 5.697', 'Seg a sáb: R$ 6.297', 'Noturno: R$ 5.997 / 6.597 / 6.997'] },
        '8h': { pre: '', price: 5897, meta: 'Seg a seg • 30 dias', extras: ['Seg a sex: R$ 4.697', 'Seg a sáb: R$ 5.197'] },
        '6h': { pre: '', price: 4997, meta: 'Seg a seg • 30 dias', extras: ['Seg a sex: R$ 3.997', 'Seg a sáb: R$ 4.497'] }
      }
    },
    segsab: {
      label: 'Seg a sáb',
      note: 'Orçamento válido por 5 dias.',
      plans: {
        '24h': { pre: 'Mensal por', price: 11997, meta: '26 dias', extras: [] },
        '12h': { pre: 'Diurno, mensal por', price: 6297, meta: '26 dias • Noturno: R$ 6.597', extras: [] },
        '8h': { pre: 'Mensal por', price: 5197, meta: '26 dias', extras: [] },
        '6h': { pre: 'Mensal por', price: 4497, meta: '26 dias', extras: [] }
      }
    },
    segsex: {
      label: 'Seg a sex',
      note: 'Orçamento válido por 5 dias.',
      plans: {
        '24h': { pre: 'Mensal por', price: 9997, meta: '22 dias', extras: [] },
        '12h': { pre: 'Diurno, mensal por', price: 5697, meta: '22 dias • Noturno: R$ 5.997', extras: [] },
        '8h': { pre: 'Mensal por', price: 4697, meta: '22 dias', extras: [] },
        '6h': { pre: 'Mensal por', price: 3997, meta: '22 dias', extras: [] }
      }
    },
    diaria: {
      label: 'Diária',
      note: 'Orçamento válido por 5 dias.',
      plans: {
        '24h': { pre: 'Diária por', price: 530, meta: '', extras: ['Fds/feriado: R$ 550'] },
        '12h': { pre: 'Diurno, diária por', price: 280, meta: '', extras: ['Fds/feriado: R$ 290', 'Noturno: R$ 290 (fds R$ 300)'] },
        '8h': { pre: 'Diária por', price: 250, meta: '', extras: ['Fds/feriado: R$ 260'] },
        '6h': { pre: 'Diária por', price: 227, meta: '', extras: ['Fds/feriado: R$ 237'] }
      }
    }
  };

  (function () {
    var seg = $('[data-segmented]');
    var grid = $('[data-plans-grid]');
    if (!seg || !grid) return;
    var tabs = $$('[role="tab"]', seg);
    var pill = $('.segmented__pill', seg);
    var panel = $('[data-plans-panel]');
    var note = $('[data-plans-note]');
    var live = $('[data-plans-live]');
    var cards = $$('.plan', grid);
    var mode = 'segseg';
    var tweens = new WeakMap();
    var swapTimer;

    function tween(el, to) {
      var from = parseInt(el.textContent.replace(/\D/g, ''), 10) || 0;
      if (tweens.has(el)) cancelAnimationFrame(tweens.get(el));
      if (reduce || from === to) { el.textContent = fmt(to); return; }
      var t0 = performance.now(), dur = 750;
      (function step(now) {
        var t = clamp((now - t0) / dur, 0, 1);
        el.textContent = fmt(Math.round(from + (to - from) * easeOutCubic(t)));
        if (t < 1) tweens.set(el, requestAnimationFrame(step));
        else { el.textContent = fmt(to); tweens.delete(el); }
      })(t0);
      el.classList.remove('is-bump'); void el.offsetWidth; el.classList.add('is-bump');
    }

    function applyText(data) {
      cards.forEach(function (card) {
        var d = data.plans[card.getAttribute('data-plan')];
        $('[data-f="pre"]', card).textContent = d.pre;
        $('[data-f="meta"]', card).textContent = d.meta;
        var ul = $('[data-f="extras"]', card);
        ul.textContent = '';
        d.extras.forEach(function (t) { var li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
      });
      note.textContent = data.note;
    }

    function updateCtas(data) {
      cards.forEach(function (card) {
        var name = PLAN_NAMES[card.getAttribute('data-plan')];
        var a = $('[data-plan-cta]', card);
        a.href = waLink('Olá! Gostaria de agendar uma avaliação gratuita. Tenho interesse no plano ' + name + ' (' + data.label + ').');
        a.setAttribute('aria-label', 'Avaliação gratuita — ' + name + ', ' + data.label + ' (abre o WhatsApp)');
      });
    }

    function select(next, focus) {
      var tab = $('[data-mode="' + next + '"]', seg);
      if (focus) tab.focus();
      if (next === mode) return;
      mode = next;
      var data = PLAN_DATA[mode];
      tabs.forEach(function (t) {
        var on = t === tab;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1;
      });
      panel.setAttribute('aria-labelledby', tab.id);
      movePill(pill, tab);

      cards.forEach(function (card) {
        tween($('[data-f="price"]', card), data.plans[card.getAttribute('data-plan')].price);
      });
      updateCtas(data);
      live.textContent = 'Mostrando valores: ' + data.label;

      clearTimeout(swapTimer);
      if (reduce) { applyText(data); return; }
      grid.classList.add('is-out');
      note.classList.add('is-out');
      swapTimer = setTimeout(function () {
        applyText(data);
        grid.classList.remove('is-out');
        note.classList.remove('is-out');
      }, 190);
    }

    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t.getAttribute('data-mode')); });
      t.addEventListener('keydown', function (e) {
        var j = null;
        if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
        if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
        if (e.key === 'Home') j = 0;
        if (e.key === 'End') j = tabs.length - 1;
        if (j !== null) { e.preventDefault(); select(tabs[j].getAttribute('data-mode'), true); }
      });
    });

    pillGroups.push({ pill: pill, get: function () { return $('[aria-selected="true"]', seg); } });
    movePill(pill, tabs[0]);
    updateCtas(PLAN_DATA[mode]);

    // Mobile: card em foco ganha profundidade + indicadores
    var dots = $$('[data-plans-dots] span');
    if ('IntersectionObserver' in window) {
      var cardObs = new IntersectionObserver(function (entries) {
        if (!mqMobile.matches) return;
        entries.forEach(function (e) {
          if (!e.isIntersecting) return;
          var i = cards.indexOf(e.target);
          cards.forEach(function (c, k) { c.classList.toggle('is-current', k === i); });
          dots.forEach(function (d, k) { d.classList.toggle('is-on', k === i); });
        });
      }, { root: grid, threshold: 0.7 });
      cards.forEach(function (c) { cardObs.observe(c); });
      mqMobile.addEventListener && mqMobile.addEventListener('change', function (m) {
        if (!m.matches) cards.forEach(function (c) { c.classList.remove('is-current'); });
      });
    }
  })();

  /* ------------------------------------------------------------------
     FAQ: filtros por tema + accordion
     ------------------------------------------------------------------ */
  (function () {
    var acc = $('[data-accordion]');
    if (!acc) return;
    var items = $$('.acc-item', acc);

    function setOpen(item, open) {
      item.classList.toggle('is-open', open);
      $('.acc-trigger', item).setAttribute('aria-expanded', String(open));
    }
    items.forEach(function (item) {
      $('.acc-trigger', item).addEventListener('click', function () {
        var open = !item.classList.contains('is-open');
        items.forEach(function (o) { if (o !== item) setOpen(o, false); });
        setOpen(item, open);
      });
    });
    setOpen(items[0], true);

    var chips = $$('[data-faq-chips] .chip');
    var leaveTimer;
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        var cat = chip.getAttribute('data-cat');
        chips.forEach(function (c) { c.setAttribute('aria-pressed', String(c === chip)); });
        clearTimeout(leaveTimer);
        var show = items.filter(function (it) { return cat === 'all' || it.getAttribute('data-cat') === cat; });
        var hide = items.filter(function (it) { return show.indexOf(it) === -1; });
        hide.forEach(function (it) { setOpen(it, false); if (!it.hidden) it.classList.add('is-leaving'); });
        leaveTimer = setTimeout(function () {
          hide.forEach(function (it) { it.hidden = true; it.classList.remove('is-leaving'); });
          show.forEach(function (it, k) {
            var wasHidden = it.hidden;
            it.hidden = false;
            if (wasHidden && !reduce) {
              it.style.setProperty('--d', String(Math.min(k, 6)));
              it.classList.remove('is-in'); void it.offsetWidth; it.classList.add('is-in');
            }
          });
          if (cat !== 'all' && show.length && !show.some(function (it) { return it.classList.contains('is-open'); })) setOpen(show[0], true);
        }, reduce ? 0 : 220);
      });
    });
  })();

  /* ------------------------------------------------------------------
     Hero 3D (WebGL) — carregado sob demanda, com fallback em CSS
     ------------------------------------------------------------------ */
  (function () {
    var canvas = $('[data-orb]');
    var hero = $('.hero');
    if (!canvas || lowPower || !window.WebGLRenderingContext) return;
    function load() {
      if (window.CuidareOrb) { start(); return; }
      var s = document.createElement('script');
      s.src = 'assets/js/orb.js';
      s.async = true;
      s.onload = start;
      document.head.appendChild(s);
    }
    function start() {
      if (!window.CuidareOrb) return;
      window.CuidareOrb.init(canvas, {
        reduce: reduce,
        mobile: !finePointer || window.innerWidth < 760,
        onReady: function () { hero.classList.add('is-webgl'); },
        onFail: function () { hero.classList.remove('is-webgl'); }
      });
      update();
    }
    if ('requestIdleCallback' in window) requestIdleCallback(load, { timeout: 900 });
    else setTimeout(load, 250);
  })();

  var year = $('[data-year]');
  if (year) year.textContent = String(new Date().getFullYear());
})();
