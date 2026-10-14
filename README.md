# Cuidare Vila Mariana — site

Experiência digital da Cuidare Vila Mariana em três páginas:

| Rota | Função |
| --- | --- |
| `/` | Home institucional: hero, indicadores, diferenciais, tipos de atendimento, depoimentos, como funciona, chamada final |
| `/experiencia/` | Jornada interativa em 7 etapas, com perguntas condicionais, resumo ao vivo e escultura 3D que responde às escolhas |
| `/avaliacao/` | Resumo editável, solicitação de avaliação (Netlify Forms), continuação pelo WhatsApp e confirmação |

Não há tabela pública de preços. As propostas são personalizadas pela equipe comercial.

## Identidade visual

Somente azul e branco, em todas as páginas, formulários, botões, cartões, progresso e na escultura 3D:

| Cor | Uso |
| --- | --- |
| `#082B59` azul-marinho | autoridade: cabeçalho, hero, rodapé, títulos |
| `#0757B8` azul institucional | botões, estados selecionados, navegação |
| `#1769E0` azul vivo | destaque sobre fundo escuro, foco, progresso |
| `#EAF3FF` azul-céu | superfícies de apoio (resumo, faixas, chips) |
| `#FFFFFF` branco | fundo principal |

As cores ficam como variáveis no topo de `assets/css/site.css` (`--navy`, `--blue`, `--vivid`, `--sky`, `--white`).
Logo: versão oficial branca sobre o azul-marinho (`assets/img/logo-white.png`).

## Estrutura

```
index.html, experiencia/, avaliacao/, 404.html
assets/css/site.css        sistema visual (mobile first)
assets/js/config.js        configuração pública (WhatsApp, formulários, análise, fotos)
assets/js/core.js          base comum: links, origem da visita, consentimento, privacidade, 3D
assets/js/jornada.js       perguntas, regras condicionais, prioridade e resumo
assets/js/experiencia.js   motor da experiência
assets/js/avaliacao.js     resumo, validação e envio
assets/js/orb.js           escultura em WebGL (sem bibliotecas), com versão leve em CSS
assets/fonts/              Newsreader + Manrope (SIL OFL), hospedadas localmente
netlify/functions/         referência de precificação no servidor (desativada por padrão)
_headers, _redirects, netlify.toml, robots.txt, sitemap.xml
docs/INTEGRACOES.md        integrações, pendências e checklist de publicação
```

Sem etapa de build e sem dependências de terceiros no navegador.

## Visualizar localmente

```
python3 -m http.server 8000
# abra http://localhost:8000
```

O envio do formulário só funciona publicado no Netlify, com o Forms ativo. Fora dele, o site mostra
erro e oferece o WhatsApp, sem simular sucesso.

## Publicar

Arraste a pasta do site (sem `docs/`) em *Netlify → Add new project → Deploy manually*, ou conecte o
repositório. Antes de trocar o domínio, siga `docs/INTEGRACOES.md`.
