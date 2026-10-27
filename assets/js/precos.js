/* Cuidare Vila Mariana — tabela de preços (fonte única)
   ---------------------------------------------------------------
   Valores da tabela "Planos Cuidare Vila Mariana" (valores da proposta da Cuidare Mogi das Cruzes,
   apresentação 2026-01), enviada pela Cuidare em 27/10/2026.
   O site mostra ao visitante SOMENTE o valor da configuração escolhida.

   - mensal: valor por mês. Segunda a sexta = 22 plantões, segunda a sábado = 26 plantões,
     segunda a segunda (todos os dias) = 30 plantões.
   - diaria: valor por dia de segunda a sexta (acompanhamento hospitalar e atendimento por dia).
   - diariaFds: valor por dia em sábados, domingos e feriados (mesmos atendimentos).
   Residência usa os planos mensais. Hospital e consultas mostram a tabela de diárias
   (hospital: 12h diurno, 12h noturno e 24h; consultas: 6h, 8h, 12h diurno, 12h noturno e 24h).
   - null = sem valor validado. O site não inventa: encaminha para proposta personalizada.

   Para não publicar a tabela no navegador, use o modo "servidor"
   (config.js -> precos.modo) e veja docs/INTEGRACOES.md, seção 4. */
window.CUIDARE_PRECOS = {
  versao: '2026-10-27',
  validadeDias: 5,

  // Tipos de atendimento cobertos por esta tabela.
  servicos: ['residencia', 'hospital', 'consultas'],

  mensal: {
    '6h':        { seg_sex: 3700, seg_sab: 4150,  todos: 4600 },
    '8h':        { seg_sex: 4600, seg_sab: 5100,  todos: 5850 },
    '12h_dia':   { seg_sex: 5500, seg_sab: 6200,  todos: 6700 },
    '12h_noite': { seg_sex: 5900, seg_sab: 6500,  todos: 6800 },
    '24h':       { seg_sex: 9900, seg_sab: 11700, todos: 13300 }
  },

  diaria: {
    '6h': 220,
    '8h': 250,
    '12h_dia': 280,
    '12h_noite': 290,
    '24h': 530
  },

  diariaFds: {
    '6h': 230,
    '8h': 260,
    '12h_dia': 290,
    '12h_noite': 300,
    '24h': 550
  }
};
