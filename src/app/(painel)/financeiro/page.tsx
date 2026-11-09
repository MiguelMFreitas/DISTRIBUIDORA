"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg, fmtData, fmtDataHora, fmtMoeda, fmtQtd } from "@/lib/formato";
import { Botao, Cabecalho, Vazio, avisar } from "@/components/ui";
import { Exige } from "@/components/perfil-contexto";

type Resumo = {
  pedidos: number; clientes: number; vendas_bruto: number; descontos: number; vendas_liquido: number; custo_vendido: number;
  devolucoes: number; compras: number; descontos_compra: number; saidas_manuais: number; itens_sem_custo: number; recebimentos?: number;
};
type Rel = {
  resumo: Resumo;
  por_dia: { dia: string; pedidos: number; vendas: number; descontos: number; compras: number }[];
  pedidos: { id: string; numero: number; feito_em: string; cliente: string; vendedor: string | null; observacao: string | null; bruto: number; desconto: number; liquido: number; maior_desconto: number }[];
  produtos: { produto: string; unidade: string; quantidade: number; faturamento: number; custo: number; lucro: number; descontos: number; sem_custo: boolean }[];
  entradas: { criado_em: string; produto: string; unidade: string; quantidade: number; valor_unit: number | null; desconto: number; valor_total: number | null; observacao: string | null; usuario: string | null }[];
  saidas: { criado_em: string; produto: string; unidade: string; quantidade: number; valor_unit: number | null; valor_total: number | null; motivo: string | null; observacao: string | null; usuario: string | null }[];
  recibos?: { numero: number; data: string; valor: number; recebemos_de: string; referente: string | null; observacao: string | null; usuario: string | null }[];
  devolucoes: { criado_em: string; produto: string; unidade: string; quantidade: number; valor_unit: number | null; valor_total: number | null; observacao: string | null; usuario: string | null }[];
};

function segunda(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const pct = (a: number, b: number) => (b ? `${(Math.round((a / b) * 1000) / 10).toLocaleString("pt-BR")}%` : "—");
const n = (v: unknown) => Number(v ?? 0);

function Bloco({ titulo, valor, sub, tom }: { titulo: string; valor: string; sub?: React.ReactNode; tom?: "bom" | "ruim" | "aviso" }) {
  const cor = tom === "bom" ? "text-emerald-700 dark:text-emerald-400" : tom === "ruim" ? "text-red-600 dark:text-red-400" : tom === "aviso" ? "text-amber-700 dark:text-amber-400" : "";
  return (
    <div className="cartao p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{titulo}</div>
      <div className={`mt-1 font-display text-3xl font-bold ${cor}`}>{valor}</div>
      {sub && <div className="text-sm text-zinc-500">{sub}</div>}
    </div>
  );
}

function Tabela({ titulo, sub, cab, children, vazio }: { titulo: string; sub?: string; cab: React.ReactNode; children: React.ReactNode; vazio: boolean }) {
  return (
    <section className="break-inside-avoid-page">
      <h2 className="titulo text-lg">{titulo}</h2>
      {sub && <p className="mb-2 text-sm text-zinc-500">{sub}</p>}
      {vazio ? <Vazio>Nada nesta semana.</Vazio> : (
        <div className="cartao overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">{cab}</thead>
            <tbody className="[&_td]:border-b [&_td]:border-zinc-100 [&_td]:px-3 [&_td]:py-2 dark:[&_td]:border-zinc-800 [&_tr:last-child_td]:border-0">{children}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
const th = "px-3 py-2 font-semibold";

export default function Financeiro() {
  const sb = supabaseNavegador();
  const [inicio, setInicio] = useState(() => segunda(new Date()));
  const [rel, setRel] = useState<Rel | null>(null);
  const fim = useMemo(() => { const f = new Date(inicio); f.setDate(f.getDate() + 6); return f; }, [inicio]);
  const estaSemana = iso(inicio) === iso(segunda(new Date()));

  useEffect(() => {
    setRel(null);
    sb.rpc("relatorio_financeiro", { p_inicio: iso(inicio), p_fim: iso(fim) }).then(({ data, error }) => {
      if (error) return avisar(erroMsg(error), "erro");
      setRel(data as Rel);
    });
  }, [sb, inicio, fim]);

  const mudar = (dias: number) => setInicio((d) => { const x = new Date(d); x.setDate(x.getDate() + dias); return x; });

  const r = rel?.resumo;
  const lucro = r ? n(r.vendas_liquido) - n(r.custo_vendido) - n(r.saidas_manuais) : 0;
  const maxDia = rel ? Math.max(1, ...rel.por_dia.map((d) => Math.max(n(d.vendas), n(d.compras)))) : 1;

  return (
    <Exige perm="financeiro">
      <Cabecalho titulo="Financeiro semanal" sub={`${fmtData(iso(inicio))} a ${fmtData(iso(fim))}${estaSemana ? " (esta semana)" : ""}`}>
        <span className="nao-imprimir flex flex-wrap gap-2">
          <Botao variante="secundario" onClick={() => mudar(-7)}>← Semana anterior</Botao>
          <Botao variante="secundario" onClick={() => mudar(7)} disabled={estaSemana}>Próxima →</Botao>
          <Botao onClick={() => window.print()} disabled={!rel}>🖨 Imprimir / PDF</Botao>
        </span>
      </Cabecalho>

      {!rel || !r ? <div className="cartao p-8 text-center text-zinc-500">Carregando…</div> : (
        <div className="space-y-6">
          {n(r.itens_sem_custo) > 0 && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              {r.itens_sem_custo} item(ns) vendido(s) nesta semana estavam sem custo cadastrado. Para esses itens, o lucro aparece maior do que o real. Lance as entradas com o valor de compra, ou coloque o custo no cadastro do produto.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <Bloco titulo="Vendas" valor={fmtMoeda(r.vendas_liquido)} sub={`${r.pedidos} pedidos · ${r.clientes} clientes`} />
            <Bloco titulo="Descontos dados" valor={fmtMoeda(r.descontos)} sub={`${pct(n(r.descontos), n(r.vendas_bruto))} da tabela (${fmtMoeda(r.vendas_bruto)})`} tom={n(r.descontos) > 0 ? "aviso" : undefined} />
            <Bloco titulo="Custo do que vendeu" valor={fmtMoeda(r.custo_vendido)} />
            <Bloco titulo="Lucro estimado" valor={fmtMoeda(lucro)} sub={`margem ${pct(lucro, n(r.vendas_liquido))}`} tom={lucro >= 0 ? "bom" : "ruim"} />
            <Bloco titulo="Compras (entradas)" valor={fmtMoeda(r.compras)} sub={n(r.descontos_compra) > 0 ? `desconto do fornecedor ${fmtMoeda(r.descontos_compra)}` : "mercadoria que chegou"} />
            <Bloco titulo="Perdas e devoluções" valor={fmtMoeda(n(r.saidas_manuais) + n(r.devolucoes))} sub={`saídas ${fmtMoeda(r.saidas_manuais)} · devolvido ${fmtMoeda(r.devolucoes)}`} tom={n(r.saidas_manuais) > 0 ? "ruim" : undefined} />
          </div>
          <p className="-mt-3 text-xs text-zinc-500">
            Lucro estimado = vendas − custo dos produtos vendidos − saídas manuais (avaria, perda…). Vendas = pedidos liberados, carregados ou entregues; não conta cancelados, recusados nem os que aguardam aprovação. Devoluções são produtos que voltaram cheios na conferência e já voltaram para o estoque.
          </p>

          <Tabela titulo="Por dia" vazio={false} cab={<tr><th className={th}>Dia</th><th className={`${th} text-right`}>Pedidos</th><th className={`${th} text-right`}>Vendas</th><th className={`${th} text-right`}>Descontos</th><th className={`${th} text-right`}>Compras</th><th className={`${th} w-1/3`}>Vendas × compras</th></tr>}>
            {rel.por_dia.map((d) => {
              const dt = new Date(d.dia + "T12:00:00");
              return (
                <tr key={d.dia}>
                  <td className="whitespace-nowrap font-medium">{DIAS[dt.getDay()]} {fmtData(d.dia).slice(0, 5)}</td>
                  <td className="text-right">{d.pedidos}</td>
                  <td className="text-right font-semibold whitespace-nowrap">{fmtMoeda(d.vendas)}</td>
                  <td className="text-right whitespace-nowrap">{n(d.descontos) > 0 ? fmtMoeda(d.descontos) : "—"}</td>
                  <td className="text-right whitespace-nowrap">{n(d.compras) > 0 ? fmtMoeda(d.compras) : "—"}</td>
                  <td>
                    <div className="space-y-1" aria-hidden>
                      <div className="h-2 rounded-full bg-marca-500" style={{ width: `${(n(d.vendas) / maxDia) * 100}%` }} />
                      <div className="h-2 rounded-full bg-zinc-400 dark:bg-zinc-500" style={{ width: `${(n(d.compras) / maxDia) * 100}%` }} />
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr className="font-bold"><td>Total</td><td className="text-right">{r.pedidos}</td><td className="text-right">{fmtMoeda(r.vendas_liquido)}</td><td className="text-right">{fmtMoeda(r.descontos)}</td><td className="text-right">{fmtMoeda(r.compras)}</td>
              <td className="text-xs font-normal text-zinc-500"><span className="mr-1 inline-block size-2 rounded-full bg-marca-500" />vendas <span className="ml-2 mr-1 inline-block size-2 rounded-full bg-zinc-400" />compras</td></tr>
          </Tabela>

          <Tabela titulo="Por produto" sub="O que mais vendeu na semana, com custo e lucro." vazio={!rel.produtos.length}
            cab={<tr><th className={th}>Produto</th><th className={`${th} text-right`}>Qtd</th><th className={`${th} text-right`}>Vendas</th><th className={`${th} text-right`}>Descontos</th><th className={`${th} text-right`}>Custo</th><th className={`${th} text-right`}>Lucro</th><th className={`${th} text-right`}>Margem</th></tr>}>
            {rel.produtos.map((p) => (
              <tr key={p.produto}>
                <td className="font-medium">{p.produto}{p.sem_custo && <span className="ml-1 text-xs text-amber-600">sem custo</span>}</td>
                <td className="text-right whitespace-nowrap">{fmtQtd(p.quantidade)} {p.unidade}</td>
                <td className="text-right whitespace-nowrap">{fmtMoeda(p.faturamento)}</td>
                <td className="text-right whitespace-nowrap">{n(p.descontos) > 0 ? fmtMoeda(p.descontos) : "—"}</td>
                <td className="text-right whitespace-nowrap">{fmtMoeda(p.custo)}</td>
                <td className={`text-right font-semibold whitespace-nowrap ${n(p.lucro) < 0 ? "text-red-600" : ""}`}>{fmtMoeda(p.lucro)}</td>
                <td className="text-right">{pct(n(p.lucro), n(p.faturamento))}</td>
              </tr>
            ))}
          </Tabela>

          <Tabela titulo="Pedidos e descontos" sub="Cada pedido da semana. Os que tiveram desconto aparecem destacados." vazio={!rel.pedidos.length}
            cab={<tr><th className={th}>Nº</th><th className={th}>Data</th><th className={th}>Cliente</th><th className={th}>Vendedor</th><th className={`${th} text-right`}>Tabela</th><th className={`${th} text-right`}>Desconto</th><th className={`${th} text-right`}>Total</th><th className={th}>Observação</th></tr>}>
            {rel.pedidos.map((p) => (
              <tr key={p.id} className={n(p.desconto) > 0 ? "bg-amber-50/60 dark:bg-amber-500/5" : ""}>
                <td className="font-semibold">{p.numero}</td>
                <td className="whitespace-nowrap text-zinc-500">{fmtDataHora(p.feito_em)}</td>
                <td>{p.cliente}</td>
                <td>{p.vendedor ?? "—"}</td>
                <td className="text-right whitespace-nowrap">{fmtMoeda(p.bruto)}</td>
                <td className="text-right whitespace-nowrap">{n(p.desconto) > 0 ? <b className="text-amber-700 dark:text-amber-400">{fmtMoeda(p.desconto)} <span className="text-xs font-normal">(até {fmtQtd(p.maior_desconto)}%)</span></b> : "—"}</td>
                <td className="text-right font-semibold whitespace-nowrap">{fmtMoeda(p.liquido)}</td>
                <td className="text-zinc-500">{p.observacao ?? ""}</td>
              </tr>
            ))}
          </Tabela>

          <Tabela titulo="Entradas de mercadoria" sub="Valor de compra, desconto do fornecedor e observação de cada entrada." vazio={!rel.entradas.length}
            cab={<tr><th className={th}>Data</th><th className={th}>Produto</th><th className={`${th} text-right`}>Qtd</th><th className={`${th} text-right`}>Valor un.</th><th className={`${th} text-right`}>Desconto</th><th className={`${th} text-right`}>Total</th><th className={th}>Observação</th><th className={th}>Quem</th></tr>}>
            {rel.entradas.map((e, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap text-zinc-500">{fmtDataHora(e.criado_em)}</td>
                <td className="font-medium">{e.produto}</td>
                <td className="text-right whitespace-nowrap">{fmtQtd(e.quantidade)} {e.unidade}</td>
                <td className="text-right whitespace-nowrap">{e.valor_unit != null ? fmtMoeda(e.valor_unit) : <span className="text-amber-600">sem valor</span>}</td>
                <td className="text-right whitespace-nowrap">{n(e.desconto) > 0 ? fmtMoeda(e.desconto) : "—"}</td>
                <td className="text-right font-semibold whitespace-nowrap">{e.valor_total != null ? fmtMoeda(e.valor_total) : "—"}</td>
                <td className="text-zinc-500">{e.observacao ?? ""}</td>
                <td className="text-zinc-500">{e.usuario ?? ""}</td>
              </tr>
            ))}
          </Tabela>

          <Tabela titulo="Saídas manuais" sub="Avaria, vencido, perda, uso próprio, bonificação… (valor pelo custo)." vazio={!rel.saidas.length}
            cab={<tr><th className={th}>Data</th><th className={th}>Produto</th><th className={`${th} text-right`}>Qtd</th><th className={th}>Motivo</th><th className={`${th} text-right`}>Valor</th><th className={th}>Observação</th><th className={th}>Quem</th></tr>}>
            {rel.saidas.map((s, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap text-zinc-500">{fmtDataHora(s.criado_em)}</td>
                <td className="font-medium">{s.produto}</td>
                <td className="text-right whitespace-nowrap">{fmtQtd(s.quantidade)} {s.unidade}</td>
                <td>{s.motivo}</td>
                <td className="text-right font-semibold whitespace-nowrap">{s.valor_total != null ? fmtMoeda(s.valor_total) : "—"}</td>
                <td className="text-zinc-500">{s.observacao ?? ""}</td>
                <td className="text-zinc-500">{s.usuario ?? ""}</td>
              </tr>
            ))}
          </Tabela>

          <Tabela titulo={`Recibos emitidos · ${fmtMoeda(n(r.recebimentos))}`} sub="Pagamentos recebidos na semana (tela Recibos)." vazio={!rel.recibos?.length}
            cab={<tr><th className={th}>Nº</th><th className={th}>Data</th><th className={th}>Recebemos de</th><th className={th}>Referente a</th><th className={`${th} text-right`}>Valor</th><th className={th}>Observação</th><th className={th}>Quem</th></tr>}>
            {(rel.recibos ?? []).map((x) => (
              <tr key={x.numero}>
                <td className="font-semibold">{x.numero}</td>
                <td className="whitespace-nowrap text-zinc-500">{fmtData(x.data)}</td>
                <td className="font-medium">{x.recebemos_de}</td>
                <td>{x.referente ?? ""}</td>
                <td className="text-right font-semibold whitespace-nowrap">{fmtMoeda(x.valor)}</td>
                <td className="text-zinc-500">{x.observacao ?? ""}</td>
                <td className="text-zinc-500">{x.usuario ?? ""}</td>
              </tr>
            ))}
          </Tabela>

          <Tabela titulo="Devoluções na conferência" sub="Produtos que voltaram cheios no caminhão (valor pelo preço que foi vendido)." vazio={!rel.devolucoes.length}
            cab={<tr><th className={th}>Data</th><th className={th}>Produto</th><th className={`${th} text-right`}>Qtd</th><th className={`${th} text-right`}>Valor</th><th className={th}>Quem</th></tr>}>
            {rel.devolucoes.map((d, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap text-zinc-500">{fmtDataHora(d.criado_em)}</td>
                <td className="font-medium">{d.produto}</td>
                <td className="text-right whitespace-nowrap">{fmtQtd(d.quantidade)} {d.unidade}</td>
                <td className="text-right font-semibold whitespace-nowrap">{d.valor_total != null ? fmtMoeda(d.valor_total) : "—"}</td>
                <td className="text-zinc-500">{d.usuario ?? ""}</td>
              </tr>
            ))}
          </Tabela>
        </div>
      )}
    </Exige>
  );
}
