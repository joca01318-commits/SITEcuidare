# Cuidare Vila Mariana — site

Site institucional da Cuidare Vila Mariana, construído a partir do portfólio "Planos — Apresentação"
(conteúdo, números, FAQ e tabela de preços preservados sem alteração).

## Estrutura

```
index.html              página única (semântica, SEO, JSON-LD LocalBusiness + FAQPage)
assets/css/styles.css   sistema visual (tokens, componentes, animações, responsivo)
assets/js/main.js       interações (sem dependências)
assets/js/orb.js        esfera 3D do hero em WebGL puro (carregada sob demanda)
assets/fonts/           Lexend variável, hospedada localmente (SIL OFL)
assets/img/             logos (extraídos do portfólio), favicon, imagem de compartilhamento
```

Não há etapa de build: basta publicar a pasta inteira (ex.: arrastar para o Netlify Drop).

## Experiência

| Seção | Interação |
| --- | --- |
| Hero | entrada cinematográfica, esfera orgânica 3D que reage ao mouse e ao scroll, moldura que se recolhe ao rolar |
| Números | contadores animados (valor final idêntico ao original), cards com tilt e iluminação |
| Comparativo | alternância "Contratando diretamente" × "Com a Cuidare" |
| Diferenciais | carrossel em arco (arrastar, setas, teclado, trackpad) |
| Atendimento | tiles com profundidade e microinterações |
| Planos | seletor Seg a seg / Seg a sáb / Seg a sex / Diária com transição dos valores; +Cuidado 24H em destaque |
| FAQ | filtros por tema + accordion com abertura suave |
| CTA | WhatsApp (11) 91634-9800 com mensagem pré-preenchida por plano |

## Performance e acessibilidade

- Sem bibliotecas externas; ~220 KB no total (fonte + logos + CSS + JS).
- WebGL pausa fora da tela, reduz a resolução em aparelhos lentos e cai para um fallback em CSS
  quando o dispositivo é fraco, está em modo economia de dados ou não suporta WebGL.
- `prefers-reduced-motion`: animações decorativas desligadas e esfera renderizada como quadro estático.
- Tilt, botões magnéticos e spotlight só em dispositivos com mouse.
- Navegação por teclado (setas no carrossel e no seletor), foco visível, `aria-*` nos componentes,
  conteúdo legível sem JavaScript.

## Preços

Os valores ficam em `PLAN_DATA` (`assets/js/main.js`) e o estado inicial (Seg a seg) também está
no HTML. Ao alterar um preço, atualize os dois lugares.
