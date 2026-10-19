/* Cuidare — página 2: somente o valor da configuração escolhida. */
(function () {
  'use strict';
  var C = window.Cuidare, K = window.CuidareConsulta;
  if (!C || !K) return;
  var $ = C.$, esc = C.esc;
  var ICON = function (id) { return '<svg aria-hidden="true"><use href="#i-' + id + '"/></svg>'; };

  var box = $('[data-price]');
  var stage = $('[data-stage3d]');
  var a = K.load().a;
  var scene = null;

  var REASON = {
    duracao: 'Como a duração ainda não foi definida, a equipe monta a proposta junto com você.',
    sem_preco: 'Para esta combinação, o valor é confirmado diretamente pela equipe comercial.',
    servico: 'Para este tipo de atendimento, o valor é confirmado diretamente pela equipe comercial.',
    indisponivel: 'Não foi possível consultar o valor agora. A equipe envia a proposta para você.'
  };

  function chips() {
    var s = K.servico(a.servico) || {};
    if (K.porDiaria(a)) return '<div class="pcard__cfg">' +
      '<span>' + ICON(s.icon || 'heart') + esc(K.labelOf('servico', a.servico)) + '</span>' +
      '<span>' + ICON('calendar') + 'Valores por dia</span></div>';
    return '<div class="pcard__cfg">' +
      '<span>' + ICON(s.icon || 'heart') + esc(K.labelOf('servico', a.servico)) + '</span>' +
      '<span>' + ICON('clock') + esc(K.labelOf('duracao', a.duracao)) + '</span>' +
      '<span>' + ICON('calendar') + esc(K.labelOf('frequencia', a.frequencia)) + '</span></div>';
  }

  var detailsUrl = C.pageUrl('detalhes') + '#detalhes';
  var changeUrl = C.pageUrl('', '?etapa=1&retorno=1') + '#consulta';

  function trust() {
    return '<ul class="price__trust" data-stagger>' +
      '<li><span class="ic">' + ICON('shield') + '</span>Profissionais selecionados e verificados</li>' +
      '<li><span class="ic">' + ICON('swap') + '</span>Se o cuidador faltar, a Cuidare envia outro profissional</li>' +
      '<li><span class="ic">' + ICON('doc') + '</span>Sem vínculo trabalhista para a família</li></ul>';
  }

  function render(r) {
    var ok = r.status === 'ok';
    var p = K.priceText(r, a);
    var tabela = ok && p.tabela;
    var nome = K.labelOf('servico', a.servico);
    var head = '<div class="price__head">' +
      '<p class="eyebrow" data-intro style="--d:0">Seu atendimento selecionado</p>' +
      (tabela ? '<h1 class="price__title" data-intro data-split style="--d:1" tabindex="-1">Tabela de valores <em>por dia.</em></h1>'
        : ok ? '<h1 class="price__title" data-intro data-split style="--d:1" tabindex="-1">Este é o valor do <em>seu atendimento.</em></h1>'
          : '<h1 class="price__title" data-intro data-split style="--d:1" tabindex="-1">Seu atendimento pede uma <em>proposta personalizada.</em></h1>') + '</div>';
    var rest = '<div class="price__rest">' +
      (tabela ? '<p class="price__lead" data-intro style="--d:2">Os valores mudam conforme a duração ' + (a.servico === 'hospital' ? 'do plantão' : 'do atendimento') + ' e o dia da semana. Abra os detalhes para ver o que está incluído e as condições da contratação.</p>'
        : ok ? '<p class="price__lead" data-intro style="--d:2">Calculado a partir das suas escolhas. Abra os detalhes para ver o que está incluído e as condições da contratação.</p>'
          : '<p class="price__lead" data-intro style="--d:2">' + (REASON[r.motivo] || REASON.sem_preco) + '</p>') +
      '<div data-intro style="--d:3">' + trust() + '</div></div>';

    var card = tabela
      ? '<div class="pcard pcard--tabela is-in" data-pcard data-tilt>' +
          '<p class="pcard__k">Tabela de valores por dia</p>' + chips() +
          C.tabelaDiarias(p, nome) +
          '<p class="pcard__note">' + ICON('info') + '<span>Valores de tabela por dia de atendimento' + (r.validadeDias ? '. Orçamento válido por ' + r.validadeDias + ' dias' : '') + '.</span></p></div>'
      : ok
      ? '<a class="pcard is-in" href="' + detailsUrl + '" data-pcard>' +
          '<p class="pcard__k">Configuração escolhida</p>' + chips() +
          '<p class="pcard__label">Valor correspondente</p>' +
          '<p class="pcard__price"><span class="pcard__v" data-valor>' + esc(p.valor) + '</span><span class="pcard__u">' + esc(p.unidade) + '</span></p>' +
          '<p class="pcard__d">' + esc(p.detalhe) + '</p>' +
          (p.fds ? '<p class="pcard__alt"><span class="pcard__alt-l">' + esc(p.fds.label) + '</span><span class="pcard__alt-v">' + esc(p.fds.valor) + ' <small>' + esc(p.fds.unidade) + '</small></span></p>' : '') +
          '<p class="pcard__note">' + ICON('info') + '<span>Valor de tabela para esta configuração' + (r.validadeDias ? '. Orçamento válido por ' + r.validadeDias + ' dias' : '') + '.</span></p>' +
          '<span class="pcard__more">Ver detalhes deste atendimento' + ICON('arrow') + '</span></a>'
      : '<div class="pcard pcard--custom is-in" data-pcard>' +
          '<p class="pcard__k">Configuração escolhida</p>' + chips() +
          '<p class="pcard__label">Valor</p>' +
          '<p class="pcard__price"><span class="pcard__v">Proposta personalizada</span></p>' +
          '<p class="pcard__note">' + ICON('info') + '<span>' + (REASON[r.motivo] || REASON.sem_preco) + '</span></p></div>';

    var actions = '<a class="btn btn--primary btn--lg" href="' + detailsUrl + '" data-track="ver_detalhes"><span>Ver detalhes deste atendimento</span><span class="btn__ico" aria-hidden="true">' + ICON('arrow') + '</span></a>';

    var F = C.cfg.fotosValor || {};
    var photo = F.principal ? '<figure class="price__photo" data-intro style="--d:3">' +
      '<span class="price__ph price__ph--main"><img src="' + C.asset(F.principal) + '" alt="Cuidadora sorrindo para uma senhora" width="724" height="808" decoding="async"></span>' +
      (F.apoio ? '<span class="price__ph price__ph--sub"><img src="' + C.asset(F.apoio) + '" alt="" width="448" height="404" decoding="async"></span>' : '') +
      '<span class="badge price__badge"><span class="badge__i">' + ICON('heart') + '</span>Cuidare, cuidado de verdade</span></figure>' : '';

    box.innerHTML = '<div class="price-grid' + (photo ? ' has-photo' : '') + (tabela ? ' is-tabela' : '') + '">' + head +
      '<div class="price__side" data-intro style="--d:2">' + card +
      '<div class="price__actions">' + actions + '</div>' +
      '<a class="price__change" href="' + changeUrl + '">' + ICON('edit') + 'Alterar minhas escolhas</a></div>' + rest + photo + '</div>';

    C.reveal(box);
    if (tabela) tilt($('[data-tilt]', box));
    C.track('price_view', { status: r.status, servico: a.servico, duracao: a.duracao || 'tabela', frequencia: a.frequencia || 'diaria' });
    if (scene) scene.pulse();
  }

  // Inclinação 3D da tabela acompanhando o ponteiro (só mouse/caneta, sem "reduzir movimento").
  function tilt(el) {
    if (!el || C.reduce || !C.finePointer) return;
    var raf = 0, rx = 0, ry = 0;
    var apply = function () { raf = 0; el.style.setProperty('--rx', rx.toFixed(2) + 'deg'); el.style.setProperty('--ry', ry.toFixed(2) + 'deg'); };
    el.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      var b = el.getBoundingClientRect();
      ry = ((e.clientX - b.left) / b.width - 0.5) * 7;
      rx = -((e.clientY - b.top) / b.height - 0.5) * 6;
      if (!raf) raf = requestAnimationFrame(apply);
    });
    el.addEventListener('pointerleave', function () { rx = 0; ry = 0; if (!raf) raf = requestAnimationFrame(apply); });
  }

  function empty() {
    var j = $('[data-jstep]');
    if (j) Array.prototype.forEach.call(j.children, function (li, i) { li.className = i === 0 ? 'is-current' : ''; });
    box.innerHTML = '<div class="price-empty">' +
      '<p class="eyebrow">Consulta de valores</p>' +
      '<h1 class="price__title" tabindex="-1">Primeiro, conte qual atendimento <em>você procura.</em></h1>' +
      '<p class="price__lead">O valor aparece aqui depois que você escolhe o tipo de atendimento.</p>' +
      '<div class="price__actions"><a class="btn btn--primary btn--lg" href="' + C.pageUrl('') + '#consulta"><span>Começar a consulta</span><span class="btn__ico" aria-hidden="true">' + ICON('arrow') + '</span></a></div></div>';
  }

  // Cena 3D atrás do valor
  if (stage) {
    C.cena($('[data-cena]', stage), {
      delay: C.intro ? 650 : 0,
      particles: 70,
      objects: function (aspect, hw, hh) {
        if (aspect < 0.9) return [
          { shape: 'heart', x: hw * 0.7, y: hh * 0.78, z: -1, s: hh * 0.16, ry: -0.5, rz: 0.2 },
          { shape: 'sphere', x: -hw * 0.82, y: -hh * 0.4, z: 0, s: hh * 0.05 }
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
  var labels = K.journeyLabels(a);
  C.journey(labels, labels.length - 2);
  K.obterPreco(a).then(render);
})();
