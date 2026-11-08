"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg, fmtData, fmtMoeda, fmtPeso, hojeISO, TURNOS } from "@/lib/formato";
import { Botao, Cabecalho, Modal, Selo, Vazio, avisar } from "@/components/ui";
import { Exige } from "@/components/perfil-contexto";
import { STATUS_CARGA } from "@/lib/tipos";

type C = { id: string; numero: number; data: string; turno: "manha" | "tarde"; status: string; veiculos: { nome: string; placa: string | null } | null; motoristas: { nome: string } | null; pedidos: { total: number; peso_kg: number }[] };
type Op = { id: string; nome: string; placa?: string | null; capacidade_kg?: number | null };

export default function Cargas() {
  const sb = supabaseNavegador();
  const router = useRouter();
  const [data, setData] = useState(hojeISO());
  const [cargas, setCargas] = useState<C[]>([]);
  const [semCarga, setSemCarga] = useState(0);
  const [veiculos, setVeiculos] = useState<Op[]>([]);
  const [motoristas, setMotoristas] = useState<Op[]>([]);
  const [nova, setNova] = useState<{ turno: string; veiculo_id: string; motorista_id: string } | null>(null);

  const carregar = useCallback(async () => {
    const [{ data: c }, { count }] = await Promise.all([
      sb.from("cargas").select("id, numero, data, turno, status, veiculos(nome, placa), motoristas(nome), pedidos(total, peso_kg)").eq("data", data).order("turno").order("numero"),
      sb.from("pedidos").select("id", { count: "exact", head: true }).eq("status", "liberado").is("carga_id", null),
    ]);
    setCargas((c ?? []) as unknown as C[]);
    setSemCarga(count ?? 0);
  }, [sb, data]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    sb.from("veiculos").select("id, nome, placa, capacidade_kg").eq("ativo", true).order("nome").then(({ data }) => setVeiculos(data ?? []));
    sb.from("motoristas").select("id, nome").eq("ativo", true).order("nome").then(({ data }) => setMotoristas(data ?? []));
  }, [sb]);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!nova) return;
    const { data: c, error } = await sb.from("cargas").insert({ data, turno: nova.turno, veiculo_id: nova.veiculo_id || null, motorista_id: nova.motorista_id || null }).select("id").single();
    if (error) return avisar(erroMsg(error), "erro");
    router.push(`/cargas/${c.id}`);
  }

  return (
    <Exige perm="cargas">
      <Cabecalho titulo="Cargas" sub={semCarga > 0 ? `${semCarga} pedido(s) liberado(s) esperando carga` : "Todos os pedidos liberados já estão em cargas"}>
        <input type="date" className="campo w-auto!" value={data} onChange={(e) => setData(e.target.value)} />
        <Botao onClick={() => setNova({ turno: new Date().getHours() < 12 ? "manha" : "tarde", veiculo_id: "", motorista_id: "" })}>+ Nova carga</Botao>
      </Cabecalho>

      {cargas.length === 0 ? <Vazio>Nenhuma carga em {fmtData(data)}. Clique em “+ Nova carga” para começar.</Vazio> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cargas.map((c) => {
            const peso = c.pedidos.reduce((s, p) => s + Number(p.peso_kg), 0);
            const valor = c.pedidos.reduce((s, p) => s + Number(p.total), 0);
            return (
              <Link key={c.id} href={`/cargas/${c.id}`} className="cartao block p-4 hover:border-marca-500">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-display text-2xl font-bold uppercase">Carga {c.numero}</div>
                    <div className="text-sm text-zinc-500">{TURNOS[c.turno]}</div>
                  </div>
                  <Selo cor={STATUS_CARGA[c.status][1]}>{STATUS_CARGA[c.status][0]}</Selo>
                </div>
                <div className="mt-3 text-[15px]">🚚 {c.veiculos ? `${c.veiculos.nome}${c.veiculos.placa ? " · " + c.veiculos.placa : ""}` : <span className="text-zinc-400">sem veículo</span>}</div>
                <div className="text-[15px]">👤 {c.motoristas?.nome ?? <span className="text-zinc-400">sem motorista</span>}</div>
                <div className="mt-3 flex justify-between border-t border-zinc-100 pt-2 text-sm dark:border-zinc-800">
                  <span><b>{c.pedidos.length}</b> pedidos</span><span>{fmtPeso(peso)}</span><span className="font-semibold">{fmtMoeda(valor)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <Modal aberto={!!nova} aoFechar={() => setNova(null)} titulo="Nova carga" largura="max-w-md"
        rodape={<><Botao variante="secundario" onClick={() => setNova(null)}>Cancelar</Botao><Botao type="submit" form="form-carga">Criar e escolher pedidos</Botao></>}>
        {nova && (
          <form id="form-carga" onSubmit={criar} className="space-y-3">
            <div>
              <label className="rotulo">Turno</label>
              <div className="flex gap-2">
                {(["manha", "tarde"] as const).map((t) => (
                  <button type="button" key={t} onClick={() => setNova({ ...nova, turno: t })} className={`flex-1 rounded-lg border px-3 py-2 font-semibold ${nova.turno === t ? "border-marca-500 bg-marca-500 text-white" : "border-zinc-300 dark:border-zinc-700"}`}>{TURNOS[t]}</button>
                ))}
              </div>
            </div>
            <div><label className="rotulo">Veículo</label>
              <select className="campo" value={nova.veiculo_id} onChange={(e) => setNova({ ...nova, veiculo_id: e.target.value })}>
                <option value="">— escolher depois —</option>
                {veiculos.map((v) => <option key={v.id} value={v.id}>{v.nome}{v.placa ? ` (${v.placa})` : ""}{v.capacidade_kg ? ` · ${Number(v.capacidade_kg).toLocaleString("pt-BR")} kg` : ""}</option>)}
              </select>
            </div>
            <div><label className="rotulo">Motorista</label>
              <select className="campo" value={nova.motorista_id} onChange={(e) => setNova({ ...nova, motorista_id: e.target.value })}>
                <option value="">— escolher depois —</option>
                {motoristas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
              </select>
            </div>
          </form>
        )}
      </Modal>
    </Exige>
  );
}
