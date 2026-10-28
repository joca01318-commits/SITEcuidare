// Cuidare — valor da configuração escolhida, calculado no servidor (modo opcional).
//
// Use quando a tabela não deve ficar no código do navegador:
//  1. Publique por Git ou Netlify CLI (publicações por arrastar não incluem funções).
//  2. Em Project configuration -> Environment variables, crie CUIDARE_PRECOS com o
//     mesmo conteúdo de window.CUIDARE_PRECOS (assets/js/precos.js), em JSON.
//  3. Em assets/js/config.js: precos.modo = 'servidor'. Depois, apague precos.js do site.
// A resposta traz a tabela do plano pedido (?servico=residencia ou ?servico=consultas). Detalhes: docs/INTEGRACOES.md, seção 7.

// Mesmas regras de calcular() em assets/js/consulta.js: a tabela completa do plano pedido.
const PLANOS = {
  residencia: { modalidade: 'mensal', cols: ['seg_sex', 'seg_sab', 'todos'] },
  consultas: { modalidade: 'diaria', cols: ['util', 'fds'] }
};
const DURACOES = ['6h', '8h', '12h_dia', '12h_noite', '24h'];
const ID = /^[a-z0-9_]{1,24}$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

export function calcular(tabela, a) {
  const p = Object.hasOwn(PLANOS, a.servico || '') ? PLANOS[a.servico] : null;
  if (!p) return { status: 'incompleto' };
  if (!tabela) return { status: 'sob_consulta', motivo: 'indisponivel' };
  if (!(tabela.servicos || []).includes(a.servico)) return { status: 'sob_consulta', motivo: 'servico' };
  const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const linhas = [];
  for (const d of DURACOES) {
    const valores = p.cols.map((c) => {
      const v = p.modalidade === 'mensal' ? tabela.mensal?.[d]?.[c] : (c === 'fds' ? tabela.diariaFds : tabela.diaria)?.[d];
      return ok(v) ? v : null;
    });
    if (valores[0] !== null) linhas.push({ duracao: d, valores });
  }
  if (!linhas.length) return { status: 'sob_consulta', motivo: 'sem_preco' };
  return { status: 'ok', modalidade: p.modalidade, linhas, versao: tabela.versao || '', validadeDias: tabela.validadeDias || 0 };
}

export default async (req) => {
  if (req.method !== 'GET') return json({ erro: 'metodo_nao_permitido' }, 405);
  const raw = globalThis.Netlify?.env.get('CUIDARE_PRECOS') ?? process.env.CUIDARE_PRECOS;
  if (!raw) return json({ status: 'sob_consulta', motivo: 'indisponivel' }, 501);
  let tabela;
  try { tabela = JSON.parse(raw); } catch { return json({ status: 'sob_consulta', motivo: 'indisponivel' }, 500); }
  const servico = new URL(req.url).searchParams.get('servico') || '';
  if (!ID.test(servico)) return json({ erro: 'parametro_invalido', campo: 'servico' }, 400);
  const a = { servico };
  return json(calcular(tabela, a));
};

export const config = { path: '/api/preco' };
