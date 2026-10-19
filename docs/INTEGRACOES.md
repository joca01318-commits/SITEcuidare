# Cuidare Vila Mariana — preços, integrações e pendências

Este documento separa o que **já funciona**, o que **depende de contas ou confirmação** da Cuidare e o
que **precisa de validação** antes da publicação definitiva. Nenhuma integração foi simulada.

Configuração pública: `assets/js/config.js`. Preços: `assets/js/precos.js`.

**Uso:** apresentação de valores enviada a quem **já está em conversa** com a equipe. Por decisão da
Cuidare, o site não tem formulário, número de telefone nem botões ou links de WhatsApp, e não registra
dados pessoais.

---

## 1. Publicação e validação (sem derrubar o site atual)

1. Publique esta versão em um **projeto Netlify novo** (ex.: `cuidare-vm-consulta`), arrastando a pasta
   do `.zip` em *Add new project → Deploy manually*. O site atual continua no ar.
2. Valide no celular e no computador o checklist da seção 10.
3. Só então aponte o domínio definitivo para o projeto novo (*Domain management*).
4. Ao definir o domínio, atualize `siteUrl` em `config.js` e os endereços em `index.html`
   (`canonical`, `og:url`, `og:image`, dados estruturados), `robots.txt` e `sitemap.xml`.

Endereços do site anterior continuam funcionando (`_redirects`): `/experiencia/` leva à consulta e
`/avaliacao/` leva aos detalhes.

## 2. Regra comercial

- A página inicial **não mostra preços**. Tocar em uma opção já avança; só existe “Voltar”.
- **Cuidados em residência:** o visitante escolhe duração e frequência, e a página `/valor/` mostra
  **somente** o valor mensal dessa combinação (sem tabela nem comparação). A página `/detalhes/` repete
  apenas esse valor.
- **Acompanhamento hospitalar e consultas e exames:** tocar no cartão leva direto à **tabela de valores
  por dia** desse atendimento, sem outras etapas e sem valores mensais. Linhas: as durações, com ícone de
  dia, noite ou 24 horas. Colunas: segunda a sexta e sábados, domingos e feriados. A página `/detalhes/`
  repete a mesma tabela.
  - Hospital (“Plantão”): 12 horas diurno, 12 horas noturno e 24 horas.
  - Consultas e exames (“Duração do atendimento”): 6 horas, 8 horas, 12 horas diurno, 12 horas noturno e 24 horas.
- O atendimento **pós-operatório foi retirado** (cartão, foto, textos e opções). Uma consulta antiga salva
  com ele é descartada e o visitante escolhe de novo.
- Sem valor validado para a combinação, o site **não inventa**: mostra “Proposta personalizada” e leva à
  solicitação.
- Testado automaticamente: as 18 combinações da residência (15 com valor, 3 com proposta personalizada)
  e as tabelas de hospital e consultas.

## 3. Tabela de preços (`assets/js/precos.js`)

Valores do PDF **“Proposta Personalizada de Cuidados”** (Orçamento de serviço de cuidadores de pessoas,
valores 2026), enviado pela Cuidare em 19/10/2026:

| Plano | Segunda a sexta (22 plantões) | Segunda a sábado (26 plantões) | Segunda a segunda (30 plantões) | Diária de segunda a sexta | Diária em sábado, domingo ou feriado |
| --- | --- | --- | --- | --- | --- |
| 6 horas | R$ 4.767 · 1 profissional | R$ 5.637 · 2 profissionais | R$ 6.507 · 2 profissionais | R$ 237 | R$ 247 |
| 8 horas | R$ 5.137 · 1 profissional | R$ 6.067 · 2 profissionais | R$ 7.007 · 2 profissionais | R$ 257 | R$ 267 |
| 12 horas diurno | R$ 5.867 · 2 profissionais | R$ 6.937 · 2 profissionais | R$ 8.007 · 2 profissionais | R$ 297 | R$ 307 |
| 12 horas noturno | R$ 6.057 · 2 profissionais | R$ 7.157 · 2 profissionais | R$ 8.257 · 2 profissionais | R$ 307 | R$ 317 |
| 24 horas | R$ 10.837 · 2 profissionais | R$ 12.807 · 3 profissionais | R$ 14.777 · 4 profissionais | R$ 587 | R$ 597 |

- Orçamento válido por 5 dias.
- **Residência:** usa só os planos mensais (colunas de 22, 26 e 30 plantões). “Ainda não sei” (duração)
  leva à proposta personalizada.
- **Acompanhamento hospitalar e consultas e exames:** usam só as diárias (duas últimas colunas), na tabela
  por dia descrita na seção 2. As antigas opções “Diária avulsa” e “Diária no fim de semana ou feriado”
  foram retiradas.
- Uma duração sem valor validado não aparece na tabela; sem valor de fim de semana, a célula mostra
  “Sob consulta”.
- Conferido automaticamente: todos os valores do site batem com o PDF e com a proposta comercial.

**Para confirmar:**

| Item | Situação |
| --- | --- |
| Tabela por tipo de atendimento | Residência usa os planos mensais; hospital e consultas usam as diárias da proposta comercial geral de cuidadores. **Confirme que essas diárias valem para o acompanhamento hospitalar e para consultas e exames.** Se algum tipo tiver valor diferente, avise. |
| Plano de 24 horas | Incluído porque está no PDF (o briefing anterior pedia para não oferecer 24 horas). Para tirar, apague a linha `'24h'` de `precos.js` e a opção em `consulta.js → DURACOES`. |
| Camada oculta do PDF | O arquivo tem, por baixo das tabelas, um texto antigo com outros valores (ex.: 6h por R$ 4.637). O site usa os valores visíveis nas páginas. |

Para alterar um valor: edite `precos.js`, mantendo os números sem ponto (ex.: `5867`).

## 4. Preços fora do navegador (modo servidor, opcional)

No modo local (padrão), a tabela fica em `precos.js`, que é público. Os mesmos valores já eram públicos
no site anterior; a página continua mostrando um único valor por consulta. Se a tabela não deve ficar no
código do navegador:

1. Publique por **Git ou Netlify CLI** (publicações por arrastar não incluem funções).
2. Em *Project configuration → Environment variables*, crie `CUIDARE_PRECOS` com o conteúdo de
   `window.CUIDARE_PRECOS` em JSON.
3. Em `config.js`: `precos.modo = 'servidor'`.
4. Apague `assets/js/precos.js` e as linhas `<script src=".../precos.js">` das três páginas.

A função `netlify/functions/preco.mjs` (`/api/preco`) devolve **apenas** o valor da combinação pedida
(para hospital e consultas, as linhas da tabela por dia; só o atendimento é pedido).
Se ela falhar, o site mostra proposta personalizada, sem inventar valor.

## 5. Medição (depende de conta)

Nada é carregado enquanto `analytics.gtmId` estiver vazio. Com o GTM preenchido, o site pede
consentimento e só então envia eventos `cuidare_*`: `cta_click`, `step_complete` (só duração e
frequência), `consulta_complete`, `price_view` e `details_view`.

**Nunca são enviados:** dados pessoais (o site não pede nenhum).

## 6. Fotos

**Página do valor:** usa duas fotos recortadas das imagens de referência enviadas pela Cuidare
(`assets/photos/cuidado-principal.webp` e `cuidado-apoio.webp`), sem os selos embutidos e sem o logo de
coração dos uniformes. Atenção: essas imagens parecem geradas por IA e têm resolução baixa (foram
ampliadas). **Recomendado:** trocar por fotos reais da equipe, com autorização de uso de imagem, em
`config.js → fotosValor` (retrato ~900×1000 e paisagem ~900×800).

**Cartões de atendimento (página inicial):** usam fotos recortadas da imagem de referência enviada pela
Cuidare (`assets/photos/residencia.webp`, `hospital.webp`, `consultas.webp`), sem os
textos, selos e ícones que vinham sobre a imagem. Para trocar por fotos reais, substitua esses arquivos
(~900×700) ou altere os caminhos em `config.js → photos`; deixe vazio para voltar à composição visual.

## 7. Identidade visual e logo

- Paleta exclusiva: `#061A35`, `#0757B8`, `#1769FF`, `#DCEBFF`, `#FFFFFF` (variáveis em `site.css`),
  inclusive no 3D, no ícone e na imagem de compartilhamento. Sem verde, bege, creme, areia, marrom ou dourado.
- **Logo:** versão oficial branca (`assets/img/logo-white.png`), proporção original. O logo de coração das
  imagens de referência não é o oficial e não foi reproduzido. **Pendente:** logo em vetor (SVG ou PDF).

## 8. Conteúdo que precisa da sua validação

| Item | Onde aparece | Fonte |
| --- | --- | --- |
| 7+ anos, 2.000+ famílias, 4,8/5, 99+ avaliações | Capa | Portfólio “Planos — Apresentação” |
| Cuidare Brasil, mais de 10 anos e presença em todo o país | Rodapé | Portfólio |
| Cuidado e rotina, saúde e segurança, condições do serviço | Página 3 | PDF “Proposta Personalizada de Cuidados” |
| Suporte da Cuidare e contratação (faltas, troca, supervisão, pagamento, cancelamento) | Página 3 | FAQ do portfólio |
| Selos da capa (seleção e verificação, supervisão, faltas cobertas) | Capa | FAQ do portfólio |
| 9 depoimentos com nome | Capa | Enviados pela Cuidare e PDF “Proposta Personalizada”. **Confirme a autorização de cada pessoa** |
| Link “Ver avaliações públicas” | Capa | Busca no Google Maps. **Troque pelo link exato do perfil** em `config.js → reviewsUrl` |
| Aviso de privacidade | Todas as páginas | Texto-base (o site não registra dados pessoais). **Revise com o jurídico** |
| Opções da consulta (12h noturno e 24h no hospital e em consultas) | Consulta | Proposta comercial. **Confirme que a operação atende todas** |

## 9. O que mudou em relação à versão anterior

- Três páginas: `/` (capa + consulta), `/valor/` (somente o valor escolhido), `/detalhes/` (resumo e detalhes do atendimento).
- Volta a exibir preço, **um por consulta**, a partir de uma tabela única.
- Visual escuro, azul e branco, com corações e esferas 3D em WebGL (versão leve em CSS nos aparelhos mais simples).
- Títulos em Fredoka, abertura animada com o logo e entrada dos módulos em cascata.
- Fotos na página do valor.
- Sem formulário, telefone ou WhatsApp: a apresentação é enviada a quem já conversa com a equipe.
- Consulta curta (atendimento e, na residência, duração e frequência), sem bairro, início ou
  necessidades, e sem referências a avaliação gratuita ou agendamento (a pessoa já passou por isso).
- Tocar em uma opção avança sozinho (também ao tocar de novo na opção já marcada); sem botão “Continuar”.
- Hospital e consultas: tabela de valores por dia (durações × segunda a sexta / sábados, domingos e
  feriados), com entrada 3D linha a linha e inclinação ao passar o mouse; sem valores mensais.
- Pós-operatório retirado. Voltar com o botão do celular não trava mais a consulta.

## 10. Checklist de validação (antes do domínio definitivo)

- [ ] Capa abre bem no celular e no computador; “Consultar valores” leva à seleção.
- [ ] Consulta completa tocando nas opções (sem “Continuar”); “Voltar”, indicador de etapas e voltar do navegador funcionam.
- [ ] Hospital e consultas: tocar no cartão abre a tabela por dia; residência: três etapas e valor mensal.
- [ ] Voltar do valor com o botão do celular: a consulta continua respondendo ao toque.
- [ ] Página 2 mostra só o valor escolhido; “Alterar minhas escolhas” funciona.
- [ ] Página 3: resumo confere, “Editar” leva à etapa certa e volta ao valor; “Voltar ao valor” funciona.
- [ ] Pendências de preço (seção 3) confirmadas.
- [ ] Aviso de privacidade revisado; depoimentos autorizados; link de avaliações atualizado.
- [ ] (Se usar) GTM configurado, aviso de consentimento aparecendo, eventos chegando.
