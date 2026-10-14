/* Cuidare Vila Mariana — configuração do site
   ---------------------------------------------------------------
   Tudo o que depende de contas, credenciais ou conteúdo da empresa
   fica aqui. Veja docs/INTEGRACOES.md antes de alterar.
   Importante: este arquivo é público. NUNCA coloque aqui preços,
   tokens, chaves secretas ou regras comerciais confidenciais. */
window.CUIDARE_CONFIG = {
  // Endereço público final do site (usado em links de compartilhamento).
  siteUrl: 'https://cuidare-vila-marianaportifolio03.netlify.app',

  // WhatsApp comercial (mesmo número do site anterior).
  whatsapp: {
    number: '5511916349800',
    display: '(11) 91634-9800'
  },

  // Para onde vão as solicitações de avaliação.
  //  mode: 'netlify'  -> Netlify Forms (precisa ativar "Form detection" no Netlify)
  //        'webhook'  -> envia JSON para webhookUrl (ex.: CRM, Make, Zapier)
  //        'both'     -> os dois
  lead: {
    mode: 'netlify',
    formName: 'avaliacao',
    webhookUrl: '',
    timeoutMs: 15000
  },

  // Medição. Vazio = nenhuma ferramenta de análise é carregada
  // e nenhum aviso de cookies é exibido.
  analytics: {
    gtmId: '' // ex.: 'GTM-ABC1234'
  },

  // Link "Ver avaliações públicas". Troque pelo link exato do perfil no Google.
  reviewsUrl: 'https://www.google.com/maps/search/?api=1&query=Cuidare%20Vila%20Mariana',

  // Fotos reais (com autorização de uso de imagem). Caminho relativo à raiz do site.
  // Enquanto vazio, o site usa a composição visual própria no lugar da foto.
  photos: {
    hero: '',        // ex.: 'assets/photos/hero.webp'  (retrato, ~1200x1500)
    domicilio: '',   // ex.: 'assets/photos/domicilio.webp' (~900x1200)
    hospital: '',
    consultas: '',
    viagens: ''
  }
};
