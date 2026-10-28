# Cuidare Vila Mariana — consulta de valores

Experiência digital da Cuidare Vila Mariana em três páginas:

| Rota | Função |
| --- | --- |
| `/` | Capa com 3D, consulta rápida (atendimento e, na residência, duração e frequência), diferenciais e depoimentos |
| `/valor/` | Residência: **somente** o valor da configuração escolhida. Hospital e consultas: a tabela de valores por dia desse atendimento |
| `/detalhes/` | Resumo e detalhes do atendimento escolhido (cuidado e rotina, saúde e segurança, suporte, contratação, condições) |

Regra comercial: seleção antes do preço; a página inicial não mostra valores.

- **Cuidados em residência e acompanhamento hospitalar:** plano mensal (atendimento → duração → frequência), um valor por consulta. Hospital: 12h diurnas, 12h noturnas e 24h.
- **Atendimento por dia (antes “Consultas e exames”):** tocar no cartão já abre a **tabela de valores por
  dia** desse atendimento (durações nas linhas; segunda a sexta e sábados, domingos e feriados nas
  colunas), sem valores mensais: 6h, 8h, 12h diurno, 12h noturno e 24h.
- Tocar em uma opção já avança para a próxima etapa; não há botão “Continuar”, só “Voltar”.
- O atendimento pós-operatório foi retirado da consulta.

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
(`assets/img/logo-white.png`), proporção original. Títulos em Fredoka (arredondada, estilo animação),
textos em Manrope. Abertura animada com o logo na primeira página da visita, títulos entrando palavra
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
assets/fonts/              Fredoka (títulos) + Manrope (textos), SIL OFL, hospedadas localmente
assets/photos/             fotos da página do valor
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
