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

  // Fotos da página do valor (recortes das imagens de referência enviadas pela Cuidare).
  // Troque por fotos reais da equipe, com autorização de uso de imagem.
  fotosValor: {
    principal: 'assets/photos/cuidado-principal.webp',
    apoio: 'assets/photos/cuidado-apoio.webp'
  },

  // Fotos dos cartões de atendimento (recortes das imagens de referência enviadas pela Cuidare).
  // Troque por fotos reais da equipe, com autorização de uso de imagem (~900x700).
  // Deixe vazio ('') para usar a composição visual própria no lugar da foto.
  photos: {
    residencia: 'assets/photos/residencia.webp',
    hospital: 'assets/photos/hospital.webp',
    consultas: 'assets/photos/consultas.webp'
  }
};
