# Cuidare Vila Mariana — integrações, configurações e pendências

Este documento separa o que **já funciona**, o que **depende de credenciais ou contas** da Cuidare
e o que **precisa de validação** antes da publicação definitiva. Nenhuma integração foi simulada:
onde não há credencial, o site funciona sem ela e mostra uma alternativa honesta (WhatsApp).

Toda configuração pública fica em `assets/js/config.js`. **Esse arquivo é público**: nunca coloque
nele preços, tokens ou regras comerciais.

---

## 1. Publicação e validação (sem derrubar o site atual)

1. Publique esta versão em um **projeto Netlify novo** (ex.: `cuidare-vm-nova`), arrastando a pasta
   do `.zip` em *Add new project → Deploy manually*. O site atual continua no ar.
2. Ative o **Netlify Forms** nesse projeto (seção 2) e faça uma solicitação de teste.
3. Valide no celular e no computador o checklist da seção 11.
4. Só então aponte o domínio definitivo para o projeto novo (*Domain management*).
5. Ao definir o domínio, atualize `siteUrl` em `config.js` e os endereços em: `index.html`,
   `experiencia/index.html` (tags `canonical`, `og:url`, `og:image`), `robots.txt` e `sitemap.xml`.

> Para publicar por Git ou Netlify CLI, o arquivo `netlify.toml` já está pronto.

## 2. Solicitações de avaliação — Netlify Forms (funciona sem código extra)

O formulário de `/avaliacao/` já está marcado para o Netlify Forms (`name="avaliacao"`,
`data-netlify="true"`, campo-armadilha anti-robô `empresa`).

**Para ativar:**
1. Netlify → projeto → *Forms* → **Enable form detection**.
2. Publique de novo (a detecção acontece na publicação).
3. *Forms → avaliacao → Form notifications*: adicione o e-mail da equipe comercial.
4. Faça um envio de teste e confira em *Forms → avaliacao*.

Enquanto o Forms não estiver ativo, o envio **falha de forma honesta**: o site não mostra
confirmação e oferece “Continuar pelo WhatsApp” com as respostas na mensagem.

**Campos recebidos** (legíveis para a equipe, sem a família repetir informações):

| Campo | Conteúdo |
| --- | --- |
| `nome`, `whatsapp`, `periodo` | contato e melhor período |
| `cuidado_para`, `local`, `necessidade`, `duracao`, `dias`, `inicio`, `bairro`, `situacao`, `observacoes` | respostas da experiência |
| `resumo` | todas as respostas em texto, prontas para copiar |
| `prioridade` | `alta` (o mais breve / 7 dias), `media` (próximas semanas), `baixa` (pesquisando) |
| `origem`, `midia`, `campanha`, `utm_term`, `utm_content`, `gclid`, `fbclid` | origem da visita (UTM) |
| `pagina_entrada`, `site_referencia` | primeira página e site de onde a pessoa veio |
| `id_solicitacao` | código exibido à família (ex.: `CVM-8LYUHC-9T2L`); se ela tentar de novo após falha, o código se repete, permitindo deduplicar |
| `consentimento` | `sim` (obrigatório para enviar) |
| `enviado_em` | data/hora ISO |

**Proteções já implementadas:** botão bloqueado durante o envio, envio único por solicitação,
tempo limite de 15 s, mensagem de erro com alternativa, campo-armadilha anti-spam.

## 3. CRM e automações (depende de conta/credencial)

Para enviar também a um CRM (RD Station, HubSpot, Pipedrive…) ou automação (Make, Zapier):

1. Crie no serviço um **webhook** que aceite `POST` com JSON.
2. Em `config.js`: `lead.mode = 'both'` e `lead.webhookUrl = 'https://…'`.
3. O site envia o mesmo conjunto de campos da tabela acima, em JSON.

Observações:
- O webhook precisa aceitar requisições do navegador (CORS liberado para o domínio do site).
- A URL do webhook fica visível no código público. Use um webhook que só **receba** dados.
  Para regras confidenciais, use uma função de servidor (seção 7).
- **WhatsApp Business API** (mensagens automáticas, etiquetas, follow-up) exige conta Meta Business
  verificada e um provedor oficial (BSP). **Não está implementado.** O site usa links `wa.me`,
  que abrem a conversa com a mensagem pronta e a família revisa antes de enviar.

## 4. WhatsApp

- Número: `5511916349800`, o mesmo do site anterior, em `config.js → whatsapp`.
- O link `wa.me` foi validado no formato. **Confirme** que o número está ativo no WhatsApp
  Business e que alguém o monitora nos horários de atendimento.
- Mensagens pré-preenchidas:
  - geral: “Olá! Vim pelo site da Cuidare Vila Mariana e gostaria de falar com a equipe.”
  - na avaliação: resumo completo das respostas + nome e período (se preenchidos);
  - após o envio: código da solicitação + resumo.

## 5. Medição e análise (depende de conta)

Nenhuma ferramenta de análise é carregada enquanto `analytics.gtmId` estiver vazio. Nesse estado
não há cookies de terceiros nem aviso de cookies.

**Para ativar:** crie um contêiner no Google Tag Manager e preencha `analytics.gtmId` (`GTM-XXXX`).
O site passa a mostrar um aviso de consentimento e **só carrega o GTM se a pessoa aceitar**.

Eventos enviados ao `dataLayer` (após consentimento):

| Evento | Quando | Parâmetros |
| --- | --- | --- |
| `cuidare_cta_click` | clique em CTA | `cta` (header, hero, journey, final) |
| `cuidare_experience_start` / `_resume` / `_restart` | início/retomada da experiência | — |
| `cuidare_step_complete` | cada etapa concluída | `step`, `step_id`, `value` (só para pessoa, duração, dias e início) |
| `cuidare_experience_complete` | fim da experiência | `prioridade` |
| `cuidare_review_view` | abertura da avaliação | `completo` |
| `cuidare_lead_form_invalid` | tentativa com campos inválidos | `campos` |
| `cuidare_lead_submit_attempt` / `_success` / `_error` | envio | `prioridade`, `origem` / `motivo` |
| `cuidare_whatsapp_click` | clique em WhatsApp | `location`, `prioridade` |

**Nunca são enviados a ferramentas de análise:** nome, telefone, bairro, observações, local do
atendimento e tipo de necessidade (dados que podem revelar condição de saúde, sensíveis pela LGPD).

Sugestão de conversões no GA4/Google Ads: `cuidare_lead_submit_success` (principal) e
`cuidare_whatsapp_click` (secundária). Pixel da Meta, se usado, deve ser instalado **via GTM**,
respeitando o mesmo consentimento.

## 6. Qualificação comercial

- **Alta intenção:** início “o mais breve possível” ou “nos próximos 7 dias” → `prioridade = alta`.
- **Média:** “nas próximas semanas”.
- **Pesquisa/planejamento:** “estou pesquisando” → `prioridade = baixa`.
- O envio do formulário completo já indica intenção maior que um clique no WhatsApp; os dois são
  medidos separadamente.
- Sugestão de rotina: responder `alta` primeiro, no período escolhido pela família.

## 7. Precificação no servidor (estrutura pronta, desativada)

O site público **não mostra nem contém preços**. Para a equipe consultar um valor de **referência
interna** de forma protegida, existe a função `netlify/functions/precificacao.mjs`:

- Só funciona em publicações por **Git ou Netlify CLI** (publicações por arrastar não incluem funções).
- Fica desativada até configurar, em *Project configuration → Environment variables*:
  - `PRICING_ADMIN_TOKEN`: senha longa e aleatória, conhecida só pela equipe;
  - `PRICING_RULES`: JSON com as regras, por exemplo:
    ```json
    { "versao": "2026-10", "itens": { "8h|seg_sex": { "valor": null, "observacao": "preencher" } } }
    ```
    As chaves combinam duração (`6h`, `8h`, `12h_dia`, `12h_noite`) e dias
    (`seg_sex`, `seg_sab`, `todos`, `pontual`). Os valores são definidos pela Cuidare; nenhum foi criado aqui.
- Consulta interna (exemplo):
  `curl -X POST https://SEU-SITE/api/precificacao -H "Authorization: Bearer $TOKEN" -d '{"duracao":"8h","dias":"seg_sex"}'`
- Sem token correto, a resposta é `401`. Sem configuração, `501`.

## 8. Fotos reais (pendente: material da Cuidare)

O briefing pede fotografias autênticas. **Não foram usadas fotos de banco nem imagens geradas por IA.**
Enquanto não houver fotos, o site usa composições próprias (arco com escultura 3D e cartões tipográficos).

Para incluir fotos, com **autorização de uso de imagem** de quem aparece:
1. Salve em `assets/photos/` (WebP ou JPG, ~200–300 KB cada).
2. Preencha em `config.js → photos`: `hero` (retrato ~1200×1500), `domicilio`, `hospital`,
   `consultas`, `viagens` (~900×1200).
3. As fotos entram automaticamente, com carregamento progressivo, no lugar das composições.

## 9. Conteúdo que precisa da sua validação antes de publicar

| Item | Onde aparece | Fonte usada |
| --- | --- | --- |
| 7+ anos, 2.000+ famílias, 4,8/5, 99+ avaliações | Home e hero | Portfólio “Planos — Apresentação” |
| “Faz parte da Cuidare Brasil, com mais de 10 anos e presença em todo o país” | Home | Portfólio |
| Seleção, verificação, acompanhamento, faltas e trocas, vínculo trabalhista | Diferenciais | FAQ do portfólio |
| “A visita e a avaliação são gratuitas, com horário agendado” | Como funciona | FAQ do portfólio |
| “A proposta é validar o cuidador nos primeiros 5 dias” | Como funciona | FAQ do portfólio |
| 5 depoimentos com nome | Depoimentos | Enviados pela Cuidare. **Confirme a autorização de cada pessoa** |
| Link “Ver avaliações públicas” | Depoimentos | Busca no Google Maps. **Troque pelo link exato do perfil** em `config.js → reviewsUrl` |
| Aviso de privacidade | Todas as páginas | Texto-base. **Revise com o jurídico**: incluir razão social/CNPJ e um canal formal (e-mail) para direitos do titular |
| Opções da experiência (pós-operatório, Alzheimer/Parkinson, 12h noturno, atendimento pontual) | /experiencia | Briefing. **Confirme que a operação atende todos** |

## 10. O que mudou em relação ao site anterior

- A tabela pública de preços foi **removida**; os valores também saíram do código do navegador.
- Plano de 24 horas não é oferecido.
- A página única virou 3 rotas: `/`, `/experiencia/`, `/avaliacao/` (mais `404.html`).
- Links antigos como `/#planos` levam à home (sem erro).

## 11. Checklist de validação (antes do domínio definitivo)

- [ ] Home abre bem no celular e no computador; CTA leva a `/experiencia/`.
- [ ] Experiência completa; “Voltar”, editar respostas e voltar do navegador funcionam.
- [ ] Na avaliação, “Editar” leva à etapa certa e volta ao resumo.
- [ ] Envio de teste aparece em *Netlify → Forms* e chega por e-mail à equipe.
- [ ] “Continuar pelo WhatsApp” abre a conversa com o resumo, no número correto.
- [ ] Aviso de privacidade revisado.
- [ ] Depoimentos autorizados e link de avaliações atualizado.
- [ ] (Se usar) GTM configurado, aviso de consentimento aparecendo, eventos chegando.
