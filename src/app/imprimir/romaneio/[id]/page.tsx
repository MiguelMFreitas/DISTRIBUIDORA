"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { IMPRESSORA_FOLHA } from "@/lib/impressao";
import { erroMsg, fmtData, fmtMoeda, fmtPeso, fmtQtd, TURNOS } from "@/lib/formato";

type Item = { categoria_id: string | null; categoria: string; categoria_ordem: number; produto_id: string; codigo: string | null; produto: string; unidade: string; quantidade: number; peso_kg: number; valor: number };
type Carga = {
  numero: number; nome: string | null; data: string; turno: "manha" | "tarde"; observacao: string | null;
  veiculos: { nome: string; placa: string | null; capacidade_kg: number | null } | null;
  motoristas: { nome: string } | null;
  pedidos: { id: string; status: string; clientes: { id: string; rotas: { nome: string } | null } }[];
};

export default function Romaneio() {
  const { id } = useParams<{ id: string }>();
  const sb = supabaseNavegador();
  const [carga, setCarga] = useState<Carga | null>(null);
  const [itens, setItens] = useState<Item[]>([]);
  const [erro, setErro] = useState("");

  useEffect(() => {
    (async () => {
      const [{ data: c, error: e1 }, { data: i, error: e2 }] = await Promise.all([
        sb.from("cargas").select("numero:numero_dia, nome, data, turno, observacao, veiculos(nome, placa, capacidade_kg), motoristas(nome), pedidos(id, status, clientes(id, rotas(nome)))").eq("id", id).single(),
        sb.rpc("romaneio_itens", { p_carga: id }),
      ]);
      if (e1 || e2) return setErro(erroMsg(e1 || e2));
      setCarga(c as unknown as Carga);
      setItens((i ?? []) as Item[]);
    })();
  }, [sb, id]);

  const grupos = useMemo(() => {
    const g: { nome: string; itens: Item[] }[] = [];
    for (const it of itens) {
      const ult = g.at(-1);
      if (ult && ult.nome === it.categoria) ult.itens.push(it);
      else g.push({ nome: it.categoria, itens: [it] });
    }
    return g;
  }, [itens]);

  useEffect(() => {
    if (carga) document.title = `Romaneio carga ${carga.numero}${carga.nome ? " - " + carga.nome : ""}`;
  }, [carga]);

  if (erro) return <p style={{ padding: 24 }}>Erro: {erro}</p>;
  if (!carga) return <p style={{ padding: 24 }}>Carregando…</p>;

  const pedidos = carga.pedidos.filter((p) => ["liberado", "carregado", "entregue"].includes(p.status));
  const clientes = new Set(pedidos.map((p) => p.clientes.id)).size;
  const rotas = [...new Set(pedidos.map((p) => p.clientes.rotas?.nome).filter(Boolean))].join(", ") || "—";
  const peso = itens.reduce((s, i) => s + Number(i.peso_kg), 0);
  const valor = itens.reduce((s, i) => s + Number(i.valor), 0);
  const totalItens = itens.reduce((s, i) => s + Number(i.quantidade), 0);
  const porUnidade = Object.entries(itens.reduce<Record<string, number>>((m, i) => ({ ...m, [i.unidade]: (m[i.unidade] ?? 0) + Number(i.quantidade) }), {}))
    .map(([u, q]) => `${fmtQtd(q)} ${u}`).join(" · ");
  const cap = Number(carga.veiculos?.capacidade_kg ?? 0);

  return (
    <>
      <style>{"@page { size: A4; margin: 10mm; }"}</style>
      <div className="barra">
        <span>Romaneio da carga {carga.numero} · folha A4. Na janela de impressão, escolha a impressora <b>{IMPRESSORA_FOLHA}</b> (ou “Salvar como PDF”).</span>
        <button onClick={() => window.print()}>🖨 Imprimir / Salvar PDF</button>
      </div>
      <div className="folha">
        <div className="rom-topo">
          <div>
            <div className="cond" style={{ fontSize: 14, color: "#555", fontWeight: 600 }}>{process.env.NEXT_PUBLIC_EMPRESA_NOME || "Distribuidora"}</div>
            <h1 className="cond">Romaneio de carga</h1>
            {carga.nome && <div className="cond rom-nome">{carga.nome}</div>}
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="cond rom-num">Nº {carga.numero}</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{fmtData(carga.data)} · {TURNOS[carga.turno]}</div>
          </div>
        </div>

        <div className="rom-info">
          <div><b>Veículo</b><span>{carga.veiculos ? `${carga.veiculos.nome}${carga.veiculos.placa ? " · " + carga.veiculos.placa : ""}` : "—"}</span></div>
          <div><b>Motorista</b><span>{carga.motoristas?.nome ?? "—"}</span></div>
          <div><b>Rotas</b><span>{rotas}</span></div>
        </div>

        <div className="rom-kpis">
          <div><b>Pedidos</b><span>{pedidos.length}</span></div>
          <div><b>Clientes</b><span>{clientes}</span></div>
          <div><b>Total de itens</b><span>{fmtQtd(totalItens)}</span><small>{porUnidade}</small></div>
          <div><b>Peso da carga</b><span>{fmtPeso(peso)}</span>{cap > 0 && <small>{Math.round((peso / cap) * 100)}% de {fmtPeso(cap)}</small>}</div>
          <div><b>Valor total</b><span>{fmtMoeda(valor)}</span></div>
        </div>
        {cap > 0 && peso > cap && <div className="rom-alerta">ATENÇÃO: a carga passa {fmtPeso(peso - cap)} da capacidade do veículo.</div>}
        {carga.observacao && <div className="ped-obs" style={{ marginBottom: 8 }}><b>Obs.:</b> {carga.observacao}</div>}

        <table className="rom-tab">
          <thead>
            <tr><th className="ck">✓</th><th>Produto</th><th style={{ textAlign: "right" }}>Qtd</th><th style={{ textAlign: "right" }}>Peso</th><th className="carr">Carregado</th><th className="obs">Obs.</th></tr>
          </thead>
          {grupos.map((g, gi) => {
            const pesoG = g.itens.reduce((s, i) => s + Number(i.peso_kg), 0);
            const qtdG = g.itens.reduce((s, i) => s + Number(i.quantidade), 0);
            return (
              <tbody key={g.nome} className="cat">
                <tr className="cab">
                  <td colSpan={6}>
                    <span className="nº">{gi + 1}</span><span className="nome cond">{g.nome}</span>
                    <span className="sub">{fmtQtd(qtdG)} itens · {fmtPeso(pesoG)}</span>
                  </td>
                </tr>
                {g.itens.map((i) => (
                  <tr key={i.produto_id} className="item">
                    <td className="ck"><i /></td>
                    <td className="prod">{i.codigo && <span className="cod">{i.codigo}</span>}{i.produto}</td>
                    <td className="qtd">{fmtQtd(i.quantidade)}<span className="un">{i.unidade}</span></td>
                    <td className="peso">{fmtPeso(i.peso_kg)}</td>
                    <td className="carr"><i /></td>
                    <td className="obs"><i /></td>
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>

        <div className="rom-ass">
          <div>Conferente</div>
          <div>Motorista</div>
          <div>Saída ____:____</div>
        </div>
        <div className="rom-rodape">
          <span>{itens.length} produtos diferentes em {grupos.length} categorias</span>
          <span>Impresso em {new Date().toLocaleString("pt-BR")}</span>
        </div>
      </div>
    </>
  );
}
