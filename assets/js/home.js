/* Cuidare — página inicial */
(function () {
  'use strict';
  var C = window.Cuidare; if (!C) return;
  var $ = C.$, $$ = C.$$;

  /* Escultura 3D do palco azul-marinho */
  var sculpt = $('[data-hero-sculpture]');
  var heroOrb = null;
  if (sculpt && !(C.cfg.photos && C.cfg.photos.hero)) {
    C.orb($('[data-orb]', sculpt), {
      satellites: 3,
      palette: { deep: '#0757B8', mid: '#1769E0', rim: '#EAF3FF', spec: '#FFFFFF', particle: '#EAF3FF' },
      layout: function (aspect, hw, hh) { return { x: 0, y: 0, s: Math.min(hw, hh) * 0.5, a: 1 }; },
      onReady: function () { sculpt.classList.add('is-3d'); },
      onFail: function () { sculpt.classList.remove('is-3d'); }
    }).then(function (inst) { heroOrb = inst; });
  }
  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      if (heroOrb) heroOrb.setScroll(Math.min(1, (window.scrollY || 0) / (window.innerHeight * 0.9)));
      journey();
    });
  }, { passive: true });

  /* Contadores (valor final idêntico ao texto original) */
  var fmt = function (n, d) { return n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }); };
  var counters = $$('[data-count]');
  if (!C.reduce && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        var el = e.target, original = el.textContent, target = parseFloat(el.getAttribute('data-count'));
        var dec = parseInt(el.getAttribute('data-decimals') || '0', 10), t0 = performance.now(), dur = 1600;
        (function step(now) {
          var t = Math.min(1, (now - t0) / dur), k = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
          el.textContent = t < 1 ? fmt(target * k, dec) : original;
          if (t < 1) requestAnimationFrame(step);
        })(t0);
      });
    }, { threshold: 0.5 });
    counters.forEach(function (c) { io.observe(c); });
  }

  /* Depoimentos */
  (function () {
    var stage = $('[data-tst]'); if (!stage) return;
    var items = $$('.tst__item', stage), cur = $('[data-tst-cur]'), i = 0;
    function go(n) {
      i = (n + items.length) % items.length;
      items.forEach(function (it, k) {
        var on = k === i;
        it.classList.toggle('is-active', on);
        it.setAttribute('aria-hidden', on ? 'false' : 'true');
      });
      cur.textContent = (i < 9 ? '0' : '') + (i + 1);
    }
    $('[data-tst-prev]').addEventListener('click', function () { go(i - 1); });
    $('[data-tst-next]').addEventListener('click', function () { go(i + 1); });
    var x0 = null;
    stage.addEventListener('pointerdown', function (e) { x0 = e.clientX; });
    stage.addEventListener('pointerup', function (e) {
      if (x0 === null) return; var dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1));
    });
    go(0);
  })();

  /* Linha da jornada acompanha a rolagem */
  var steps = $('[data-steps]'), lis = steps ? $$('li', steps) : [];
  function journey() {
    if (!steps) return;
    var r = steps.getBoundingClientRect(), vh = window.innerHeight;
    var p = Math.max(0, Math.min(1, (vh * 0.6 - r.top) / r.height));
    steps.style.setProperty('--prog', p.toFixed(3));
    lis.forEach(function (li) { li.classList.toggle('is-on', li.getBoundingClientRect().top < vh * 0.6); });
  }
  journey();
})();
