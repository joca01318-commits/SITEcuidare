/* Cuidare — página 2: a tabela de valores do plano escolhido (Planos Mensais ou Planos Diários). */
(function () {
  'use strict';
  var C = window.Cuidare, K = window.CuidareConsulta;
  if (!C || !K) return;
  var $ = C.$, esc = C.esc;
  var ICON = function (id) { return '<svg aria-hidden="true"><use href="#i-' + id + '"/></svg>'; };

  var box = $('[data-price]');
  var stage = $('[data-stage3d]');
  var state = K.load();
  var a = state.a;
  var scene = null, first = true;

  var REASON = {
    sem_preco: 'Para este plano, os valores são confirmados diretamente pela equipe comercial.',
    servico: 'Para este plano, os valores são confirmados diretamente pela equipe comercial.',
    indisponivel: 'Não foi possível consultar os valores agora. A equipe envia a proposta para você.'
  };

  var detailsUrl = function () { return C.pageUrl('detalhes') + '#detalhes'; };
  var plansUrl = C.pageUrl('') + '#consulta';

  function trust() {
    return '<ul class="price__trust" data-stagger>' +
      '<li><span class="ic">' + ICON('shield') + '</span>Profissionais selecionados e verificados</li>' +
      '<li><span class="ic">' + ICON('swap') + '</span>Se o cuidador faltar, a Cuidare envia outro profissional</li>' +
      '<li><span class="ic">' + ICON('doc') + '</span>Sem vínculo trabalhista para a família</li></ul>';
  }

  // Alternar entre os dois planos sem sair da página.
  function tabs() {
    return '<div class="ptabs" role="tablist" aria-label="Planos">' + K.SERVICOS.map(function (s) {
      var on = s.v === a.servico;
      return '<button type="button" class="ptabs__b' + (on ? ' is-on' : '') + '" role="tab" aria-selected="' + on + '" data-plano="' + s.v + '">' + ICON(s.icon) + esc(s.t) + '</button>';
    }).join('') + '<span class="ptabs__pill" aria-hidden="true"></span></div>';
  }

  function render(r) {
    var ok = r.status === 'ok';
    var p = K.priceText(r, a);
    var s = K.servico(a.servico) || {};
    var mensal = s.modalidade === 'mensal';
    var head = '<div class="price__head">' +
      '<p class="eyebrow"' + (first ? ' data-intro style="--d:0"' : '') + '>' + esc(s.t || 'Planos') + '</p>' +
      '<h1 class="price__title"' + (first ? ' data-intro data-split style="--d:1"' : '') + ' tabindex="-1">Tabela de valores <em>' + (mensal ? 'por mês.' : 'por dia.') + '</em></h1></div>';
    var rest = '<div class="price__rest">' +
      '<p class="price__lead"' + (first ? ' data-intro style="--d:2"' : '') + '>' + (ok
        ? (mensal ? 'Valores mensais conforme a duração do plantão e os dias da semana. ' : 'Valores por dia conforme a duração e o dia da semana. ') + 'Abra os detalhes para ver o que está incluído e as condições da contratação.'
        : (REASON[r.motivo] || REASON.sem_preco)) + '</p>' +
      '<div' + (first ? ' data-intro style="--d:3"' : '') + '>' + trust() + '</div></div>';

    var card = '<div class="pcard pcard--tabela is-in" data-pcard data-tilt="3">' +
      '<span class="pcard__glare" aria-hidden="true"></span>' + tabs() +
      (ok ? C.tabela(p, s.t)
        : '<p class="pcard__label">Valores</p><p class="pcard__price"><span class="pcard__v pcard__v--sm">Proposta personalizada</span></p>') +
      '<p class="pcard__note">' + ICON('info') + '<span>' + (ok ? 'Valores de tabela ' + esc(p.unidade) + (r.validadeDias ? '. Orçamento válido por ' + r.validadeDias + ' dias' : '') + '.' : esc(REASON[r.motivo] || REASON.sem_preco)) + '</span></p></div>';

    var actions = '<a class="btn btn--primary btn--lg" href="' + detailsUrl() + '" data-track="ver_detalhes"><span>Ver detalhes do plano</span><span class="btn__ico" aria-hidden="true">' + ICON('arrow') + '</span></a>';

    var img = (C.cfg.photos || {})[a.servico];
    var photo = img ? '<figure class="price__art"' + (first ? ' data-intro style="--d:3"' : '') + '><span class="price__art-in" data-tilt="10"><img src="' + C.asset(img) + '" alt="" width="803" height="792" decoding="async"><span class="price__art-glare" aria-hidden="true"></span></span>' +
      '<span class="badge price__badge"><span class="badge__i">' + ICON('heart') + '</span>Cuidare, cuidado de verdade</span></figure>' : '';

    box.innerHTML = '<div class="price-grid is-tabela' + (photo ? ' has-photo' : '') + '">' + head +
      '<div class="price__side"' + (first ? ' data-intro style="--d:2"' : '') + '>' + card +
      '<div class="price__actions">' + actions + '</div>' +
      '<a class="price__change" href="' + plansUrl + '">' + ICON('edit') + 'Voltar aos planos</a></div>' + rest + photo + '</div>';

    C.reveal(box); C.deco(box);
    C.tilt(box);
    document.title = (s.t ? s.t + ' — valores' : 'Valores') + ' · Cuidare Vila Mariana';
    C.track('price_view', { status: r.status, servico: a.servico });
    if (scene) scene.pulse();
    first = false;
  }

  // Troca de plano pelas abas: salva a escolha e redesenha a tabela com a entrada 3D.
  box.addEventListener('click', function (e) {
    var b = e.target.closest('[data-plano]');
    if (!b || b.getAttribute('data-plano') === a.servico) return;
    a = K.sanitize({ servico: b.getAttribute('data-plano') });
    state.a = a; K.save(state);
    K.obterPreco(a).then(function (r) { render(r); var on = $('[data-plano].is-on', box); if (on) on.focus({ preventScroll: true }); });
  });

  function empty() {
    var j = $('[data-jstep]');
    if (j) Array.prototype.forEach.call(j.children, function (li, i) { li.className = i === 0 ? 'is-current' : ''; });
    box.innerHTML = '<div class="price-empty">' +
      '<p class="eyebrow">Planos / Investimentos</p>' +
      '<h1 class="price__title" tabindex="-1">Primeiro, escolha <em>um plano.</em></h1>' +
      '<p class="price__lead">A tabela de valores aparece aqui depois que você escolhe entre os Planos Mensais e os Planos Diários.</p>' +
      '<div class="price__actions"><a class="btn btn--primary btn--lg" href="' + plansUrl + '"><span>Ver os planos</span><span class="btn__ico" aria-hidden="true">' + ICON('arrow') + '</span></a></div></div>';
  }

  // Cena 3D atrás da tabela
  if (stage) {
    C.cena($('[data-cena]', stage), {
      delay: C.intro ? 650 : 0,
      particles: 70,
      objects: function (aspect, hw, hh) {
        if (aspect < 0.9) return [
          { shape: 'heart', x: hw * 0.7, y: hh * 0.78, z: -1, s: hh * 0.16, ry: -0.5, rz: 0.2 },
          { shape: 'sphere', x: -hw * 0.82, y: -hh * 0.4, z: 0, s: hh * 0.05 },
          { shape: 'heart', x: -hw * 0.75, y: hh * 0.2, z: -2, s: hh * 0.07, ry: 0.6, rz: -0.2 }
        ];
        return [
          { shape: 'heart', x: hw * 0.9, y: hh * 0.86, z: -2, s: hh * 0.14, ry: -0.6, rz: 0.2, depth: 0.6 },
          { shape: 'heart', x: -hw * 0.94, y: -hh * 0.8, z: -1, s: hh * 0.12, ry: 0.8, rz: -0.2, depth: 0.9 },
          { shape: 'sphere', x: -hw * 0.25, y: hh * 0.9, z: 0, s: hh * 0.04, depth: 1.2 },
          { shape: 'sphere', x: hw * 0.97, y: -hh * 0.82, z: 0.5, s: hh * 0.05, depth: 1.3 }
        ];
      },
      onReady: function () { stage.classList.add('is-3d'); },
      onFail: function () { stage.classList.remove('is-3d'); }
    }).then(function (inst) { scene = inst; if (scene) setTimeout(function () { scene.pulse(); }, 400); });
  }

  if (!K.isComplete(a)) { empty(); return; }
  C.journey(K.journeyLabels(a), 1);
  K.obterPreco(a).then(render);
})();
