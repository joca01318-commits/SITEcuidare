/* Cuidare Vila Mariana — tabela de preços (fonte única)
   ---------------------------------------------------------------
   Valores do "Orçamento de serviço de cuidadores de pessoas" (Proposta Personalizada
   de Cuidados, valores 2026), enviado pela Cuidare em 19/10/2026.
   O site mostra ao visitante SOMENTE o valor da configuração escolhida.

   - mensal: valor por mês. Segunda a sexta = 22 plantões, segunda a sábado = 26 plantões,
     segunda a segunda (todos os dias) = 30 plantões.
   - profissionais: quantos profissionais atendem cada plano mensal.
   - diaria: valor por diária de segunda a sexta (acompanhamento hospitalar e consultas e exames).
   - diariaFds: valor por diária em sábados, domingos e feriados (mesmos atendimentos).
   Residência e pós-operatório usam os planos mensais.
   - null = sem valor validado. O site não inventa: encaminha para proposta personalizada.

   Para não publicar a tabela no navegador, use o modo "servidor"
   (config.js -> precos.modo) e veja docs/INTEGRACOES.md, seção 4. */
window.CUIDARE_PRECOS = {
  versao: '2026-10-19',
  validadeDias: 5,

  // Tipos de atendimento cobertos por esta tabela (a tabela é a mesma para todos).
  servicos: ['residencia', 'hospital', 'pos_operatorio', 'consultas'],

  mensal: {
    '6h':        { seg_sex: 4767,  seg_sab: 5637,  todos: 6507 },
    '8h':        { seg_sex: 5137,  seg_sab: 6067,  todos: 7007 },
    '12h_dia':   { seg_sex: 5867,  seg_sab: 6937,  todos: 8007 },
    '12h_noite': { seg_sex: 6057,  seg_sab: 7157,  todos: 8257 },
    '24h':       { seg_sex: 10837, seg_sab: 12807, todos: 14777 }
  },

  profissionais: {
    '6h':        { seg_sex: 1, seg_sab: 2, todos: 2 },
    '8h':        { seg_sex: 1, seg_sab: 2, todos: 2 },
    '12h_dia':   { seg_sex: 2, seg_sab: 2, todos: 2 },
    '12h_noite': { seg_sex: 2, seg_sab: 2, todos: 2 },
    '24h':       { seg_sex: 2, seg_sab: 3, todos: 4 }
  },

  diaria: {
    '6h': 237,
    '8h': 257,
    '12h_dia': 297,
    '12h_noite': 307,
    '24h': 587
  },

  diariaFds: {
    '6h': 247,
    '8h': 267,
    '12h_dia': 307,
    '12h_noite': 317,
    '24h': 597
  }
};
