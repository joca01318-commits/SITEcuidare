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

- Dois planos na página inicial: **Planos Mensais** e **Planos Diários** (o acompanhamento hospitalar
  e o pós-operatório foram retirados). Tocar em um plano abre direto a **tabela completa de valores**.
- Planos Mensais: durações nas linhas; segunda a sexta, segunda a sábado e todos os dias nas colunas.
- Planos Diários: durações nas linhas; segunda a sexta e sábados, domingos e feriados nas colunas.
- Na página da tabela, as abas trocam de plano sem voltar. A página `/detalhes/` repete a tabela.
- Sem valor validado, o site **não inventa**: a duração não aparece ou a célula mostra “Sob consulta”.
- Consultas antigas salvas no navegador (hospital, pós-operatório, etapas antigas) são descartadas.

## 3. Tabela de preços (`assets/js/precos.js`)

Valores enviados pela Cuidare em 28/10/2026.

**1. Planos Mensais**

| Plano | Segunda a sexta | Segunda a sábado | Todos os dias |
| --- | --- | --- | --- |
| 6 horas | R$ 4.297 | R$ 5.097 | R$ 5.797 |
| 8 horas | R$ 4.797 | R$ 5.697 | R$ 5.997 |
| 12 horas diurnas | R$ 5.497 | R$ 6.497 | R$ 6.997 |
| 12 horas noturnas | R$ 5.897 | R$ 6.897 | R$ 7.897 |
| 24 horas | R$ 10.897 | R$ 12.897 | R$ 14.797 |

**2. Planos Diários (avulsos)**

| Duração | Segunda a sexta | Sábados, domingos e feriados |
| --- | --- | --- |
| 6 horas | R$ 237 | R$ 247 |
| 8 horas | R$ 267 | R$ 277 |
| 12 horas diurnas | R$ 297 | R$ 317 |
| 12 horas noturnas | R$ 317 | R$ 337 |
| 24 horas | R$ 597 | R$ 617 |

- Planos Mensais (chave `residencia`) e Planos Diários (chave `consultas`) mostram as tabelas acima.
- O site não mostra número de profissionais por plano (a tabela não informa).
- Orçamento válido por 5 dias (texto mantido da proposta anterior; confirme).

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
(`?servico=residencia` ou `?servico=consultas`).
Se ela falhar, o site mostra proposta personalizada, sem inventar valor.

## 5. Medição (depende de conta)

Nada é carregado enquanto `analytics.gtmId` estiver vazio. Com o GTM preenchido, o site pede
consentimento e só então envia eventos `cuidare_*`: `cta_click`, `step_complete` (só duração e
frequência), `consulta_complete`, `price_view` e `details_view`.

**Nunca são enviados:** dados pessoais (o site não pede nenhum).

## 6. Fotos

**Cartões e página da tabela:** ilustrações dos planos (`assets/photos/planos-mensais.webp` e
`planos-diarios.webp`), recortadas das imagens enviadas pela Cuidare. Para trocar, substitua os arquivos.

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
| Durações dos planos (6h, 8h, 12h diurnas, 12h noturnas e 24h) | Tabelas | Valores enviados pela Cuidare. **Confirme que a operação atende todas** |

## 9. O que mudou em relação à versão anterior

- Três páginas: `/` (capa + consulta), `/valor/` (somente o valor escolhido), `/detalhes/` (resumo e detalhes do atendimento).
- Volta a exibir preço, **um por consulta**, a partir de uma tabela única.
- Visual escuro, azul e branco, com corações e esferas 3D em WebGL (versão leve em CSS nos aparelhos mais simples).
- Títulos em Baloo 2 e textos em Nunito (fontes arredondadas), abertura animada e entrada dos módulos em cascata.
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
- [ ] Planos Mensais e Planos Diários: tocar no cartão abre a tabela; as abas trocam de plano.
- [ ] Voltar do valor com o botão do celular: a consulta continua respondendo ao toque.
- [ ] Página 2 mostra só o valor escolhido; “Alterar minhas escolhas” funciona.
- [ ] Página 3: resumo confere, “Editar” leva à etapa certa e volta ao valor; “Voltar ao valor” funciona.
- [ ] Pendências de preço (seção 3) confirmadas.
- [ ] Aviso de privacidade revisado; depoimentos autorizados; link de avaliações atualizado.
- [ ] (Se usar) GTM configurado, aviso de consentimento aparecendo, eventos chegando.

## 11. Versão de 28/10/2026

- Botões da capa: “Planos / Investimentos” e “Quem Somos”; menu “Planos”, “Quem Somos”, “Depoimentos”.
- Dois planos (Mensais e Diários) com tabela direta, abas na página da tabela e ilustrações novas.
- Cartões e tabela com inclinação 3D e brilho (mouse, dedo e, no Android, inclinação do aparelho),
  botões com brilho, ícones animados. 3D liberado em mais celulares.
- Rolagem mais leve (sem desfoque nas animações) e cartões que não “fogem” do mouse ao rolar.
