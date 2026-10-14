import { describe, expect, it } from "vitest";
import { computeRow, evaluate, FormulaError, parse, columnResolver, toDisplayFormula, toStoredFormula } from "../shared/formula.js";
import { parseNumberBR, sumMoney, parseDateBR, nameKey, prettyName } from "../shared/text.js";
import { coerceValue } from "../shared/columns.js";
import type { Column } from "../shared/types.js";

const cols: Column[] = [
  { id: "c1", name: "Qtd Plantões", type: "number" },
  { id: "c2", name: "Valor Plantão", type: "currency" },
  { id: "c3", name: "Faltas", type: "number" },
  { id: "c4", name: "Situação", type: "select", options: ["PAGO", "PENDENTE"] },
  { id: "c5", name: "Total", type: "formula", formula: "({c1}-{c3})*{c2}" },
];

const ev = (src: string, row: Record<string, unknown> = {}) => {
  const ast = parse(src, columnResolver(cols));
  return evaluate(ast, (id) => (row[id] ?? null) as never);
};

describe("motor de fórmulas", () => {
  it("respeita precedência e parênteses", () => {
    expect(ev("2+3*4")).toBe(14);
    expect(ev("(2+3)*4")).toBe(20);
    expect(ev("-2^2")).toBe(4); // como no Excel
    expect(ev("10%")).toBe(0.1);
  });

  it("não tem erro de arredondamento em dinheiro", () => {
    expect(ev("0.1+0.2")).toBe(0.3);
    expect(sumMoney([0.1, 0.2, 0.7])).toBe(1);
  });

  it("referencia colunas por nome ou id", () => {
    expect(ev("[Qtd Plantões] * [Valor Plantão]", { c1: 15, c2: 180 })).toBe(2700);
    expect(ev("{c1}*{c2}", { c1: 2, c2: 3.5 })).toBe(7);
  });

  it("dá #VALOR! ao fazer conta com texto (igual ao Excel)", () => {
    const v = ev("[Qtd Plantões] - [Situação]", { c1: 10, c4: "PENDENTE" });
    expect(v).toBeInstanceOf(FormulaError);
    expect((v as FormulaError).code).toBe("#VALOR!");
  });

  it("aceita números digitados como texto em português", () => {
    expect(ev("[Valor Plantão]*2", { c2: "R$ 1.200,50" })).toBe(2401);
  });

  it("divisão por zero", () => {
    expect((ev("1/0") as FormulaError).code).toBe("#DIV/0!");
  });

  it("funções em português e inglês", () => {
    expect(ev('SE([Faltas]>0;"com falta";"ok")', { c3: 1 })).toBe("com falta");
    expect(ev("SOMA(1;2;3)")).toBe(6);
    expect(ev("SUM(1,2,3)")).toBe(6);
    expect(ev("ARRED(2.345;2)")).toBe(2.35);
    expect(ev("SEERRO(1/0;0)")).toBe(0);
    expect(ev('CONCATENAR("a";"b")')).toBe("ab");
    expect(ev("MÁXIMO(1;9;3)")).toBe(9);
  });

  it("rejeita sintaxe inválida e funções desconhecidas", () => {
    expect(() => parse("2+", columnResolver(cols))).toThrow();
    expect(() => parse("DELETAR(1)", columnResolver(cols))).toThrow();
    expect(() => parse("[Coluna que não existe]", columnResolver(cols))).toThrow();
  });

  it("calcula coluna calculada e detecta ciclos", () => {
    expect(computeRow({ c1: 15, c2: 180, c3: 1 }, cols).c5).toBe(2520);
    const cyclic: Column[] = [
      { id: "a", name: "A", type: "formula", formula: "{b}+1" },
      { id: "b", name: "B", type: "formula", formula: "{a}+1" },
    ];
    expect((computeRow({}, cyclic).a as FormulaError).code).toBe("#CICLO!");
  });

  it("fórmula em célula individual", () => {
    expect(computeRow({ c1: 3, c2: "={c1}*10" }, cols).c2).toBe(30);
  });

  it("converte entre formato exibido e guardado", () => {
    const stored = toStoredFormula("=[Qtd Plantões] * [Valor Plantão]", cols);
    expect(stored).toBe("{c1} * {c2}");
    expect(toDisplayFormula(stored, cols)).toBe("[Qtd Plantões] * [Valor Plantão]");
  });
});

describe("textos, números e datas", () => {
  it("lê números no formato brasileiro", () => {
    expect(parseNumberBR("1.234,56")).toBe(1234.56);
    expect(parseNumberBR("R$ 350,00")).toBe(350);
    expect(parseNumberBR("350")).toBe(350);
    expect(parseNumberBR("1.200")).toBe(1200);
    expect(parseNumberBR("12.5")).toBe(12.5);
    expect(parseNumberBR("-10,5")).toBe(-10.5);
    expect(parseNumberBR("abc")).toBeNull();
    expect(parseNumberBR("130 8hs")).toBeNull();
  });

  it("lê datas", () => {
    expect(parseDateBR("12/10/2026")).toBe("2026-10-12");
    expect(parseDateBR("12/10", 2025)).toBe("2025-10-12");
    expect(parseDateBR("31/02/2026")).toBeNull();
  });

  it("normaliza nomes de clientes", () => {
    expect(nameKey("Sr. Dinaldo")).toBe("dinaldo");
    expect(nameKey("MARIA JOSÉ (ZEZE)")).toBe(nameKey("Maria José - zeze"));
    expect(prettyName("MARIA DA SILVA")).toBe("Maria da Silva");
  });

  it("valida valores por tipo de coluna", () => {
    expect(coerceValue(cols[1], "R$ 350")).toEqual({ ok: true, value: 350 });
    expect(coerceValue(cols[1], "trezentos").ok).toBe(false);
    expect(coerceValue(cols[3], "pago")).toEqual({ ok: true, value: "PAGO" });
    expect(coerceValue(cols[3], "talvez").ok).toBe(false);
    expect(coerceValue(cols[4], 1).ok).toBe(false);
    expect(coerceValue({ id: "d", name: "Data", type: "date" }, "05/10/2026")).toEqual({ ok: true, value: "2026-10-05" });
  });
});
