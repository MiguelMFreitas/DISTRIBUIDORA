"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { combina, erroMsg, fmtData, fmtMoeda, fmtPeso, TURNOS } from "@/lib/formato";
import { STATUS_CARGA, type Carga } from "@/lib/tipos";
import { Botao, BotaoConfirmar, Selo, avisar } from "@/components/ui";
import { Exige } from "@/components/perfil-contexto";
import { PedidoDetalhe } from "@/components/pedido-detalhe";

type P = {
  id: string; numero: number; total: number; peso_kg: number; carga_id: string | null; status: string;
  clientes: { razao_social: string; nome_fantasia: string | null; bairro: string | null; cidade: string | null; rota_id: string | null };
  perfis: { nome: string } | null;
};
type Op = { id: string; nome: string; placa?: string | null; capacidade_kg?: number | null };

export default function MontarCarga() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const sb = supabaseNavegador();
  const [carga, setCarga] = useState<Carga | null>(null);
  const [pedidos, setPedidos] = useState<P[]>([]);
  const [na, setNa] = useState<Set<string>>(new Set()); // pedidos marcados para esta carga
  const [salvo, setSalvo] = useState<Set<string>>(new Set());
  const [rotas, setRotas] = useState<Op[]>([]);
  const [veiculos, setVeiculos] = useState<Op[]>([]);
  const [motoristas, setMotoristas] = useState<Op[]>([]);
  const [filtroRota, setFiltroRota] = useState("");
  const [busca, setBusca] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [{ data: c }, { data: ps }] = await Promise.all([
      sb.from("cargas").select("*").eq("id", id).single(),
      sb.from("pedidos")
        .select("id, numero, total, peso_kg, carga_id, status, clientes(razao_social, nome_fantasia, bairro, cidade, rota_id), perfis!pedidos_vendedor_id_fkey(nome)")
        .or(`carga_id.eq.${id},and(status.eq.liberado,carga_id.is.null)`)
        .order("numero"),
    ]);
    setCarga(c as Carga);
    const lista = (ps ?? []) as unknown as P[];
    setPedidos(lista);
    const s = new Set(lista.filter((p) => p.carga_id === id).map((p) => p.id));
    setNa(s);
    setSalvo(new Set(s));
  }, [sb, id]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    sb.from("rotas").select("id, nome").order("nome").then(({ data }) => setRotas(data ?? []));
    sb.from("veiculos").select("id, nome, placa, capacidade_kg").order("nome").then(({ data }) => setVeiculos(data ?? []));
    sb.from("motoristas").select("id, nome").order("nome").then(({ data }) => setMotoristas(data ?? []));
  }, [sb]);

  const nomeRota = useMemo(() => Object.fromEntries(rotas.map((r) => [r.id, r.nome])), [rotas]);
  const veiculo = veiculos.find((v) => v.id === carga?.veiculo_id);
  const montando = carga?.status === "montando";
  const mudou = na.size !== salvo.size || [...na].some((x) => !salvo.has(x));

  const naCarga = pedidos.filter((p) => na.has(p.id));
  const disponiveis = pedidos.filter((p) => !na.has(p.id) && p.status === "liberado"
    && (!filtroRota || (p.clientes.rota_id ?? "") === (filtroRota === "-" ? "" : filtroRota))
    && (!busca.trim() || combina(`${p.numero} ${p.clientes.razao_social} ${p.clientes.nome_fantasia ?? ""} ${p.clientes.bairro ?? ""}`, busca)));

  // agrupa os disponíveis por rota
  const grupos = useMemo(() => {
    const g = new Map<string, P[]>();
    for (const p of disponiveis) {
      const k = p.clientes.rota_id ?? "";
      g.set(k, [...(g.get(k) ?? []), p]);
    }
    return [...g.entries()].sort((a, b) => (nomeRota[a[0]] ?? "zzz").localeCompare(nomeRota[b[0]] ?? "zzz"));
  }, [disponiveis, nomeRota]);

  const rotasNaCarga = [...new Set(naCarga.map((p) => nomeRota[p.clientes.rota_id ?? ""] ?? "SEM ROTA"))].sort();
  const peso = naCarga.reduce((s, p) => s + Number(p.peso_kg), 0);
  const valor = naCarga.reduce((s, p) => s + Number(p.total), 0);
  const clientes = new Set(naCarga.map((p) => p.clientes.razao_social)).size;
  const cap = Number(veiculo?.capacidade_kg ?? 0);
  const pct = cap ? (peso / cap) * 100 : 0;

  const marcar = (ids: string[], sim: boolean) => setNa((s) => { const n = new Set(s); ids.forEach((x) => (sim ? n.add(x) : n.delete(x))); return n; });

  async function salvarPedidos() {
    setOcupado(true);
    const { error } = await sb.rpc("definir_pedidos_carga", { p_carga: id, p_pedidos: [...na] });
    setOcupado(false);
    if (error) { avisar(erroMsg(error), "erro"); carregar(); return; }
    avisar("Carga salva");
    carregar();
  }

  async function atualizarCarga(campos: Partial<Carga>) {
    const { error } = await sb.from("cargas").update(campos).eq("id", id);
    if (error) return avisar(erroMsg(error), "erro");
    setCarga((c) => (c ? { ...c, ...campos } : c));
  }

  async function rpc(fn: string, msg: string) {
    if (mudou) return avisar("Salve os pedidos da carga primeiro.", "erro");
    setOcupado(true);
    const { error } = await sb.rpc(fn, { p_carga: id });
    setOcupado(false);
    if (error) return avisar(erroMsg(error), "erro");
    avisar(msg);
    carregar();
  }

  async function excluir() {
    const { error } = await sb.from("cargas").delete().eq("id", id);
    if (error) return avisar(erroMsg(error), "erro");
    avisar("Carga excluída. Os pedidos voltaram para a lista.");
    router.push("/cargas");
  }

  function imprimir(tipo: "romaneio" | "pedidos") {
    if (mudou) return avisar("Salve os pedidos da carga antes de imprimir.", "erro");
    window.open(tipo === "romaneio" ? `/imprimir/romaneio/${id}` : `/imprimir/pedidos?carga=${id}`, "_blank");
  }

  if (!carga) return <div className="cartao p-8 text-center text-zinc-500">Carregando…</div>;

  return (
    <Exige perm="cargas">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/cargas" className="text-sm font-semibold text-marca-600">← Cargas</Link>
          <h1 className="titulo text-3xl">Carga {carga.numero_dia}{carga.nome ? ` · ${carga.nome}` : ""}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
            {fmtData(carga.data)} · {TURNOS[carga.turno]} <Selo cor={STATUS_CARGA[carga.status][1]}>{STATUS_CARGA[carga.status][0]}</Selo>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Botao variante="secundario" onClick={() => imprimir("romaneio")} disabled={!naCarga.length}>🖨 Romaneio</Botao>
          <Botao variante="secundario" onClick={() => imprimir("pedidos")} disabled={!naCarga.length}>🖨 Pedidos da carga</Botao>
          {montando && <Botao onClick={() => rpc("saida_carga", "Carga marcada como saiu")} carregando={ocupado} disabled={!naCarga.length}>Marcar saída 🚚</Botao>}
          {carga.status === "saiu" && <BotaoConfirmar variante="secundario" aoConfirmar={() => rpc("reabrir_carga", "Carga reaberta")} textoConfirmar="Reabrir a carga?">Reabrir</BotaoConfirmar>}
          {carga.status === "saiu" && <Link href={`/conferencia/${id}`}><Botao>Conferir retorno</Botao></Link>}
        </div>
      </div>

      {/* veículo, motorista e resumo */}
      <div className="cartao mb-4 grid gap-3 p-4 md:grid-cols-[1fr_1fr_2fr]">
        <div className="md:col-span-3">
          <label className="rotulo" htmlFor="nome-carga">Nome da carga (sai grande no romaneio)</label>
          <div className="flex flex-wrap gap-2">
            <input id="nome-carga" className="campo max-w-xl flex-1 uppercase" disabled={!montando} placeholder="Ex.: ROTA SERRA, CENTRO + ZONA NORTE"
              key={carga.nome ?? ""} defaultValue={carga.nome ?? ""}
              onBlur={(e) => { const v = e.target.value.trim().toLocaleUpperCase("pt-BR") || null; if (v !== (carga.nome ?? null)) atualizarCarga({ nome: v }); }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
            {montando && rotasNaCarga.length > 0 && (
              <Botao variante="secundario" onClick={() => atualizarCarga({ nome: rotasNaCarga.join(" + ") })}>Usar as rotas: {rotasNaCarga.join(" + ")}</Botao>
            )}
          </div>
        </div>
        <div><label className="rotulo">Veículo</label>
          <select className="campo" disabled={!montando} value={carga.veiculo_id ?? ""} onChange={(e) => atualizarCarga({ veiculo_id: e.target.value || null })}>
            <option value="">—</option>
            {veiculos.map((v) => <option key={v.id} value={v.id}>{v.nome}{v.placa ? ` (${v.placa})` : ""}</option>)}
          </select>
        </div>
        <div><label className="rotulo">Motorista</label>
          <select className="campo" disabled={!montando} value={carga.motorista_id ?? ""} onChange={(e) => atualizarCarga({ motorista_id: e.target.value || null })}>
            <option value="">—</option>
            {motoristas.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </select>
        </div>
        <div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div><div className="rotulo">Pedidos</div><div className="font-display text-2xl font-bold">{naCarga.length}</div></div>
            <div><div className="rotulo">Clientes</div><div className="font-display text-2xl font-bold">{clientes}</div></div>
            <div><div className="rotulo">Peso</div><div className={`font-display text-2xl font-bold ${pct > 100 ? "text-red-600" : ""}`}>{fmtPeso(peso)}</div></div>
            <div><div className="rotulo">Valor</div><div className="font-display text-2xl font-bold">{fmtMoeda(valor)}</div></div>
          </div>
          {cap > 0 && (
            <div className="mt-2">
              <div className="h-2.5 rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div className={`h-2.5 rounded-full ${pct > 100 ? "bg-red-600" : pct > 90 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
              <div className={`mt-1 text-xs ${pct > 100 ? "font-bold text-red-600" : "text-zinc-500"}`}>
                {pct > 100 ? `Passou ${fmtPeso(peso - cap)} da capacidade (${fmtPeso(cap)})` : `${Math.round(pct)}% de ${fmtPeso(cap)}`}
              </div>
            </div>
          )}
        </div>
      </div>

      {mudou && (
        <div className="sticky top-16 z-20 mb-4 flex items-center justify-between gap-3 rounded-xl bg-marca-500 p-3 text-white shadow-lg lg:top-2">
          <span className="font-semibold">Você mudou os pedidos desta carga.</span>
          <div className="flex gap-2">
            <Botao variante="secundario" tamanho="p" onClick={() => setNa(new Set(salvo))}>Desfazer</Botao>
            <Botao variante="secundario" tamanho="p" onClick={salvarPedidos} carregando={ocupado}>Salvar carga</Botao>
          </div>
        </div>
      )}

      <div className={`grid gap-4 ${montando ? "lg:grid-cols-2" : ""}`}>
        {montando && (
          <section>
            <h2 className="titulo mb-2 text-lg">Pedidos esperando carga</h2>
            <div className="mb-2 flex gap-2">
              <select className="campo w-auto!" value={filtroRota} onChange={(e) => setFiltroRota(e.target.value)}>
                <option value="">Todas as rotas</option>
                {rotas.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
                <option value="-">Sem rota</option>
              </select>
              <input className="campo" placeholder="Pesquisar cliente, bairro, nº" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>
            {grupos.length === 0 && <p className="cartao p-6 text-center text-zinc-500">Nenhum pedido esperando carga.</p>}
            <div className="space-y-3">
              {grupos.map(([rota, lista]) => (
                <div key={rota} className="cartao overflow-hidden">
                  <div className="flex items-center justify-between gap-2 bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
                    <span className="font-semibold">{nomeRota[rota] ?? "Sem rota"} <span className="text-sm font-normal text-zinc-500">· {lista.length} pedidos · {fmtPeso(lista.reduce((s, p) => s + Number(p.peso_kg), 0))}</span></span>
                    <Botao tamanho="p" variante="secundario" onClick={() => marcar(lista.map((p) => p.id), true)}>Adicionar rota inteira →</Botao>
                  </div>
                  {lista.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
                      <button className="min-w-0 flex-1 text-left" onClick={() => setAberto(p.id)}>
                        <div className="truncate font-medium">{p.numero} · {p.clientes.razao_social}</div>
                        <div className="text-xs text-zinc-500">{p.clientes.bairro} · {p.perfis?.nome} · {fmtPeso(p.peso_kg)} · {fmtMoeda(p.total)}</div>
                      </button>
                      <Botao tamanho="p" onClick={() => marcar([p.id], true)}>Adicionar</Botao>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="titulo text-lg">Nesta carga ({naCarga.length})</h2>
            {montando && naCarga.length > 0 && <Botao variante="fantasma" tamanho="p" onClick={() => setNa(new Set())}>Tirar todos</Botao>}
          </div>
          <div className="cartao overflow-hidden">
            {naCarga.length === 0 && <p className="p-6 text-center text-zinc-500">Adicione pedidos da lista ao lado.</p>}
            {naCarga.map((p) => (
              <div key={p.id} className="flex items-center gap-3 border-t border-zinc-100 px-3 py-2 first:border-0 dark:border-zinc-800">
                <button className="min-w-0 flex-1 text-left" onClick={() => setAberto(p.id)}>
                  <div className="truncate font-medium">{p.numero} · {p.clientes.razao_social}{!salvo.has(p.id) && <span className="ml-2 text-xs font-bold text-marca-600">novo</span>}</div>
                  <div className="text-xs text-zinc-500">{nomeRota[p.clientes.rota_id ?? ""] ?? "Sem rota"} · {p.clientes.bairro} · {fmtPeso(p.peso_kg)} · {fmtMoeda(p.total)}</div>
                </button>
                {montando && <Botao tamanho="p" variante="secundario" onClick={() => marcar([p.id], false)}>Tirar</Botao>}
              </div>
            ))}
          </div>
          {montando && (
            <div className="mt-4 text-right">
              <BotaoConfirmar variante="fantasma" tamanho="p" aoConfirmar={excluir} textoConfirmar="Excluir a carga?">Excluir carga</BotaoConfirmar>
            </div>
          )}
        </section>
      </div>
      <PedidoDetalhe id={aberto} aoFechar={() => setAberto(null)} aoMudar={carregar} />
    </Exige>
  );
}
