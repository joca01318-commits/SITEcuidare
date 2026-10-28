/* Cuidare Vila Mariana — tabela de preços (fonte única)
   ---------------------------------------------------------------
   Valores enviados pela Cuidare em 28/10/2026: Planos Mensais e Planos Diários (avulsos).
   O site mostra a tabela do plano escolhido.

   - mensal: valor por mês. Segunda a sexta = 22 plantões, segunda a sábado = 26 plantões,
     segunda a segunda (todos os dias) = 30 plantões.
   - diaria: valor por dia de segunda a sexta (Planos Diários).
   - diariaFds: valor por dia em sábados, domingos e feriados (Planos Diários).
   Cada plano mostra a sua tabela completa (6h, 8h, 12h diurnas, 12h noturnas e 24h).
   - null = sem valor validado. O site não inventa: encaminha para proposta personalizada.

   Para não publicar a tabela no navegador, use o modo "servidor"
   (config.js -> precos.modo) e veja docs/INTEGRACOES.md, seção 4. */
window.CUIDARE_PRECOS = {
  versao: '2026-10-28',
  validadeDias: 5,

  // Tipos de atendimento cobertos por esta tabela.
  servicos: ['residencia', 'consultas'], // Planos Mensais e Planos Diários

  mensal: {
    '6h':        { seg_sex: 4297,  seg_sab: 5097,  todos: 5797 },
    '8h':        { seg_sex: 4797,  seg_sab: 5697,  todos: 5997 },
    '12h_dia':   { seg_sex: 5497,  seg_sab: 6497,  todos: 6997 },
    '12h_noite': { seg_sex: 5897,  seg_sab: 6897,  todos: 7897 },
    '24h':       { seg_sex: 10897, seg_sab: 12897, todos: 14797 }
  },

  diaria: {
    '6h': 237,
    '8h': 267,
    '12h_dia': 297,
    '12h_noite': 317,
    '24h': 597
  },

  diariaFds: {
    '6h': 247,
    '8h': 277,
    '12h_dia': 317,
    '12h_noite': 337,
    '24h': 617
  }
};
