"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { combina, erroMsg, fmtMoeda, fmtQtd } from "@/lib/formato";
import { Botao, Cabecalho, Vazio, avisar } from "@/components/ui";
import { Exige } from "@/components/perfil-contexto";
import { abrirImpressaoPedidos } from "@/lib/impressao";

type Periodo = "dia" | "semana" | "mes";
type Vend = { vendedor_id: string; nome: string; pedidos: number; clientes: number; itens: number; caixas: number; fardos: number; litros: number; unidades: number; valor: number };
type Prod = { vendedor_id: string; produto_id: string; produto: string; codigo: string | null; unidade: string; quantidade: number; valor: number; clientes: number };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const n = (v: unknown) => Number(v ?? 0);

/** Início e fim do período que contém a data "ref" */
function intervalo(p: Periodo, ref: Date): [Date, Date] {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  if (p === "dia") return [d, d];
  if (p === "semana") {
    const ini = new Date(d); ini.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const fim = new Date(ini); fim.setDate(ini.getDate() + 6);
    return [ini, fim];
  }
  return [new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 0)];
}
function titulo(p: Periodo, [ini, fim]: [Date, Date]) {
  if (p === "dia") return ini.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  if (p === "semana") return `${ini.toLocaleDateString("pt-BR")} a ${fim.toLocaleDateString("pt-BR")}`;
  const m = ini.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return m.charAt(0).toUpperCase() + m.slice(1);
}

export default function Vendedores() {
  const sb = supabaseNavegador();
  const [periodo, setPeriodo] = useState<Periodo>("dia");
  const [ref, setRef] = useState(() => new Date());
  const [vends, setVends] = useState<Vend[] | null>(null);
  const [prods, setProds] = useState<Prod[]>([]);
  const [busca, setBusca] = useState("");
  const [vendedor, setVendedor] = useState(""); // "" = todos

  const [ini, fim] = useMemo(() => intervalo(periodo, ref), [periodo, ref]);
  const atual = iso(intervalo(periodo, new Date())[0]) === iso(ini);

  useEffect(() => {
    setVends(null);
    sb.rpc("desempenho_vendedores", { p_inicio: iso(ini), p_fim: iso(fim) }).then(({ data, error }) => {
      if (error) { avisar(erroMsg(error), "erro"); setVends([]); return; }
      setVends((data?.vendedores ?? []) as Vend[]);
      setProds((data?.produtos ?? []) as Prod[]);
    });
  }, [sb, ini, fim]);

  function mover(passo: number) {
    const d = new Date(ref);
    if (periodo === "dia") d.setDate(d.getDate() + passo);
    else if (periodo === "semana") d.setDate(d.getDate() + 7 * passo);
    else d.setMonth(d.getMonth() + passo, 1);
    setRef(d);
  }

  const lista = vends ?? [];
  const tot = lista.reduce((s, v) => ({
    pedidos: s.pedidos + n(v.pedidos), clientes: s.clientes + n(v.clientes), itens: s.itens + n(v.itens),
    caixas: s.caixas + n(v.caixas), fardos: s.fardos + n(v.fardos), litros: s.litros + n(v.litros), unidades: s.unidades + n(v.unidades), valor: s.valor + n(v.valor),
  }), { pedidos: 0, clientes: 0, itens: 0, caixas: 0, fardos: 0, litros: 0, unidades: 0, valor: 0 });
  const temUn = tot.unidades > 0;

  // Produtos: uma linha por produto, uma coluna por vendedor
  const vendsComVenda = lista.filter((v) => n(v.itens) > 0);
  const colunas = vendedor ? vendsComVenda.filter((v) => v.vendedor_id === vendedor) : vendsComVenda;
  const linhas = useMemo(() => {
    const m = new Map<string, { produto: string; codigo: string | null; unidade: string; por: Record<string, Prod>; qtd: number; valor: number; clientes: number }>();
    for (const p of prods) {
      if (vendedor && p.vendedor_id !== vendedor) continue;
      const l = m.get(p.produto_id) ?? { produto: p.produto, codigo: p.codigo, unidade: p.unidade, por: {}, qtd: 0, valor: 0, clientes: 0 };
      l.por[p.vendedor_id] = p; l.qtd += n(p.quantidade); l.valor += n(p.valor); l.clientes += n(p.clientes);
      m.set(p.produto_id, l);
    }
    let r = [...m.values()];
    if (busca.trim()) r = r.filter((l) => combina(`${l.produto} ${l.codigo ?? ""}`, busca));
    return r.sort((a, b) => b.qtd - a.qtd);
  }, [prods, vendedor, busca]);

  // imprime todos os pedidos do vendedor no período escolhido
  async function imprimirDoVendedor(v: Vend) {
    const { data, error } = await sb.from("pedidos").select("id")
      .eq("vendedor_id", v.vendedor_id).not("status", "in", "(cancelado,recusado)")
      .gte("feito_em", ini.toISOString()).lt("feito_em", new Date(fim.getFullYear(), fim.getMonth(), fim.getDate() + 1).toISOString())
      .order("numero").limit(2000);
    if (error) return avisar(erroMsg(error), "erro");
    if (!data?.length) return avisar(`${v.nome} não tem pedidos neste período.`, "erro");
    abrirImpressaoPedidos(data.map((p: { id: string }) => p.id));
  }

  const th = "px-3 py-2 font-semibold";
  const PERIODOS: [Periodo, string][] = [["dia", "Dia"], ["semana", "Semana"], ["mes", "Mês"]];

  return (
    <Exige admin>
      <Cabecalho titulo="Vendedores" sub={titulo(periodo, [ini, fim]) + (atual ? (periodo === "dia" ? " (hoje)" : periodo === "semana" ? " (esta semana)" : " (este mês)") : "")}>
        <div className="flex rounded-lg border border-zinc-300 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900" role="group" aria-label="Período">
          {PERIODOS.map(([k, t]) => (
            <button key={k} onClick={() => setPeriodo(k)} aria-pressed={periodo === k}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold ${periodo === k ? "bg-marca-500 text-white" : "text-zinc-600 dark:text-zinc-300"}`}>{t}</button>
          ))}
        </div>
        <Botao variante="secundario" onClick={() => mover(-1)} aria-label="Período anterior">←</Botao>
        <Botao variante="secundario" onClick={() => setRef(new Date())} disabled={atual}>{periodo === "dia" ? "Hoje" : periodo === "semana" ? "Esta semana" : "Este mês"}</Botao>
        <Botao variante="secundario" onClick={() => mover(1)} disabled={atual} aria-label="Próximo período">→</Botao>
      </Cabecalho>

      {vends === null ? <div className="cartao p-8 text-center text-zinc-500">Carregando…</div> : (
        <div className="space-y-6">
          {/* resumo por vendedor */}
          <section>
            <h2 className="titulo mb-2 text-lg">Por vendedor</h2>
            {lista.length === 0 ? <Vazio>Nenhum vendedor cadastrado.</Vazio> : (
              <div className="cartao overflow-x-auto">
                <table className="w-full text-[15px]">
                  <thead className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                    <tr>
                      <th className={th}>Vendedor</th><th className={`${th} text-right`}>Pedidos</th><th className={`${th} text-right`}>Clientes atendidos</th>
                      <th className={`${th} text-right`}>Caixas</th><th className={`${th} text-right`}>Fardos</th><th className={`${th} text-right`}>Litros</th>
                      {temUn && <th className={`${th} text-right`}>Unidades</th>}
                      <th className={`${th} text-right`}>Total de itens</th><th className={`${th} text-right`}>Valor vendido</th><th />
                    </tr>
                  </thead>
                  <tbody className="[&_td]:border-b [&_td]:border-zinc-100 [&_td]:px-3 [&_td]:py-2.5 dark:[&_td]:border-zinc-800">
                    {lista.map((v) => (
                      <tr key={v.vendedor_id} className={`${vendedor === v.vendedor_id ? "bg-marca-50 dark:bg-marca-500/10" : ""} ${n(v.itens) === 0 ? "text-zinc-400" : ""}`}>
                        <td className="font-semibold">{v.nome}</td>
                        <td className="text-right">{v.pedidos}</td>
                        <td className="text-right font-semibold">{v.clientes}</td>
                        <td className="text-right font-display text-lg font-bold">{fmtQtd(v.caixas)}</td>
                        <td className="text-right">{fmtQtd(v.fardos)}</td>
                        <td className="text-right">{fmtQtd(v.litros)}</td>
                        {temUn && <td className="text-right">{fmtQtd(v.unidades)}</td>}
                        <td className="text-right">{fmtQtd(v.itens)}</td>
                        <td className="text-right font-semibold whitespace-nowrap">{fmtMoeda(v.valor)}</td>
                        <td className="whitespace-nowrap text-right">
                          {n(v.itens) > 0 && <>
                            <Botao variante="fantasma" tamanho="p" onClick={() => setVendedor(vendedor === v.vendedor_id ? "" : v.vendedor_id)}>{vendedor === v.vendedor_id ? "Ver todos" : "Ver produtos"}</Botao>
                            <Botao variante="fantasma" tamanho="p" onClick={() => imprimirDoVendedor(v)} title={`Imprimir os ${v.pedidos} pedidos de ${v.nome} neste período`}>🖨 Pedidos</Botao>
                          </>}
                        </td>
                      </tr>
                    ))}
                    <tr className="font-bold [&_td]:border-0">
                      <td>Total</td><td className="text-right">{tot.pedidos}</td><td className="text-right">{tot.clientes}</td>
                      <td className="text-right font-display text-lg">{fmtQtd(tot.caixas)}</td><td className="text-right">{fmtQtd(tot.fardos)}</td><td className="text-right">{fmtQtd(tot.litros)}</td>
                      {temUn && <td className="text-right">{fmtQtd(tot.unidades)}</td>}
                      <td className="text-right">{fmtQtd(tot.itens)}</td><td className="text-right whitespace-nowrap">{fmtMoeda(tot.valor)}</td><td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-1 text-xs text-zinc-500">Clientes atendidos: clientes diferentes que compraram. No total, um cliente atendido por dois vendedores conta duas vezes. Não conta pedidos cancelados nem recusados.</p>
          </section>

          {/* por produto */}
          <section>
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <h2 className="titulo text-lg">Por produto</h2>
              <div className="flex flex-1 flex-wrap justify-end gap-2">
                <input className="campo max-w-sm" placeholder="🔍 Pesquisar produto (ex.: skol lata)" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Pesquisar produto" />
                <select className="campo w-auto!" value={vendedor} onChange={(e) => setVendedor(e.target.value)} aria-label="Vendedor">
                  <option value="">Todos os vendedores</option>
                  {vendsComVenda.map((v) => <option key={v.vendedor_id} value={v.vendedor_id}>{v.nome}</option>)}
                </select>
              </div>
            </div>
            {linhas.length === 0 ? <Vazio>{busca.trim() ? "Nenhum produto com esse nome foi vendido neste período." : "Nenhuma venda neste período."}</Vazio> : (
              <div className="cartao overflow-x-auto">
                <table className="w-full text-[15px]">
                  <thead className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                    <tr>
                      <th className={th}>Produto</th>
                      {colunas.map((v) => <th key={v.vendedor_id} className={`${th} text-right`}>{v.nome.split(" ")[0]}</th>)}
                      {!vendedor && colunas.length > 1 && <th className={`${th} text-right`}>Total</th>}
                      <th className={`${th} text-right`}>Clientes</th>
                      <th className={`${th} text-right`}>Valor</th>
                    </tr>
                  </thead>
                  <tbody className="[&_td]:border-b [&_td]:border-zinc-100 [&_td]:px-3 [&_td]:py-2 dark:[&_td]:border-zinc-800 [&_tr:last-child_td]:border-0">
                    {linhas.map((l) => (
                      <tr key={l.produto}>
                        <td><span className="font-medium">{l.produto}</span>{l.codigo && <span className="ml-1 text-xs text-zinc-400">{l.codigo}</span>}</td>
                        {colunas.map((v) => {
                          const p = l.por[v.vendedor_id];
                          return (
                            <td key={v.vendedor_id} className="text-right whitespace-nowrap" title={p ? `${fmtMoeda(p.valor)} · ${p.clientes} cliente(s)` : undefined}>
                              {p ? <><b>{fmtQtd(p.quantidade)}</b> <span className="text-xs text-zinc-500">{l.unidade}</span></> : <span className="text-zinc-300 dark:text-zinc-600">—</span>}
                            </td>
                          );
                        })}
                        {!vendedor && colunas.length > 1 && <td className="text-right font-bold whitespace-nowrap">{fmtQtd(l.qtd)} <span className="text-xs font-normal text-zinc-500">{l.unidade}</span></td>}
                        <td className="text-right">{l.clientes}</td>
                        <td className="text-right whitespace-nowrap">{fmtMoeda(l.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-1 text-xs text-zinc-500">Passe o mouse sobre a quantidade para ver o valor e quantos clientes compraram aquele produto daquele vendedor.</p>
          </section>
        </div>
      )}
    </Exige>
  );
}
