# Cuidare Vila Mariana — consulta de valores

Experiência digital da Cuidare Vila Mariana em três páginas:

| Rota | Função |
| --- | --- |
| `/` | Capa com 3D, os dois planos, Quem Somos e depoimentos |
| `/valor/` | Tabela de valores do plano escolhido, com abas para trocar de plano |
| `/detalhes/` | Resumo e detalhes do atendimento escolhido (cuidado e rotina, saúde e segurança, suporte, contratação, condições) |

Dois planos, cada um com a tabela completa de valores:

- **Planos Mensais:** durações × segunda a sexta / segunda a sábado / todos os dias.
- **Planos Diários:** durações × segunda a sexta / sábados, domingos e feriados.
- Tocar em um plano abre a tabela; na tabela, as abas trocam de plano. Sem etapas e sem “Continuar”.

É uma apresentação de valores para quem **já está em conversa** com a equipe e já passou pela avaliação:
o site não tem formulário, telefone, botões de WhatsApp, etapa de bairro/início/necessidades nem
referências a avaliação ou agendamento.

## Identidade visual

Fundo escuro predominante, somente azul e branco:

| Cor | Uso |
| --- | --- |
| `#061A35` azul-marinho profundo | fundo, autoridade |
| `#0757B8` azul institucional | estados concluídos, superfícies, profundidade |
| `#1769FF` azul elétrico | botões, seleção, brilhos, progresso |
| `#DCEBFF` azul-claro | textos de apoio, reflexos, ícones |
| `#FFFFFF` branco | textos principais |

As cores ficam como variáveis no topo de `assets/css/site.css`. Logo: versão oficial branca
(`assets/img/logo-white.png`), proporção original. Títulos em Baloo 2 (arredondada, estilo animação),
textos em Nunito. Abertura animada com o logo na primeira página da visita, títulos entrando palavra
por palavra e módulos em cascata (tudo desligado com “reduzir movimento” no aparelho).

## Estrutura

```
index.html, valor/, detalhes/, 404.html
assets/css/site.css        sistema visual (mobile first)
assets/js/config.js        configuração pública (preços, medição, fotos)
assets/js/precos.js        tabela de preços (fonte única, modo local)
assets/js/consulta.js      opções, perguntas condicionais, cálculo e resumo
assets/js/core.js          base comum: links, origem da visita, consentimento, privacidade, 3D
assets/js/cena.js          cena 3D em WebGL (corações e esferas de vidro), sem bibliotecas
assets/js/home.js          capa e consulta (avança ao tocar na opção)
assets/js/valor.js         página do valor
assets/js/detalhes.js      resumo e detalhes do atendimento
assets/fonts/              Baloo 2 (títulos) + Nunito (textos), SIL OFL, hospedadas localmente
assets/photos/             ilustrações dos dois planos
netlify/functions/preco.mjs  cálculo no servidor (modo opcional)
tools/gerar-html-unico.py  gera o site inteiro em um arquivo (dist/)
_headers, _redirects, netlify.toml, robots.txt, sitemap.xml
docs/INTEGRACOES.md        preços, integrações, pendências e checklist de publicação
```

Sem etapa de build e sem dependências de terceiros no navegador.

## Visualizar localmente

```
python3 -m http.server 8000
# abra http://localhost:8000
```

## Arquivo único

`python3 tools/gerar-html-unico.py` gera `dist/cuidare-vila-mariana.html`: as 3 páginas em um só arquivo,
com CSS, fontes, logo e scripts embutidos (as páginas viram `?pagina=valor` e `?pagina=detalhes`).
Abre com duplo clique, sem internet. Para hospedar, prefira a versão em pastas.

## Publicar

Arraste a pasta do site (sem `docs/` e `tools/`) em *Netlify → Add new project → Deploy manually*,
ou conecte o repositório. Antes de trocar o domínio, siga `docs/INTEGRACOES.md`.
