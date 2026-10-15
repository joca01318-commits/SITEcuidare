/* Cuidare Vila Mariana — configuração do site
   ---------------------------------------------------------------
   Tudo o que depende de contas, credenciais ou conteúdo da empresa
   fica aqui. Veja docs/INTEGRACOES.md antes de alterar.
   Este arquivo é público: nunca coloque aqui tokens ou chaves secretas.
   Os preços ficam em precos.js (ou no servidor, no modo "servidor"). */
window.CUIDARE_CONFIG = {
  // Endereço público final do site (usado em links de compartilhamento).
  siteUrl: 'https://cuidare-vila-marianaportifolio03.netlify.app',

  // WhatsApp comercial (mesmo número do site anterior).
  whatsapp: {
    number: '5511916349800',
    display: '(11) 91634-9800'
  },

  // De onde vem o valor exibido na página 2.
  //  modo: 'local'    -> tabela em assets/js/precos.js (funciona em qualquer publicação)
  //        'servidor' -> função netlify/functions/preco.mjs (tabela fora do navegador)
  precos: {
    modo: 'local',
    endpoint: '/api/preco',
    timeoutMs: 8000
  },

  // Registro das solicitações (além da conversa no WhatsApp).
  //  mode: 'netlify'  -> Netlify Forms (precisa ativar "Form detection" no Netlify)
  //        'webhook'  -> envia JSON para webhookUrl (ex.: CRM, Make, Zapier)
  //        'both'     -> os dois
  //        'off'      -> só WhatsApp
  lead: {
    mode: 'netlify',
    formName: 'consulta',
    webhookUrl: '',
    timeoutMs: 12000
  },

  // Medição. Vazio = nenhuma ferramenta de análise é carregada
  // e nenhum aviso de cookies é exibido.
  analytics: {
    gtmId: '' // ex.: 'GTM-ABC1234'
  },

  // Link "Ver avaliações públicas". Troque pelo link exato do perfil no Google.
  reviewsUrl: 'https://www.google.com/maps/search/?api=1&query=Cuidare%20Vila%20Mariana',

  // Fotos reais (com autorização de uso de imagem). Caminho relativo à raiz do site.
  // Enquanto vazio, cada cartão usa a composição visual própria no lugar da foto.
  photos: {
    residencia: '',      // ex.: 'assets/photos/residencia.webp' (~900x700)
    hospital: '',
    pos_operatorio: '',
    consultas: ''
  }
};
