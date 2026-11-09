"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg } from "@/lib/formato";
import { IMPRESSORA_FOLHA } from "@/lib/impressao";

type Rota = { nome: string; perfis: { nome: string } | null };
type Cli = { id: string; razao_social: string; nome_fantasia: string | null; endereco: string | null; numero: string | null; bairro: string | null; telefone: string | null; referencia: string | null; ordem_visita: number | null };

export default function ImprimirRoteiro() {
  const { id } = useParams<{ id: string }>();
  const sb = supabaseNavegador();
  const [rota, setRota] = useState<Rota | null>(null);
  const [clientes, setClientes] = useState<Cli[]>([]);
  const [erro, setErro] = useState("");

  useEffect(() => {
    (async () => {
      const [{ data: r, error: e1 }, { data: c, error: e2 }] = await Promise.all([
        sb.from("rotas").select("nome, perfis(nome)").eq("id", id).single(),
        sb.from("clientes").select("id, razao_social, nome_fantasia, endereco, numero, bairro, telefone, referencia, ordem_visita")
          .eq("rota_id", id).eq("ativo", true).not("ordem_visita", "is", null).order("ordem_visita"),
      ]);
      if (e1 || e2) return setErro(erroMsg(e1 || e2));
      setRota(r as unknown as Rota);
      setClientes((c ?? []) as Cli[]);
      document.title = `Roteiro ${(r as unknown as Rota).nome}`;
    })();
  }, [sb, id]);

  if (erro) return <p style={{ padding: 24 }}>Erro: {erro}</p>;
  if (!rota) return <p style={{ padding: 24 }}>Carregando…</p>;

  const empresa = process.env.NEXT_PUBLIC_EMPRESA_NOME || "Distribuidora";
  return (
    <>
      <style>{"@page { size: A4; margin: 10mm; }"}</style>
      <div className="barra">
        <span>Roteiro de visitas · folha A4. Escolha a impressora <b>{IMPRESSORA_FOLHA}</b> (ou “Salvar como PDF”).</span>
        <button onClick={() => window.print()}>🖨 Imprimir / Salvar PDF</button>
      </div>
      <div className="folha">
        <div className="rom-topo">
          <div>
            <div className="cond" style={{ fontSize: 14, color: "#555", fontWeight: 600 }}>{empresa}</div>
            <h1 className="cond">Roteiro de visitas</h1>
            <div className="cond rom-nome">Rota {rota.nome}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 14 }}>
            <div>Vendedor: <b>{rota.perfis?.nome ?? "________________"}</b></div>
            <div style={{ marginTop: 6 }}>Data: ____/____/______</div>
            <div style={{ marginTop: 6 }}><b>{clientes.length}</b> clientes</div>
          </div>
        </div>
        <table className="rom-tab" style={{ marginTop: 10 }}>
          <thead>
            <tr><th style={{ width: 34 }}>Nº</th><th>Cliente</th><th>Endereço</th><th>Telefone</th><th style={{ width: 58, textAlign: "center" }}>Visitou</th><th style={{ width: 58, textAlign: "center" }}>Pedido</th><th style={{ width: 120 }}>Obs.</th></tr>
          </thead>
          <tbody>
            {clientes.map((c, i) => (
              <tr key={c.id} className="it" style={{ breakInside: "avoid" }}>
                <td className="q" style={{ textAlign: "center" }}>{i + 1}</td>
                <td style={{ padding: "4px 6px" }}><div className="prod">{c.razao_social}</div>{c.nome_fantasia && <div style={{ fontSize: 11, color: "#555" }}>{c.nome_fantasia}</div>}</td>
                <td style={{ padding: "4px 6px", fontSize: 12 }}>{[c.endereco && `${c.endereco}${c.numero ? ", " + c.numero : ""}`, c.bairro].filter(Boolean).join(" · ")}{c.referencia && <div style={{ fontSize: 11, color: "#555" }}>Ref.: {c.referencia}</div>}</td>
                <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>{c.telefone ?? ""}</td>
                <td className="ck" style={{ width: 58 }}><i style={{ margin: "0 auto" }} /></td>
                <td className="ck" style={{ width: 58 }}><i style={{ margin: "0 auto" }} /></td>
                <td className="ob"><i /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rom-rodape"><span>Ordem definida no sistema (Roteiro de visitas)</span><span>Impresso em {new Date().toLocaleString("pt-BR")}</span></div>
      </div>
    </>
  );
}
