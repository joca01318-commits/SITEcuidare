// Cuidare — referência interna de precificação (somente servidor).
//
// NÃO é usada pelo site público. Serve para a equipe comercial consultar,
// de forma protegida, um valor de referência configurado pela própria empresa.
// Nenhum preço fica no código: as regras vêm da variável de ambiente PRICING_RULES.
// Ativação e formato: docs/INTEGRACOES.md, seção "Precificação no servidor".
import { timingSafeEqual } from 'node:crypto';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export default async (req) => {
  const token = Netlify.env.get('PRICING_ADMIN_TOKEN');
  const raw = Netlify.env.get('PRICING_RULES');
  if (!token || !raw) return json({ erro: 'precificacao_nao_configurada' }, 501);
  if (req.method !== 'POST') return json({ erro: 'metodo_nao_permitido' }, 405);
  if (!same(req.headers.get('authorization') || '', `Bearer ${token}`)) return json({ erro: 'nao_autorizado' }, 401);

  let rules;
  try { rules = JSON.parse(raw); } catch { return json({ erro: 'regras_invalidas' }, 500); }
  const body = await req.json().catch(() => null);
  if (!body || !body.duracao || !body.dias) return json({ erro: 'informe_duracao_e_dias' }, 400);

  const rule = rules?.itens?.[`${body.duracao}|${body.dias}`];
  if (!rule) return json({ encontrado: false, observacao: 'Sem regra para esta combinação. Definir na avaliação.' });
  return json({
    encontrado: true,
    referencia: rule,
    versao_regras: rules.versao || null,
    aviso: 'Valor de referência interno. A proposta final depende da avaliação e da disponibilidade.'
  });
};

export const config = { path: '/api/precificacao' };
