/* Cuidare Vila Mariana — tabela de preços (fonte única)
   ---------------------------------------------------------------
   Valores aprovados pela Cuidare em 14/10/2026 (mesmos do site anterior).
   O site mostra ao visitante SOMENTE o valor da configuração escolhida.

   - mensal: valor por mês. Segunda a sexta = 22 dias, segunda a sábado = 26 dias,
     todos os dias = 30 dias.
   - diaria: atendimento pontual, valor por diária.
   - null = sem valor validado. O site não inventa: encaminha para proposta personalizada.

   Para não publicar a tabela no navegador, use o modo "servidor"
   (config.js -> precos.modo) e veja docs/INTEGRACOES.md, seção 7. */
window.CUIDARE_PRECOS = {
  versao: '2026-10-14',
  validadeDias: 5,

  // Tipos de atendimento cobertos por esta tabela (a tabela é a mesma para todos).
  servicos: ['residencia', 'hospital', 'pos_operatorio', 'consultas'],

  mensal: {
    '6h':        { seg_sex: 3997, seg_sab: 4497, todos: 5197 },
    '8h':        { seg_sex: 4697, seg_sab: 5197, todos: 6197 },
    '12h_dia':   { seg_sex: 5697, seg_sab: 6297, todos: 6997 },
    // 12 horas noturno mensal: aguardando confirmação dos valores.
    '12h_noite': { seg_sex: null, seg_sab: null, todos: null }
  },

  diaria: {
    '6h': 219,
    '8h': 259,
    '12h_dia': 297,
    '12h_noite': 349
  }
};
