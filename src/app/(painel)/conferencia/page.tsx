"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { fmtData, TURNOS } from "@/lib/formato";
import { STATUS_CARGA } from "@/lib/tipos";
import { Cabecalho, Selo, Vazio } from "@/components/ui";
import { Exige } from "@/components/perfil-contexto";

type C = { id: string; numero: number; data: string; turno: "manha" | "tarde"; status: string; veiculos: { nome: string } | null; motoristas: { nome: string } | null; pedidos: { count: number }[] };

export default function ListaConferencia() {
  const sb = supabaseNavegador();
  const [pendentes, setPendentes] = useState<C[] | null>(null);
  const [feitas, setFeitas] = useState<C[]>([]);
  useEffect(() => {
    const sel = "id, numero, data, turno, status, veiculos(nome), motoristas(nome), pedidos(count)";
    sb.from("cargas").select(sel).eq("status", "saiu").order("data").order("numero").then(({ data }) => setPendentes((data ?? []) as unknown as C[]));
    sb.from("cargas").select(sel).eq("status", "conferida").order("data", { ascending: false }).order("numero", { ascending: false }).limit(20).then(({ data }) => setFeitas((data ?? []) as unknown as C[]));
  }, [sb]);

  const Cartao = ({ c }: { c: C }) => (
    <Link href={`/conferencia/${c.id}`} className="cartao flex items-center justify-between gap-3 p-4 hover:border-marca-500">
      <div>
        <div className="font-display text-xl font-bold uppercase">Carga {c.numero} <span className="text-base font-semibold text-zinc-500 normal-case">· {fmtData(c.data)} {TURNOS[c.turno]}</span></div>
        <div className="text-sm text-zinc-500">🚚 {c.veiculos?.nome ?? "—"} · 👤 {c.motoristas?.nome ?? "—"} · {c.pedidos[0]?.count ?? 0} pedidos</div>
      </div>
      <Selo cor={STATUS_CARGA[c.status][1]}>{c.status === "saiu" ? "Conferir →" : "Conferida"}</Selo>
    </Link>
  );

  return (
    <Exige perm="conferencia">
      <Cabecalho titulo="Conferência de rota" sub="Escolha a carga que voltou para conferir vasilhames, devoluções e trocas." />
      <h2 className="titulo mb-2 text-lg">Esperando conferência</h2>
      {pendentes === null ? <p className="text-zinc-500">Carregando…</p> : pendentes.length === 0 ? <Vazio>Nenhuma carga na rua agora.</Vazio> : (
        <div className="grid gap-3 md:grid-cols-2">{pendentes.map((c) => <Cartao key={c.id} c={c} />)}</div>
      )}
      {feitas.length > 0 && (
        <>
          <h2 className="titulo mb-2 mt-8 text-lg">Conferidas recentemente</h2>
          <div className="grid gap-3 md:grid-cols-2">{feitas.map((c) => <Cartao key={c.id} c={c} />)}</div>
        </>
      )}
    </Exige>
  );
}
