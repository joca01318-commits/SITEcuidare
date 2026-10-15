# Cuidare Vila Mariana — preços, integrações e pendências

Este documento separa o que **já funciona**, o que **depende de contas ou confirmação** da Cuidare e o
que **precisa de validação** antes da publicação definitiva. Nenhuma integração foi simulada.

Configuração pública: `assets/js/config.js`. Preços: `assets/js/precos.js`.

---

## 1. Publicação e validação (sem derrubar o site atual)

1. Publique esta versão em um **projeto Netlify novo** (ex.: `cuidare-vm-consulta`), arrastando a pasta
   do `.zip` em *Add new project → Deploy manually*. O site atual continua no ar.
2. Ative o **Netlify Forms** nesse projeto (seção 5) e faça uma solicitação de teste.
3. Valide no celular e no computador o checklist da seção 13.
4. Só então aponte o domínio definitivo para o projeto novo (*Domain management*).
5. Ao definir o domínio, atualize `siteUrl` em `config.js` e os endereços em `index.html`
   (`canonical`, `og:url`, `og:image`, dados estruturados), `robots.txt` e `sitemap.xml`.

Endereços do site anterior continuam funcionando (`_redirects`): `/experiencia/` leva à consulta e
`/avaliacao/` leva aos detalhes.

## 2. Regra comercial: um preço por consulta

- A página inicial **não mostra preços**: o visitante escolhe atendimento, duração, frequência e detalhes.
- A página `/valor/` mostra **somente** o valor da combinação escolhida. Não há tabela, comparação nem
  outras durações. A página `/detalhes/` repete apenas esse valor.
- Sem valor validado para a combinação, o site **não inventa**: mostra “Proposta personalizada” e leva à
  solicitação.
- Testado automaticamente para as 72 combinações possíveis (47 com valor, 25 com proposta personalizada).

## 3. Tabela de preços (`assets/js/precos.js`)

Valores aprovados pela Cuidare (lista enviada em 14/10/2026, com a diária de 12h diurna em R$ 297):

| Duração | Segunda a sexta (22 dias) | Segunda a sábado (26 dias) | Todos os dias (30 dias) | Atendimento pontual (diária) |
| --- | --- | --- | --- | --- |
| 6 horas | R$ 3.997 | R$ 4.497 | R$ 5.197 | R$ 219 |
| 8 horas | R$ 4.697 | R$ 5.197 | R$ 6.197 | R$ 259 |
| 12 horas durante o dia | R$ 5.697 | R$ 6.297 | R$ 6.997 | R$ 297 |
| 12 horas durante a noite | **a confirmar** | **a confirmar** | **a confirmar** | R$ 349 |

- Valores mensais por mês; atendimento pontual por diária. Orçamento válido por 5 dias.
- Plano de 24 horas não é oferecido.
- “Ainda não sei” (duração) leva à proposta personalizada.

**Pendências de confirmação (sem elas, o site mostra proposta personalizada ou omite):**

| Item | Situação |
| --- | --- |
| 12 horas noturno mensal | O portfólio original trazia R$ 5.997 / 6.597 / 6.997, mas a lista nova não trouxe. Confirme e preencha em `precos.js → mensal['12h_noite']`. |
| Tabela por tipo de atendimento | A mesma tabela vale para residência, hospital, pós-operatório e consultas (como no site anterior). Se algum tipo tiver valor diferente, avise. |
| Diárias em fim de semana e feriado | O portfólio original tinha acréscimo; a lista nova não. O site não menciona acréscimo. Confirme. |
| Adicional de alimentação | R$ 30 por dia quando a família não fornece (FAQ do portfólio). Aparece em “Condições a confirmar”. |

Para alterar um valor: edite `precos.js`, mantendo os números sem ponto (ex.: `5697`).

## 4. Preços fora do navegador (modo servidor, opcional)

No modo local (padrão), a tabela fica em `precos.js`, que é público. Os mesmos valores já eram públicos
no site anterior; a página continua mostrando um único valor por consulta. Se a tabela não deve ficar no
código do navegador:

1. Publique por **Git ou Netlify CLI** (publicações por arrastar não incluem funções).
2. Em *Project configuration → Environment variables*, crie `CUIDARE_PRECOS` com o conteúdo de
   `window.CUIDARE_PRECOS` em JSON.
3. Em `config.js`: `precos.modo = 'servidor'`.
4. Apague `assets/js/precos.js` e as linhas `<script src=".../precos.js">` das três páginas.

A função `netlify/functions/preco.mjs` (`/api/preco`) devolve **apenas** o valor da combinação pedida.
Se ela falhar, o site mostra proposta personalizada, sem inventar valor.

## 5. Solicitações — WhatsApp + Netlify Forms

Ao clicar em **Continuar pelo WhatsApp** (página 3), o site valida os dados e:

1. Abre o WhatsApp comercial com a mensagem pronta (nome, e-mail se informado, WhatsApp, atendimento,
   duração, frequência, bairro, início, necessidades, valor apresentado, observações e código).
   A pessoa revisa e envia.
2. Registra a solicitação no **Netlify Forms** (formulário `consulta`) e informa o resultado:
   “registrada para a equipe” somente se o envio foi confirmado; caso contrário, avisa que o registro não
   foi concluído e orienta a enviar a mensagem do WhatsApp.

O site nunca afirma que a contratação foi concluída nem que uma visita foi agendada.

**Para ativar o registro:** Netlify → projeto → *Forms* → **Enable form detection** → publicar de novo →
*Forms → consulta → Form notifications* (e-mail da equipe comercial).

| Campo | Conteúdo |
| --- | --- |
| `nome`, `whatsapp`, `email`, `observacoes` | dados de contato (e-mail e observações opcionais) |
| `servico`, `duracao`, `frequencia`, `bairro`, `inicio`, `necessidades` | escolhas da consulta |
| `valor_apresentado`, `versao_precos` | valor exibido e versão da tabela |
| `prioridade` | `alta` (o mais breve / 7 dias), `media` (semanas), `baixa` (pesquisando) |
| `resumo` | a mesma mensagem enviada ao WhatsApp |
| `origem`, `midia`, `campanha`, `utm_term`, `utm_content`, `gclid`, `fbclid`, `pagina_entrada`, `site_referencia` | origem da visita |
| `id_solicitacao` | código (ex.: `CVM-8LYUHC-9T2L`); repetido em nova tentativa, para deduplicar |
| `consentimento`, `enviado_em` | `sim` (obrigatório) e data/hora |

Proteções: envio único por código, tempo limite, campo-armadilha anti-spam e botão para abrir o
WhatsApp de novo se o navegador bloquear a nova aba.

## 6. CRM e automações (depende de conta)

Em `config.js`: `lead.mode = 'both'` e `lead.webhookUrl = 'https://…'` (webhook que aceite `POST` JSON
com CORS liberado). A URL fica pública: use um webhook que só **receba** dados.
**WhatsApp Business API** (mensagens automáticas) exige conta Meta Business verificada e provedor oficial.
**Não está implementado**: o site usa links `wa.me`.

## 7. WhatsApp

Número: `5511916349800`, o mesmo do site anterior (`config.js → whatsapp`). Confirme que está ativo no
WhatsApp Business e monitorado nos horários de atendimento.

## 8. Medição (depende de conta)

Nada é carregado enquanto `analytics.gtmId` estiver vazio. Com o GTM preenchido, o site pede
consentimento e só então envia eventos `cuidare_*`: `cta_click`, `step_complete` (só duração e
frequência), `consulta_complete`, `price_view`, `details_view`, `lead_form_invalid`,
`lead_submit_attempt/_success/_error`, `whatsapp_click`.

**Nunca são enviados:** nome, telefone, e-mail, bairro, observações, tipo de atendimento e necessidades.

## 9. Fotos reais (pendente: material da Cuidare)

As imagens enviadas como referência visual são montagens geradas por IA, com um logo de coração que
não é o oficial nos uniformes, e em baixa resolução; por isso **não foram usadas**. Também não foram
usadas fotos de banco de imagens. Cada cartão de atendimento usa uma composição visual própria até
receber a foto real.

Para incluir fotos, com **autorização de uso de imagem** de quem aparece:
1. Salve em `assets/photos/` (WebP ou JPG, ~900×700, até ~250 KB).
2. Preencha em `config.js → photos`: `residencia`, `hospital`, `pos_operatorio`, `consultas`.
3. As fotos entram automaticamente nos cartões. Prefira ambientes claros e uniformes azuis ou brancos.

## 10. Identidade visual e logo

- Paleta exclusiva: `#061A35`, `#0757B8`, `#1769FF`, `#DCEBFF`, `#FFFFFF` (variáveis em `site.css`),
  inclusive no 3D, no ícone e na imagem de compartilhamento. Sem verde, bege, creme, areia, marrom ou dourado.
- **Logo:** versão oficial branca (`assets/img/logo-white.png`), proporção original. O logo de coração das
  imagens de referência não é o oficial e não foi reproduzido. **Pendente:** logo em vetor (SVG ou PDF).
- **E-mail institucional:** não incluído no rodapé por falta de confirmação. Informe o endereço oficial.

## 11. Conteúdo que precisa da sua validação

| Item | Onde aparece | Fonte |
| --- | --- | --- |
| 7+ anos, 2.000+ famílias, 4,8/5, 99+ avaliações | Capa | Portfólio “Planos — Apresentação” |
| Cuidare Brasil, mais de 10 anos e presença em todo o país | Rodapé | Portfólio |
| Itens incluídos, não incluídos, contratação, avaliação e condições | Página 3 | FAQ do portfólio |
| Selos da capa (seleção e verificação, supervisão, avaliação gratuita) | Capa | FAQ do portfólio |
| 5 depoimentos com nome | Capa | Enviados pela Cuidare. **Confirme a autorização de cada pessoa** |
| Link “Ver avaliações públicas” | Capa | Busca no Google Maps. **Troque pelo link exato do perfil** em `config.js → reviewsUrl` |
| Aviso de privacidade | Todas as páginas | Texto-base. **Revise com o jurídico** (razão social, CNPJ, canal formal) |
| Necessidades (Alzheimer/Parkinson, pós-operatório, 12h noturno, pontual) | Consulta | Briefing. **Confirme que a operação atende todos** |

## 12. O que mudou em relação à versão anterior

- Três páginas: `/` (capa + consulta), `/valor/` (somente o valor escolhido), `/detalhes/` (detalhes, dados e WhatsApp).
- Volta a exibir preço, **um por consulta**, a partir de uma tabela única.
- Visual escuro, azul e branco, com corações e esferas 3D em WebGL (versão leve em CSS nos aparelhos mais simples).
- Formulário com nome completo, e-mail (opcional), WhatsApp e observações; continuação pelo WhatsApp.

## 13. Checklist de validação (antes do domínio definitivo)

- [ ] Capa abre bem no celular e no computador; “Consultar valores” leva à seleção.
- [ ] Consulta completa; “Voltar”, indicador de etapas e voltar do navegador funcionam.
- [ ] Página 2 mostra só o valor escolhido; “Alterar minhas escolhas” funciona.
- [ ] Página 3: resumo confere, “Editar” leva à etapa certa e volta ao valor.
- [ ] Envio de teste aparece em *Netlify → Forms → consulta* e chega por e-mail à equipe.
- [ ] WhatsApp abre no número correto com a mensagem completa.
- [ ] Pendências de preço (seção 3) confirmadas.
- [ ] Aviso de privacidade revisado; depoimentos autorizados; link de avaliações atualizado.
- [ ] (Se usar) GTM configurado, aviso de consentimento aparecendo, eventos chegando.
