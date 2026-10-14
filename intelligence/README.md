# Cuidare Intelligence

Sistema interno da Cuidare para guardar, organizar, editar e compartilhar as planilhas da empresa, com uma
assistente que entende pedidos em português ("abra a planilha de outubro do seu Dinaldo", "quanto esse
cliente pagou este ano?", "adicione um pagamento de R$ 350 no dia 12") e faz as alterações depois que você
confirma.

O site institucional (pasta raiz do repositório) não foi alterado. Este projeto é independente e fica em
`intelligence/`.

---

## O que já funciona

| Área | O que faz |
| --- | --- |
| **Acesso** | Link próprio → tela de **código de acesso** → cada pessoa cria o **seu login** (nome, e-mail, senha). Códigos com validade, limite de usos e revogação. Perfis Administrador / Editor / Leitura e acesso restrito a clientes específicos. |
| **Painel** | Clientes, planilhas, linhas e pagamentos do período (somente com dados reais), pendências, abertas recentemente, clientes acessados, atividade recente e atalhos. |
| **Planilhas** | Organização por cliente, mês, ano e categoria; busca; filtros; ordenação; lista ou grade; favoritas; lixeira (30 dias); formato de origem (XLSX/CSV); renomear, duplicar, exportar, excluir. |
| **Importação** | Excel (.xlsx) e CSV. Cada aba vira uma planilha. Detecta cabeçalho, tipos de coluna, listas suspensas, mês pela aba, coluna de cliente ("Assistido"), dados sensíveis (PIX) e mantém fórmulas da mesma linha. Mostra uma revisão antes e avisa **tudo** o que não pôde ser preservado. O arquivo original fica guardado. |
| **Editor** | Grade estilo Excel: editar com teclado, copiar e colar (inclusive do Excel), desfazer (Ctrl+Z), seleção com soma, ordenar, filtrar por valores, pesquisar, renomear/configurar/inserir/excluir colunas, colunas calculadas, totais, inserir/excluir linhas. Salva sozinho ("Salvando…", "Salvo", "Erro ao salvar"). |
| **Sem perder dados** | Se a internet cair, as alterações ficam no aparelho e são enviadas quando ela voltar. Controle de concorrência **por célula**: ninguém sobrescreve em silêncio o trabalho de outra pessoa. Mudanças de colegas aparecem na hora (tempo real). |
| **Histórico e versões** | Toda alteração registra quem, quando, onde (tela, importação ou assistente), o valor anterior e o novo. Versões automáticas antes de importações, ações da assistente, exclusões e a cada sessão de edição. Restaurar gera nova versão; o histórico não pode ser apagado (bloqueado no próprio banco). |
| **Compartilhar e exportar** | Link copiável que só abre para quem está logado e tem permissão. Exportação em Excel (com fórmulas reais, listas e totais) e PDF pronto para imprimir (título, cliente, período, filtros, quem exportou, páginas numeradas). |
| **Assistente** | Botão flutuante e página própria, com histórico de conversas, sugestões, tabelas, botões para abrir planilhas/baixar arquivos, confirmação antes de alterar e botão **Desfazer**. |
| **Celular** | Navegação inferior, linhas em cartões, edição em formulário, assistente em tela cheia. |

## A assistente e o custo zero

A prioridade foi custo **R$ 0**. A assistente tem duas camadas:

1. **Motor próprio (padrão, sempre ligado).** Entende em português os pedidos do dia a dia: abrir planilhas,
   encontrar clientes (aceita "seu", "dona", apelidos e erros de digitação), somar, listar pendências,
   adicionar, alterar e excluir lançamentos, criar a planilha do mês seguinte, exportar, mostrar histórico,
   restaurar versões e desfazer. Quando há mais de uma possibilidade, ele pergunta. **Não custa nada, funciona
   sem internet e nenhum dado sai do servidor.** Com o arquivo real de pagamentos, as somas conferem centavo
   por centavo com o Excel.
2. **Modelo de linguagem (opcional).** Para pedidos fora do comum, dá para ligar um modelo compatível com a
   API da OpenAI. As opções gratuitas reais são:
   - **Ollama (recomendado se houver um computador com 16 GB de RAM):** roda um modelo aberto (ex.:
     `qwen2.5:7b`) no próprio servidor. Sem custo por uso e sem enviar dados para fora. Responde em 5 a 30 s
     no processador; com placa de vídeo, mais rápido.
   - **Groq (camada gratuita):** rápido e com bons modelos, mas tem limite de uso por minuto/dia e os dados
     vão para os EUA. O sistema **nunca envia colunas sensíveis** (PIX, CPF, telefone…) para provedores
     externos e manda só as linhas necessárias, mas avalie a LGPD antes de usar.
   - Não recomendamos a camada gratuita do Gemini para dados de clientes: nela o Google pode usar o
     conteúdo para melhorar os produtos.

Não há garantia de IA gratuita e ilimitada de terceiros. Por isso o motor próprio continua respondendo se
o provedor externo cair ou atingir o limite.

**Regras de segurança da IA:** o modelo nunca acessa o banco nem roda SQL. Ele só pode chamar 12
ferramentas controladas (`search_clients`, `search_spreadsheets`, `get_spreadsheet`, `query_records`,
`calculate_totals`, `create_spreadsheet`, `add_record`, `update_record`, `delete_record`,
`export_spreadsheet`, `get_change_history`, `restore_previous_version`). Cada uma valida parâmetros,
checa permissões, limita os dados e registra na auditoria. **Toda alteração vira uma proposta que só é
executada depois que o usuário clica em Confirmar.** Somas e cálculos são feitos pelo sistema, em
centavos, e nunca pelo modelo.

Configuração (arquivo `.env`, veja `.env.example`):

```
AI_MODE=rules        # rules | hybrid | llm
AI_BASE_URL=http://127.0.0.1:11434/v1
AI_MODEL=qwen2.5:7b
AI_PROVIDER_LOCAL=true
```

## Arquitetura

```
web/      Interface em React + TypeScript (Vite). CSS próprio com a identidade da Cuidare.
server/   API em TypeScript (Fastify), autenticação, regras de negócio, importação/exportação e IA.
shared/   Código usado pelos dois lados: tipos, motor de fórmulas, validação e formatação em pt-BR.
tests/    Testes automáticos (Vitest) e teste no navegador (Playwright).
```

- **Banco de dados próprio:** SQLite embutido no Node (o banco mais testado do mundo, escrito em C), em
  modo WAL, com chaves estrangeiras, índices, transações, busca de texto completo (FTS5) e gatilhos que
  impedem alterar o histórico de auditoria. É um arquivo no servidor (`DATA_DIR/cuidare.sqlite`): não
  depende de nenhum serviço externo nem tem mensalidade.
- **Motor de fórmulas próprio** (`shared/formula.ts`): tokenizador, parser e avaliador, sem `eval`.
  Funções em português e inglês (SOMA/SUM, SE/IF, ARRED, MÍNIMO, MÁXIMO, MÉDIA, SEERRO…). Mantém o
  comportamento do Excel (texto em conta dá `#VALOR!`), detecta referências circulares e roda tanto no
  servidor quanto no navegador.
- **Sobre C++:** as partes que precisam de máximo desempenho já são em C/C++ e muito maduras: o SQLite
  (C) e, se usar IA local, o llama.cpp (C++) dentro do Ollama. Escrever um banco ou um modelo do zero
  em C++ deixaria o sistema mais lento e menos seguro. A "inteligência" vem do modelo e das ferramentas
  controladas, não da linguagem do código.

Tabelas principais: `users`, `organizations`, `clients`, `spreadsheets`, `records`, `files`, `versions`,
`audit_events`, `conversations`, `messages`, `pending_actions`, `invites`, `sessions`, `user_client_access`.

## Segurança e LGPD

- Senhas com scrypt; códigos de acesso guardados como HMAC com chave fora do banco (`DATA_DIR/secret.key`).
- Sessões individuais em cookie `HttpOnly`/`Secure`/`SameSite`, expiração por inatividade, troca de senha
  encerra as outras sessões.
- Limite de tentativas no código de acesso e no login, bloqueio temporário da conta.
- Proteção contra CSRF (cabeçalho próprio + verificação de origem), cabeçalhos de segurança (CSP, HSTS,
  `nosniff`, `frame-ancestors 'none'`), validação de todas as entradas, identificadores não sequenciais.
- Permissões por perfil e por cliente aplicadas no servidor (linhas de outros clientes nem chegam ao
  navegador). Perfil de leitura não vê dados sensíveis.
- Dados sensíveis nunca vão para IA externa. Links compartilhados exigem login.
- Backups automáticos (`VACUUM INTO`) com retenção configurável; lixeira de 30 dias; sessões e tentativas
  antigas são limpas automaticamente; registro de falhas no log do servidor.

## Instalação

Requisitos: Node.js 22.13 ou mais novo.

```bash
cd intelligence
npm ci
cp .env.example .env          # ajuste APP_ORIGIN e, em produção, mantenha COOKIE_SECURE=true
npm run build
npm run invite -- --admin     # mostra o primeiro código de acesso (administrador)
npm start                     # http://localhost:8787
```

Para um código fixo escolhido por vocês: `npm run invite -- --admin --code "CUIDARE-2026-XYZ"`.
Os outros códigos são criados na tela **Administração**.

Desenvolvimento: `npm run dev` (interface em http://localhost:5173 com recarga automática).
Com Docker: `docker compose up -d` e `docker compose exec app npm run invite -- --admin`.

### Onde hospedar (custo zero ou baixo)

O sistema precisa de um servidor Node.js com disco (para o banco). **O Netlify, onde está o site, não
serve para esta parte** (ele só hospeda páginas estáticas e funções sem disco).

1. **Computador da empresa + Cloudflare Tunnel (R$ 0):** o sistema roda num PC ligado no escritório e o
   túnel gratuito da Cloudflare cria um endereço HTTPS (ex.: `planilhas.cuidare.com.br`) sem abrir portas
   no roteador. Os dados ficam com vocês.
2. **Oracle Cloud "Always Free" (R$ 0):** máquina virtual gratuita com até 24 GB de RAM, suficiente
   inclusive para IA local com Ollama. Às vezes há falta de vagas na região.
3. **VPS simples (cerca de R$ 25–40/mês)** se preferirem não depender das opções gratuitas.

Em qualquer caso, faça cópia da pasta `DATA_DIR` (banco, arquivos e backups) para outro lugar com
frequência.

## Testes

```bash
npm test          # 56 testes: fórmulas, cálculos, importação, permissões, concorrência, IA, segurança da API
npm run e2e       # teste no navegador: 16 etapas, do código de acesso ao celular
npm run typecheck
```

Os testes usam apenas dados fictícios (`tests/fixtures.ts`). O teste no navegador cobre: entrar com
código, cadastrar cliente, importar, abrir a planilha de um cliente pela assistente, consultar total
mensal, adicionar pagamento com confirmação, totais atualizados, editar célula, dados após recarregar,
criar planilha baseada em outra, exportar Excel e PDF, histórico, restaurar versão, bloqueio sem login e
sem permissão (inclusive CSRF e dados sensíveis) e uso no celular sem rolagem lateral.

## Limitações conhecidas

- Fórmulas que usam outras abas ou intervalos (ex.: `SUMIF('Outra aba'!C:C,…)`) são importadas como o
  último valor calculado pelo Excel, com aviso. Os totais e fechamentos passam a ser feitos pelo sistema
  (totais da grade e perguntas à assistente).
- Cores, fontes e formatação condicional do Excel não são importadas.
- Arquivos `.xls` (Excel 97-2003) precisam ser salvos como `.xlsx` antes.
- O motor próprio cobre os pedidos comuns. Pedidos muito livres funcionam melhor com um modelo de
  linguagem ligado (modo `hybrid`).
- Uma única instância do servidor (adequado para uso interno; o banco aguenta milhares de planilhas).
