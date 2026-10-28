/* Cuidare Vila Mariana — configuração do site
   ---------------------------------------------------------------
   Tudo o que depende de contas, credenciais ou conteúdo da empresa
   fica aqui. Veja docs/INTEGRACOES.md antes de alterar.
   Este arquivo é público: nunca coloque aqui tokens ou chaves secretas.
   Os preços ficam em precos.js (ou no servidor, no modo "servidor"). */
window.CUIDARE_CONFIG = {
  // Endereço público final do site (usado em links de compartilhamento).
  siteUrl: 'https://cuidare-vila-marianaportifolio03.netlify.app',

  // De onde vem o valor exibido na página 2.
  //  modo: 'local'    -> tabela em assets/js/precos.js (funciona em qualquer publicação)
  //        'servidor' -> função netlify/functions/preco.mjs (tabela fora do navegador)
  precos: {
    modo: 'local',
    endpoint: '/api/preco',
    timeoutMs: 8000
  },

  // Medição. Vazio = nenhuma ferramenta de análise é carregada
  // e nenhum aviso de cookies é exibido.
  analytics: {
    gtmId: '' // ex.: 'GTM-ABC1234'
  },

  // Link "Ver avaliações públicas". Troque pelo link exato do perfil no Google.
  reviewsUrl: 'https://www.google.com/maps/search/?api=1&query=Cuidare%20Vila%20Mariana',

  // Ilustrações dos planos (cartões da página inicial, página do valor e detalhes).
  // Para trocar, substitua os arquivos (~800x800) ou altere os caminhos.
  photos: {
    residencia: 'assets/photos/planos-mensais.webp',
    consultas: 'assets/photos/planos-diarios.webp'
  }
};
