# codenexo — Plano oficial

> Memória do projeto. Toda sessão de trabalho começa lendo este arquivo.
> Última atualização: 09/11/2026.
>
> Esta pasta vive temporariamente no repositório SITEcuidare. Quando o repositório
> próprio `codenexo` existir, tudo é movido para lá. Este projeto **não tem relação com a Cuidare**.

---

## 1. Visão

**codenexo** é uma empresa movida por bots que **encontram clínicas, criam sites e agendas e vendem**, sozinhos, com **supervisão humana por exceção**.

- **Fase 1 (jan–abr/2027):** vender **site + agendamento online** para clínicas veterinárias.
- **Fase 2 (a partir de ~mai/2027):** virar **micro-SaaS por assinatura**: agenda, banco de dados da clínica, gestão e manutenção.
- **Destino (2028+):** plataforma IA-first para clínicas, com recepcionista de IA no WhatsApp, pagamentos, planos pet e outros nichos.

## 2. Marca

- **Nome:** codenexo (code + nexo = conexão). ⚠️ Conferir no INPI, no registro.br e no Instagram antes de investir.
- **Símbolo:** `< • >`, código com um ponto de conexão no meio. Arquivo: `marca/codenexo-marca.svg`.
- **Cores:**

| Cor | Hex | Uso |
|---|---|---|
| Verde-profundo | `#0F3D3E` | base |
| Verde-nexo | `#1FAF7A` | marca |
| Menta | `#3DDC97` | destaques |
| Coral | `#FF7A59` | botões / ação |
| Areia | `#F7F5F0` | fundo |

- **Alternativas de nome:** Codelume, Codevia.

## 3. Nicho e oferta

- **Nicho principal:** clínicas **veterinárias** primeiro (jan/2027); **clínicas médicas** em fev/2027.
- Médicas seguem as regras de publicidade do CFM (sem antes/depois, sem promessa de resultado). Dados de saúde são dados sensíveis na LGPD.

| Plano | Inclui | Implantação | Mensalidade |
|---|---|---|---|
| Essencial | Site, WhatsApp, mapa, Google Meu Negócio, SEO local | R$ 1.200–1.800 | R$ 99–149 |
| **Agenda** ⭐ | Essencial + agendamento online, painel, lembretes | R$ 1.800–2.800 | R$ 199–299 |
| Clínica Completa | Agenda + vários profissionais, sinal online, lembrete de vacina/retorno, 3D premium | R$ 3.500–6.000 | R$ 349–499 |

- **Cliente fundador (pré-venda em dez/2026):** implantação de R$ 500–800 para as 3–5 primeiras clínicas.
- **Regras comerciais:** entrada de 50% na implantação, contrato mínimo de 12 meses, opção de plano anual adiantado (~15% de desconto), indicação premiada (1 mês grátis), parceiros com comissão de 10–20%.
- **Mensagem de venda:** vender resultado ("sua clínica nunca mais perde cliente"), não "site".

## 4. Os bots

| Bot | Função | Usa Claude? | Máx. de clones |
|---|---|---|---|
| **Nexo Sentinela** | Vigia: verifica saúde e comportamento, mata e recria bots, chama humano após 3 falhas iguais | Não | 1 (nunca clona) |
| **Nexo Gestão** (principal) | Coordena tarefas, metas, custos, painel, alertas, relatório diário, propõe clones | Não | 1 (nunca clona) |
| **Nexo Criação** | Gera sites e agendas a partir da biblioteca, testa e publica | Não | 2 |
| **Nexo Vendas** | Busca clínicas, pontua leads, aborda, faz follow-up, responde, envia proposta e pagamento | Raramente (Haiku) | 3 (jan–mar) → 10 |

### Limites (os bots não são livres)
- Cada bot só executa as ações da sua lista de permissões.
- Teto de gasto, limite de envios por dia/hora, horário comercial, registro de toda ação.
- Preço, prazo e condições saem **só da tabela**. O bot nunca inventa.
- Botão de pausa por bot e geral.

### Níveis de autonomia
0. Bot sugere, humano faz.
1. Bot faz, humano aprova cada ação. **Início.**
2. Bot faz a rotina sozinho; humano aprova preço e fechamento.
3. Quase total, com relatório diário (após meses de bons resultados).

### Supervisão por exceção: o bot para e chama o humano quando há
desconto fora da tabela, dúvida sem resposta segura, reclamação, pedido fora do pacote, ou alarme (e-mails voltando, spam, respostas negativas, gasto acima do teto).

### Economia dos Bots
- Cada bot tem um **caixa próprio**: receita gerada menos custos (IA, servidor, mensagens).
- **Clone do Vendas nasce quando** houver lucro positivo por 30 dias, pelo menos 2 vendas no mês, e-mails saudáveis (<3% voltando, quase zero spam) **e aprovação humana**.
- Cada clone recebe **território próprio** (região ou nicho) e **1–2 caixas de e-mail próprias**, além do melhor modelo de mensagem do pai.
- Prejuízo por X dias: o Sentinela pausa ou mata o bot e avisa.

## 5. Arquitetura

```
                 Nexo Sentinela (vigia, sem IA)
                          │ monitora / mata / recria
        ┌─────────────────┼─────────────────┐
   Nexo Gestão ──── Nexo Criação ──── Nexo Vendas
        └─────────────────┼─────────────────┘
                     Nexo Ponte (limites + permissões + registro)
     Navegador isolado · WhatsApp oficial · E-mail · Deploy · Pagamento · Limpeza
                          │
                PostgreSQL (memória + inteligência)
```

- **Monólito modular** em Python + FastAPI, Docker Compose, PostgreSQL (também como fila, `SKIP LOCKED`). Redis só se precisar.
- **Multi-clínica desde o primeiro dia** (cada clínica vê só os próprios dados), para a Fase 2 ser uma evolução e não uma reconstrução.
- **Máquina de estados** do lead: `novo → qualificado → protótipo → abordado → respondeu → proposta → pago → entregue`.
- Agentes não conversam entre si: tudo passa pelo banco. Cada etapa tem um único dono, com trava otimista (`version`), idempotência nos envios e log de eventos só de inclusão.
- **Nexo Ponte:** todo acesso externo passa por ela.
  - Navegador isolado com lista de sites permitidos, sem contas pessoais.
  - Google Places API, sem raspagem do Maps.
  - **WhatsApp só pela API oficial da Meta**, nunca automação do WhatsApp Web.
  - E-mail com domínio próprio.
  - Deploy; pagamentos (Asaas ou Mercado Pago).
- **Limpeza de dados (LGPD):**
  - **Apaga sozinho:** leads sem resposta após 90 dias, quem pediu para sair (fica só o registro de "não contatar"), duplicados, protótipos não vendidos após 60 dias, logs antigos.
  - **Nunca apaga sozinho:** clientes ativos, contratos, notas fiscais e auditoria.
  - Backup antes de toda exclusão em massa.

## 6. Inteligência sem gastar

- **"Faz uma vez, usa sempre":** cada componente premium (3D, animações, seções) é criado uma vez e vira peça da biblioteca. O Nexo Criação monta sites combinando peças, com **custo de R$ 0 por site**.
- **Cores automáticas** extraídas do logo da clínica.
- **Portão de qualidade:** abrir no celular, Lighthouse, agenda funcionando. Reprovou, não publica.
- **3D leve:** carrega só quando aparece na tela, tem versão leve para celular fraco e respeita quem desativou animações.
- **Ferramentas gratuitas:** Three.js / React Three Fiber, GSAP / Framer Motion, Lottie, modelos 3D CC0, fotos Unsplash/Pexels (conferir licenças).
- **Aprendizado:** notas humanas no modo treino, teste A/B de mensagens, banco de objeções e respostas que funcionaram, exceções resolvidas viram conhecimento.
- **"Escola" semanal:** uma sessão por semana com o Claude Code transforma os erros em regras e componentes.

### IAs

| IA | Uso | Custo |
|---|---|---|
| Claude Haiku | Entender respostas, classificar leads | R$ 10–40/mês |
| Claude Sonnet | Textos novos raros | R$ 10–40/mês |
| Claude Opus | Casos complexos | R$ 0–20/mês |
| Claude Code (terminal, assinatura) | Construir e treinar | Fixo, **só desenvolvimento** |
| Whisper (local) | Transcrever áudios do WhatsApp | Grátis |
| rembg (local) | Remover fundo das fotos | Grátis |
| Embeddings (local) | Busca no banco de respostas | Grátis |
| Tesseract (local) | Ler imagens de tabelas | Grátis |

**Controle de custo:** todo uso de IA passa por um único módulo (`llm.py`), com teto diário, Batch API e cache de prompt.

## 7. Canais e volume

- **1ª abordagem:** e-mail (domínio separado, aquecimento de 2–4 semanas) com link do protótipo + botão "Falar no WhatsApp".
- **WhatsApp automático** só para quem respondeu, pediu contato ou é cliente.
- **Funil estimado:** 3–8% respondem, 10–25% de quem responde fecha, ~0,5–1,5% das abordagens viram venda.

| Fase | Abordagens/dia | Por mês |
|---|---|---|
| Jan (calibração) | 10–20 | 300–500 |
| Meses 2–3 | 50–80 | 1.000–1.600 |
| Mês 4+ | 100–150 | 2.000–3.000 |
| 2º sem/2027 (4–6 bots, todo o Brasil) | 230–450 | 5.000–10.000 |

## 8. Projeções (estimativas, margem de erro grande)

| Fase | Bots | Vendas/mês | Lucro estimado/mês |
|---|---|---|---|
| Início (meses 1–3) | 1 | 5–15 | R$ 2–7,8 mil |
| Crescimento (meses 4–8) | 3 | 15–45 | R$ 14–55 mil |
| Escala (mês 9+) | 10 | 55–330 | R$ 55–435 mil (otimista) |

- **Você tira R$ 10 mil/mês:** realista em ~maio/2027 (otimista mar; pessimista ago–set).
- **Você tira R$ 60 mil/mês:** realista no 2º semestre de 2028. Possível no fim de 2027 se o 2º semestre de 2027 tiver 30–60 mil abordagens e a taxa de venda se confirmar.
- **R$ 500 mil+/ano:** meta do ano 2 (chance ~15–25%).
- **Nota atual do plano:** 8/10. Sobe para 9 com 10 conversas com veterinárias e 2–3 pré-vendas.

### Quando crescer a empresa (contratar só quando a mensalidade pagar; guardar 6 meses de reserva)

| Lucro mensal estável | Ação |
|---|---|
| até R$ 15 mil | só fundador + bots + contador |
| R$ 15–30 mil | 1º atendimento/suporte |
| R$ 30–60 mil | 1 programador + 1 vendedor comissionado (remoto) |
| R$ 60–150 mil | time de 5–8, coworking |
| R$ 150 mil+ por 6 meses | escritório próprio, 10–20 pessoas, talvez investidor |

## 9. Passo a passo até o lançamento

Início em 09/11/2026. **Lançamento em segunda, 04/01/2027.**

| # | Semana | Claude constrói | Fundador faz | Pronto quando |
|---|---|---|---|---|
| 1 | 09–15/nov | `PLANO.md`; estrutura (Docker, FastAPI, PostgreSQL, migrações); `llm.py` com teto de custo; esqueleto de Sentinela e Ponte; CI com pytest | Contador e CNPJ (confirmar se MEI permite a atividade); comprar domínio; **iniciar aquecimento do e-mail**; Meta Business; Google Cloud (Places API); conta Asaas; número de WhatsApp novo | App sobe no Docker; testes passando; contas pedidas |
| 2 | 16–22/nov | Biblioteca premium (3D, animações, seções); 1º modelo veterinário; cores automáticas pelo logo; portão de qualidade (Playwright + Lighthouse) | Instagram da codenexo; **conversar com 10 veterinárias** (dor e preço); lista de veterinárias da região-piloto | 1º site vet gerado e aprovado no portão |
| 3 | 23–29/nov | **Produto Agenda:** página de agendamento, painel da clínica (horários, profissionais, cancelamentos), lembretes por e-mail; base multi-clínica | Preços finais; rascunho de contrato, termos, privacidade e contrato de operador LGPD | Agendamento de ponta a ponta funcionando |
| 4 | 30/nov–06/dez | **Nexo Criação** completo (dados → site → teste → deploy); modelos vet 2 e 3; formulário de dados do cliente; **modo treino** com notas no painel | Dar nota aos sites (≈30 min/dia); **começar pré-vendas** de cliente fundador | Protótipo de clínica real em <10 min |
| 5 | 07–13/dez | **Nexo Vendas:** Google Places, pontuação de leads, e-mail com limites e descadastro, follow-up 3/7/14 dias, proposta PDF, link de pagamento, teste A/B | Dar nota às mensagens; revisar contratos com contador/advogado; fechar 2–3 pré-vendas | Bot envia em modo teste para caixas internas |
| 6 | 14–20/dez | **Nexo Gestão:** painel (funil, custos, caixa por bot), alertas, relatório diário, aprovações; WhatsApp oficial; Whisper; Economia dos Bots | Aprovar modelos de mensagem do WhatsApp na Meta; entregar os sites das pré-vendas | Painel mostra tudo; alertas chegam no celular |
| 7 | 21–31/dez | Testes completos, segurança (2FA), backups diários externos, limpeza LGPD, ajustes do treino | **Descanso no Natal**; treino final; nota média ≥ 4 | Checklist de lançamento 100% |
| 🚀 | **04/01/2027** | Lançamento controlado: 1 bot, 10–20 abordagens/dia | Supervisão 1–2h/dia: aprovar exceções, atender quem pede humano | 1ª abordagem real enviada |
| 8 | jan/2027 | Ajustes diários pelos resultados | Fechar os primeiros clientes | Taxa de resposta medida |
| 9 | fev/2027 | Modelos para clínicas médicas; versão simples do atendente de WhatsApp; volume 50+/dia | Coletar depoimentos dos fundadores | 1º cliente médico |
| 10 | mar–abr/2027 | Clones do Vendas (até 3); cadastro automático | Aprovar clones | 3 bots vendedores ativos |
| 11 | mai/2027+ | **Fase 2: micro-SaaS** (assinatura, banco da clínica, gestão e manutenção) | Migrar clientes para a assinatura | Clínica assina sozinha |

### Checklist de lançamento
- [ ] CNPJ ativo e emissão de nota fiscal
- [ ] Domínio + e-mail aquecido (2–4 semanas)
- [ ] Contrato, termos, privacidade e contrato de operador LGPD
- [ ] Conta de pagamento ativa (Pix/cartão, cobrança recorrente)
- [ ] Meta Business verificado + modelos de WhatsApp aprovados
- [ ] Google Places API com limite de gasto configurado
- [ ] Servidor (VPS) + backup diário externo
- [ ] 3 modelos vet aprovados (nota ≥ 4)
- [ ] Sentinela testado (mata e recria; pausa após 3 falhas)
- [ ] Limites de envio, descadastro e lista de "não contatar" testados
- [ ] Painel e alertas funcionando
- [ ] 2–3 clientes fundadores

## 10. Regras do projeto
1. Escopo da versão 1 **congelado**. Ideias novas vão para a lista da versão 2.
2. Nada de decisão de preço ou desconto sem humano.
3. Todo código testado (pytest + Playwright) e enviado ao GitHub.
4. Contratar só quando a receita recorrente pagar.
5. Este arquivo é atualizado a cada decisão.

## 11. Ideias para a versão 2
- Recepcionista de IA no WhatsApp completa
- Pagamentos com % por transação; planos pet por assinatura
- Outros nichos (dentistas, fisioterapia, estética, psicologia)
- App para tutores/pacientes
- Licenciar a máquina de bots para agências
