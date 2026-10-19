// Cuidare — valor da configuração escolhida, calculado no servidor (modo opcional).
//
// Use quando a tabela não deve ficar no código do navegador:
//  1. Publique por Git ou Netlify CLI (publicações por arrastar não incluem funções).
//  2. Em Project configuration -> Environment variables, crie CUIDARE_PRECOS com o
//     mesmo conteúdo de window.CUIDARE_PRECOS (assets/js/precos.js), em JSON.
//  3. Em assets/js/config.js: precos.modo = 'servidor'. Depois, apague precos.js do site.
// A resposta traz SOMENTE o valor da combinação pedida. Detalhes: docs/INTEGRACOES.md, seção 7.

const FREQ_DIAS = { seg_sex: 22, seg_sab: 26, todos: 30 };
// Hospital e consultas: tabela de diárias com as durações de cada atendimento. Residência: planos mensais.
const POR_DIARIA = {
  hospital: ['12h_dia', '12h_noite', '24h'],
  consultas: ['6h', '8h', '12h_dia', '12h_noite', '24h']
};
const ID = /^[a-z0-9_]{1,24}$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }
  });

// Mesmas regras de calcular() em assets/js/consulta.js.
export function calcular(tabela, a) {
  const diaria = Object.hasOwn(POR_DIARIA, a.servico || '');
  if (!a.servico || (!diaria && (!a.duracao || !a.frequencia))) return { status: 'incompleto' };
  if (!tabela) return { status: 'sob_consulta', motivo: 'indisponivel' };
  if (!(tabela.servicos || []).includes(a.servico)) return { status: 'sob_consulta', motivo: 'servico' };
  const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const r = { status: 'ok', versao: tabela.versao || '', validadeDias: tabela.validadeDias || 0 };
  if (diaria) {
    const linhas = [];
    for (const d of POR_DIARIA[a.servico]) {
      const util = tabela.diaria?.[d], fds = tabela.diariaFds?.[d];
      if (!ok(util)) continue;
      linhas.push(ok(fds) ? { duracao: d, valor: util, valorFds: fds } : { duracao: d, valor: util });
    }
    if (!linhas.length) return { status: 'sob_consulta', motivo: 'sem_preco' };
    r.modalidade = 'diaria'; r.linhas = linhas;
    return r;
  }
  if (a.duracao === 'nao_sei') return { status: 'sob_consulta', motivo: 'duracao' };
  const valor = tabela.mensal?.[a.duracao]?.[a.frequencia];
  if (!ok(valor)) return { status: 'sob_consulta', motivo: 'sem_preco' };
  r.modalidade = 'mensal'; r.valor = valor;
  if (FREQ_DIAS[a.frequencia]) r.dias = FREQ_DIAS[a.frequencia];
  const prof = tabela.profissionais?.[a.duracao]?.[a.frequencia];
  if (prof) r.profissionais = prof;
  return r;
}

export default async (req) => {
  if (req.method !== 'GET') return json({ erro: 'metodo_nao_permitido' }, 405);
  const raw = globalThis.Netlify?.env.get('CUIDARE_PRECOS') ?? process.env.CUIDARE_PRECOS;
  if (!raw) return json({ status: 'sob_consulta', motivo: 'indisponivel' }, 501);
  let tabela;
  try { tabela = JSON.parse(raw); } catch { return json({ status: 'sob_consulta', motivo: 'indisponivel' }, 500); }
  const q = new URL(req.url).searchParams;
  const a = {};
  for (const k of ['servico', 'duracao', 'frequencia']) {
    const v = q.get(k) || '';
    if (k !== 'servico' && Object.hasOwn(POR_DIARIA, a.servico)) continue; // tabela de diárias: só o atendimento
    if (!ID.test(v)) return json({ erro: 'parametro_invalido', campo: k }, 400);
    a[k] = v;
  }
  return json(calcular(tabela, a));
};

export const config = { path: '/api/preco' };
