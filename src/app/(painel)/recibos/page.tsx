"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { combina, erroMsg, fmtData, fmtMoeda, hojeISO } from "@/lib/formato";
import { valorPorExtenso } from "@/lib/extenso";
import { Botao, BotaoConfirmar, Cabecalho, Vazio, avisar } from "@/components/ui";
import { usePerfil, usePode } from "@/components/perfil-contexto";

type Recibo = { id: string; numero: number; data: string; valor: number; recebemos_de: string; documento: string | null; referente: string | null; observacao: string | null; cancelado: boolean };
type Cli = { id: string; razao_social: string; nome_fantasia: string | null; cpf_cnpj: string | null };
const vazio = () => ({ data: hojeISO(), valor: "", recebemos_de: "", documento: "", cliente_id: "", referente: "", observacao: "" });
const paraNumero = (s: string) => { const t = s.trim(); return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t) || 0; };
const abrir = (id: string) => window.open(`/imprimir/recibo/${id}`, "_blank");

export default function Recibos() {
  const sb = supabaseNavegador();
  const eu = usePerfil();
  const pode = usePode();
  const podeUsar = pode("pedidos_ver_todos") || pode("financeiro");
  const [f, setF] = useState(vazio);
  const [clientes, setClientes] = useState<Cli[]>([]);
  const [lista, setLista] = useState<Recibo[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [sugestoes, setSugestoes] = useState(false);

  const carregar = useCallback(async () => {
    const { data } = await sb.from("recibos").select("*").order("numero", { ascending: false }).limit(50);
    setLista((data ?? []) as Recibo[]);
  }, [sb]);
  useEffect(() => {
    carregar();
    sb.from("clientes").select("id, razao_social, nome_fantasia, cpf_cnpj").eq("ativo", true).order("razao_social").then(({ data }) => setClientes((data ?? []) as Cli[]));
  }, [sb, carregar]);

  const achados = useMemo(() => (f.recebemos_de.trim().length >= 2 && !f.cliente_id ? clientes.filter((c) => combina(`${c.razao_social} ${c.nome_fantasia ?? ""}`, f.recebemos_de)).slice(0, 8) : []), [f.recebemos_de, f.cliente_id, clientes]);
  const valor = paraNumero(f.valor);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!(valor > 0)) return avisar("Coloque o valor do recibo.", "erro");
    if (!f.recebemos_de.trim()) return avisar("Coloque de quem foi recebido (nome da empresa ou pessoa).", "erro");
    setSalvando(true);
    const { data, error } = await sb.from("recibos").insert({
      data: f.data, valor, recebemos_de: f.recebemos_de.trim().toLocaleUpperCase("pt-BR"),
      documento: f.documento.trim() || null, cliente_id: f.cliente_id || null,
      referente: f.referente.trim() || null, observacao: f.observacao.trim() || null,
    }).select("id, numero").single();
    setSalvando(false);
    if (error) return avisar(erroMsg(error), "erro");
    avisar(`Recibo nº ${data.numero} salvo`);
    abrir(data.id);
    setF(vazio());
    carregar();
  }

  async function cancelar(id: string) {
    const { error } = await sb.from("recibos").update({ cancelado: true }).eq("id", id);
    if (error) return avisar(erroMsg(error), "erro");
    avisar("Recibo cancelado");
    carregar();
  }

  if (!podeUsar) return <div className="cartao p-8 text-center"><p className="titulo">Sem acesso</p><p className="text-zinc-500">Você não tem permissão para emitir recibos.</p></div>;

  return (
    <>
      <Cabecalho titulo="Recibos" sub="Preencha o valor e de quem recebeu. O valor por extenso sai sozinho." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <form onSubmit={salvar} className="cartao space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="rotulo" htmlFor="r-valor">Valor (R$)</label>
              <input id="r-valor" className="campo text-xl font-bold" inputMode="decimal" autoFocus placeholder="0,00" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} /></div>
            <div><label className="rotulo" htmlFor="r-data">Data</label>
              <input id="r-data" type="date" className="campo" value={f.data} onChange={(e) => setF({ ...f, data: e.target.value })} /></div>
          </div>
          <div className="relative">
            <label className="rotulo" htmlFor="r-de">Recebemos de (empresa ou pessoa)</label>
            <input id="r-de" className="campo uppercase" autoComplete="off" placeholder="Digite o nome ou escolha um cliente" value={f.recebemos_de}
              onChange={(e) => setF({ ...f, recebemos_de: e.target.value, cliente_id: "" })} onFocus={() => setSugestoes(true)} onBlur={() => setTimeout(() => setSugestoes(false), 150)} />
            {sugestoes && achados.length > 0 && (
              <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
                {achados.map((c) => (
                  <button key={c.id} type="button" onMouseDown={(e) => e.preventDefault()} className="block w-full border-b border-zinc-100 px-3 py-2 text-left last:border-0 hover:bg-marca-100 dark:border-zinc-800 dark:hover:bg-marca-500/20"
                    onClick={() => { setF({ ...f, recebemos_de: c.razao_social, cliente_id: c.id, documento: c.cpf_cnpj ?? f.documento }); setSugestoes(false); }}>
                    <span className="font-medium">{c.razao_social}</span>{c.nome_fantasia && <span className="text-sm text-zinc-500"> · {c.nome_fantasia}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div><label className="rotulo" htmlFor="r-doc">CPF / CNPJ (opcional)</label>
            <input id="r-doc" className="campo" value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} /></div>
          <div><label className="rotulo" htmlFor="r-ref">Referente ao pagamento de</label>
            <input id="r-ref" className="campo" placeholder="Ex.: pedidos 120 e 121, vale, acerto da semana…" value={f.referente} onChange={(e) => setF({ ...f, referente: e.target.value })} /></div>
          <div><label className="rotulo" htmlFor="r-obs">Observação (opcional)</label>
            <input id="r-obs" className="campo" placeholder="Ex.: pago em dinheiro / Pix" value={f.observacao} onChange={(e) => setF({ ...f, observacao: e.target.value })} /></div>
          <div className="rounded-lg bg-marca-50 p-3 text-sm dark:bg-marca-500/10">
            <b>Prévia:</b> Recebemos de <b>{f.recebemos_de.trim().toLocaleUpperCase("pt-BR") || "______"}</b> a importância de <b>{fmtMoeda(valor)}</b> ({valorPorExtenso(valor)}){f.referente.trim() ? <>, referente a <b>{f.referente.trim()}</b></> : ""}.
          </div>
          <Botao type="submit" tamanho="g" className="w-full" carregando={salvando}>Salvar e imprimir recibo</Botao>
        </form>

        <section>
          <h2 className="titulo mb-2 text-lg">Últimos recibos</h2>
          {lista.length === 0 ? <Vazio>Nenhum recibo ainda.</Vazio> : (
            <div className="cartao divide-y divide-zinc-100 dark:divide-zinc-800">
              {lista.map((r) => (
                <div key={r.id} className={`flex items-center justify-between gap-3 p-3 ${r.cancelado ? "opacity-50" : ""}`}>
                  <div className="min-w-0">
                    <div className="font-semibold">Nº {r.numero} · {r.recebemos_de}{r.cancelado && " (cancelado)"}</div>
                    <div className="text-sm text-zinc-500">{fmtData(r.data)}{r.referente ? ` · ${r.referente}` : ""}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <b className="mr-2 whitespace-nowrap">{fmtMoeda(r.valor)}</b>
                    {!r.cancelado && <Botao variante="secundario" tamanho="p" onClick={() => abrir(r.id)}>🖨</Botao>}
                    {!r.cancelado && eu.admin && <BotaoConfirmar variante="fantasma" tamanho="p" aoConfirmar={() => cancelar(r.id)} textoConfirmar="Cancelar?">✕</BotaoConfirmar>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
