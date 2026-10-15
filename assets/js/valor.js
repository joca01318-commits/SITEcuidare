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
    return '<div class="pcard__cfg">' +
      '<span>' + ICON(s.icon || 'heart') + esc(K.labelOf('servico', a.servico)) + '</span>' +
      '<span>' + ICON('clock') + esc(K.labelOf('duracao', a.duracao)) + '</span>' +
      '<span>' + ICON('calendar') + esc(K.labelOf('frequencia', a.frequencia)) + '</span></div>';
  }

  var detailsUrl = C.pageUrl('detalhes') + '#detalhes';
  var changeUrl = C.pageUrl('', '?etapa=1&retorno=1') + '#consulta';

  function trust() {
    return '<ul class="price__trust">' +
      '<li><span class="ic">' + ICON('calendar') + '</span>Avaliação gratuita, com horário agendado</li>' +
      '<li><span class="ic">' + ICON('swap') + '</span>Se o cuidador faltar, a Cuidare envia outro profissional</li>' +
      '<li><span class="ic">' + ICON('doc') + '</span>Sem vínculo trabalhista para a família</li></ul>';
  }

  function render(r) {
    var ok = r.status === 'ok';
    var p = K.priceText(r, a);
    var head = '<div class="price__head">' +
      '<p class="eyebrow" data-intro style="--d:0">Seu atendimento selecionado</p>' +
      (ok ? '<h1 class="price__title" data-intro style="--d:1" tabindex="-1">Este é o valor do <em>seu atendimento.</em></h1>'
          : '<h1 class="price__title" data-intro style="--d:1" tabindex="-1">Seu atendimento pede uma <em>proposta personalizada.</em></h1>') + '</div>';
    var rest = '<div class="price__rest">' +
      (ok ? '<p class="price__lead" data-intro style="--d:2">Calculado a partir das suas escolhas. Abra os detalhes para ver o que está incluído e as condições da contratação.</p>'
          : '<p class="price__lead" data-intro style="--d:2">' + (REASON[r.motivo] || REASON.sem_preco) + '</p>') +
      '<div data-intro style="--d:3">' + trust() + '</div></div>';

    var card = ok
      ? '<a class="pcard is-in" href="' + detailsUrl + '" data-pcard>' +
          '<p class="pcard__k">Configuração escolhida</p>' + chips() +
          '<p class="pcard__label">Valor correspondente</p>' +
          '<p class="pcard__price"><span class="pcard__v" data-valor>' + esc(p.valor) + '</span><span class="pcard__u">' + esc(p.unidade) + '</span></p>' +
          '<p class="pcard__d">' + esc(p.detalhe) + '</p>' +
          '<p class="pcard__note">' + ICON('info') + '<span>Valor de tabela para esta configuração' + (r.validadeDias ? ', válido por ' + r.validadeDias + ' dias' : '') + '. A contratação é confirmada após a avaliação gratuita e a verificação de disponibilidade.</span></p>' +
          '<span class="pcard__more">Ver detalhes deste atendimento' + ICON('arrow') + '</span></a>'
      : '<div class="pcard pcard--custom is-in" data-pcard>' +
          '<p class="pcard__k">Configuração escolhida</p>' + chips() +
          '<p class="pcard__label">Valor</p>' +
          '<p class="pcard__price"><span class="pcard__v">Proposta personalizada</span></p>' +
          '<p class="pcard__note">' + ICON('info') + '<span>' + (REASON[r.motivo] || REASON.sem_preco) + '</span></p></div>';

    var actions = '<a class="btn btn--primary btn--lg" href="' + detailsUrl + '" data-track="ver_detalhes"><span>Ver detalhes deste atendimento</span><span class="btn__ico" aria-hidden="true">' + ICON('arrow') + '</span></a>';

    box.innerHTML = '<div class="price-grid">' + head +
      '<div class="price__side" data-intro style="--d:2">' + card +
      '<div class="price__actions">' + actions + '</div>' +
      '<a class="price__change" href="' + changeUrl + '">' + ICON('edit') + 'Alterar minhas escolhas</a></div>' + rest + '</div>';

    C.track('price_view', { status: r.status, duracao: a.duracao, frequencia: a.frequencia });
    if (scene) scene.pulse();
  }

  function empty() {
    var j = $('[data-jstep]');
    if (j) Array.prototype.forEach.call(j.children, function (li, i) { li.className = i === 0 ? 'is-current' : ''; });
    box.innerHTML = '<div class="price-empty">' +
      '<p class="eyebrow">Consulta de valores</p>' +
      '<h1 class="price__title" tabindex="-1">Primeiro, conte qual atendimento <em>você procura.</em></h1>' +
      '<p class="price__lead">O valor aparece aqui depois que você escolhe o tipo de atendimento, a duração e a frequência.</p>' +
      '<div class="price__actions"><a class="btn btn--primary btn--lg" href="' + C.pageUrl('') + '#consulta"><span>Começar a consulta</span><span class="btn__ico" aria-hidden="true">' + ICON('arrow') + '</span></a></div></div>';
  }

  // Cena 3D atrás do valor
  if (stage) {
    C.cena($('[data-cena]', stage), {
      particles: 70,
      objects: function (aspect, hw, hh) {
        if (aspect < 0.9) return [
          { shape: 'heart', x: hw * 0.7, y: hh * 0.78, z: -1, s: hh * 0.16, ry: -0.5, rz: 0.2 },
          { shape: 'sphere', x: -hw * 0.82, y: -hh * 0.4, z: 0, s: hh * 0.05 }
        ];
        return [
          { shape: 'heart', x: hw * 0.98, y: hh * 0.7, z: -2, s: hh * 0.24, ry: -0.6, rz: 0.2, depth: 0.6 },
          { shape: 'heart', x: -hw * 0.06, y: -hh * 0.72, z: -1, s: hh * 0.12, ry: 0.8, rz: -0.2, depth: 0.9 },
          { shape: 'sphere', x: -hw * 0.88, y: hh * 0.62, z: 0, s: hh * 0.06, depth: 1.2 },
          { shape: 'sphere', x: hw * 0.95, y: -hh * 0.75, z: 0.5, s: hh * 0.05, depth: 1.3 }
        ];
      },
      onReady: function () { stage.classList.add('is-3d'); },
      onFail: function () { stage.classList.remove('is-3d'); }
    }).then(function (inst) { scene = inst; if (scene) setTimeout(function () { scene.pulse(); }, 400); });
  }

  if (!a.servico || !a.duracao || !a.frequencia) { empty(); return; }
  K.obterPreco(a).then(render);
})();
