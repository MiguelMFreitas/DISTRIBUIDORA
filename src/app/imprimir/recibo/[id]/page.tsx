"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg, fmtMoeda } from "@/lib/formato";
import { valorPorExtenso } from "@/lib/extenso";
import { IMPRESSORA_CUPOM, IMPRESSORA_FOLHA } from "@/lib/impressao";

type R = { numero: number; data: string; valor: number; recebemos_de: string; documento: string | null; referente: string | null; observacao: string | null; cancelado: boolean };

const dataExtenso = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });

export default function ImprimirRecibo() {
  const { id } = useParams<{ id: string }>();
  const sb = supabaseNavegador();
  const [r, setR] = useState<R | null>(null);
  const [erro, setErro] = useState("");
  const [formato, setFormato] = useState<"t80" | "a4">("t80");
  const [vias, setVias] = useState(1);

  useEffect(() => {
    try { const f = localStorage.getItem("recibo_formato"); if (f === "a4" || f === "t80") setFormato(f); setVias(Number(localStorage.getItem("recibo_vias")) || 1); } catch {}
    sb.from("recibos").select("*").eq("id", id).single().then(({ data, error }) => {
      if (error) return setErro(erroMsg(error));
      setR(data as R);
      document.title = `Recibo ${data.numero}`;
    });
  }, [sb, id]);

  if (erro) return <p style={{ padding: 24 }}>Erro: {erro}</p>;
  if (!r) return <p style={{ padding: 24 }}>Carregando…</p>;

  const empresa = process.env.NEXT_PUBLIC_EMPRESA_NOME || "Distribuidora";
  const texto = (
    <>Recebemos de <b>{r.recebemos_de}</b>{r.documento ? <> (CPF/CNPJ {r.documento})</> : ""} a importância de <b>{fmtMoeda(r.valor)}</b> (<b>{valorPorExtenso(r.valor).toUpperCase()}</b>){r.referente ? <>, referente ao pagamento de <b>{r.referente}</b></> : ""}.</>
  );
  const via = (n: number) =>
    formato === "t80" ? (
      <div key={n} className="cupom recibo">
        <div className="c-emp">{empresa}</div>
        <div className="c-num">RECIBO</div>
        <div className="c-meta">Nº {r.numero}{vias > 1 ? ` · ${n === 1 ? "1ª via" : "2ª via"}` : ""}</div>
        <div className="c-sep" />
        <div className="c-tot" style={{ justifyContent: "center", fontSize: "1.9em" }}>{fmtMoeda(r.valor)}</div>
        <div className="c-sep" />
        <p style={{ margin: 0, textAlign: "justify" }}>{texto}</p>
        {r.observacao && <p style={{ margin: "2mm 0 0" }}>Obs.: {r.observacao}</p>}
        <p style={{ margin: "3mm 0 0", textAlign: "center" }}>{dataExtenso(r.data)}</p>
        <div className="c-ass" style={{ marginTop: "12mm" }}>{empresa}</div>
        {r.cancelado && <p style={{ textAlign: "center", fontWeight: 700 }}>*** RECIBO CANCELADO ***</p>}
      </div>
    ) : (
      <div key={n} className="recibo-a4">
        <div className="ra-topo">
          <div><div className="cond" style={{ fontSize: 15, color: "#555", fontWeight: 600 }}>{empresa}</div><div className="cond ra-tit">R E C I B O</div></div>
          <div style={{ textAlign: "right" }}><div className="cond" style={{ fontSize: 14 }}>Nº {r.numero}{vias > 1 ? ` · ${n === 1 ? "1ª via" : "2ª via"}` : ""}</div><div className="ra-valor">{fmtMoeda(r.valor)}</div></div>
        </div>
        <p className="ra-texto">{texto}</p>
        {r.observacao && <p className="ra-texto" style={{ fontSize: 14 }}>Obs.: {r.observacao}</p>}
        <div className="ra-rodape"><span>{dataExtenso(r.data)}</span><div className="ra-ass">{empresa}</div></div>
        {r.cancelado && <p style={{ textAlign: "center", fontWeight: 700, color: "#b91c1c" }}>RECIBO CANCELADO</p>}
      </div>
    );

  return (
    <>
      <style>{formato === "a4" ? "@page { size: A4; margin: 10mm; }" : "@page { margin: 0; }"}</style>
      <div className="barra">
        <span>Recibo nº {r.numero} · {fmtMoeda(r.valor)}</span>
        <label className="sec">Papel:{" "}
          <select value={formato} onChange={(e) => { const f = e.target.value as "t80" | "a4"; setFormato(f); try { localStorage.setItem("recibo_formato", f); } catch {} }} style={{ color: "#111", borderRadius: 6, border: 0, padding: "2px 4px" }}>
            <option value="t80">Cupom 80 mm ({IMPRESSORA_CUPOM})</option>
            <option value="a4">Folha A4 ({IMPRESSORA_FOLHA})</option>
          </select>
        </label>
        <label className="sec"><input type="checkbox" checked={vias === 2} onChange={(e) => { const v = e.target.checked ? 2 : 1; setVias(v); try { localStorage.setItem("recibo_vias", String(v)); } catch {} }} /> 2 vias</label>
        <button onClick={() => window.print()}>🖨 Imprimir</button>
        <span style={{ width: "100%", textAlign: "center", fontSize: 12, opacity: .85 }}>Na janela de impressão, escolha a impressora <b>{formato === "t80" ? IMPRESSORA_CUPOM : IMPRESSORA_FOLHA}</b>{formato === "t80" ? " e margens “Nenhuma”" : ""}.</span>
      </div>
      {formato === "t80"
        ? <div className="cupons t80">{Array.from({ length: vias }, (_, i) => via(i + 1))}</div>
        : <div className="folha">{Array.from({ length: vias }, (_, i) => <div key={i}>{i > 0 && <div className="ra-corte">✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</div>}{via(i + 1)}</div>)}</div>}
    </>
  );
}
