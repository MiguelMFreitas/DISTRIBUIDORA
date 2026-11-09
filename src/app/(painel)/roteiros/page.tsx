"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { combina, erroMsg } from "@/lib/formato";
import { Botao, Cabecalho, Modal, Vazio, avisar } from "@/components/ui";
import { usePode } from "@/components/perfil-contexto";

type Rota = { id: string; nome: string; vendedor_id: string | null; ativo: boolean };
type Cli = { id: string; razao_social: string; nome_fantasia: string | null; endereco: string | null; numero: string | null; bairro: string | null; telefone: string | null; rota_id: string | null; vendedor_id: string | null; ordem_visita: number | null; ativo: boolean };
type Vend = { id: string; nome: string };

const endereco = (c: Cli) => [c.endereco && `${c.endereco}${c.numero ? ", " + c.numero : ""}`, c.bairro].filter(Boolean).join(" · ");

export default function Roteiros() {
  const sb = supabaseNavegador();
  const pode = usePode();
  const podeEditar = pode("clientes") || pode("cadastros");
  const [rotas, setRotas] = useState<Rota[]>([]);
  const [clientes, setClientes] = useState<Cli[]>([]);
  const [vends, setVends] = useState<Vend[]>([]);
  const [rotaId, setRotaId] = useState<string>("");
  const [ordem, setOrdem] = useState<Cli[]>([]);       // clientes na ordem de visita
  const [salvo, setSalvo] = useState<string>("");      // para saber se mudou
  const [busca, setBusca] = useState("");
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [troca, setTroca] = useState<{ vendedor: string; mover: boolean } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const [{ data: r }, { data: c }, { data: v }] = await Promise.all([
      sb.from("rotas").select("id, nome, vendedor_id, ativo").order("nome"),
      sb.from("clientes").select("id, razao_social, nome_fantasia, endereco, numero, bairro, telefone, rota_id, vendedor_id, ordem_visita, ativo").eq("ativo", true).order("razao_social"),
      sb.from("perfis").select("id, nome, admin, permissoes, ativo").eq("ativo", true).order("nome"),
    ]);
    setRotas((r ?? []) as Rota[]);
    setClientes((c ?? []) as Cli[]);
    setVends(((v ?? []) as (Vend & { admin: boolean; permissoes: string[] })[]).filter((x) => x.admin || x.permissoes.includes("pedidos_criar")));
  }, [sb]);
  useEffect(() => { carregar(); }, [carregar]);

  const rota = rotas.find((r) => r.id === rotaId);
  const nomeVend = (id: string | null) => vends.find((v) => v.id === id)?.nome ?? null;

  // ao escolher a rota (ou recarregar), monta a lista na ordem salva
  useEffect(() => {
    if (!rotaId) return;
    const daRota = clientes.filter((c) => c.rota_id === rotaId && c.ordem_visita != null).sort((a, b) => a.ordem_visita! - b.ordem_visita!);
    setOrdem(daRota);
    setSalvo(daRota.map((c) => c.id).join(","));
  }, [rotaId, clientes]);

  const semOrdem = useMemo(() => clientes.filter((c) => c.rota_id === rotaId && !ordem.some((o) => o.id === c.id)), [clientes, rotaId, ordem]);
  const mudou = ordem.map((c) => c.id).join(",") !== salvo;

  function mover(de: number, para: number) {
    if (para < 0 || para >= ordem.length || de === para) return;
    const l = [...ordem]; const [x] = l.splice(de, 1); l.splice(para, 0, x); setOrdem(l);
  }
  function irPara(i: number, texto: string) {
    const pos = Math.round(Number(texto));
    if (!pos) return;
    mover(i, Math.min(Math.max(pos, 1), ordem.length) - 1);
  }

  async function salvar() {
    setSalvando(true);
    const { error } = await sb.rpc("salvar_ordem_visitas", { p_rota: rotaId, p_clientes: ordem.map((c) => c.id) });
    setSalvando(false);
    if (error) return avisar(erroMsg(error), "erro");
    avisar("Roteiro salvo");
    carregar();
  }

  async function trocarVendedor() {
    if (!troca) return;
    const { error } = await sb.rpc("definir_vendedor_rota", { p_rota: rotaId, p_vendedor: troca.vendedor || null, p_mover_clientes: troca.mover });
    if (error) return avisar(erroMsg(error), "erro");
    avisar(troca.vendedor ? `Agora ${nomeVend(troca.vendedor)} é o responsável pela rota ${rota?.nome}` : "Rota sem vendedor responsável");
    setTroca(null);
    carregar();
  }

  function imprimir() {
    if (mudou) return avisar("Salve o roteiro antes de imprimir.", "erro");
    window.open(`/imprimir/roteiro/${rotaId}`, "_blank");
  }

  return (
    <>
      <Cabecalho titulo="Roteiro de visitas" sub="Coloque os clientes de cada rota na ordem em que o vendedor visita, do 1º ao último. Se trocar o vendedor, o novo segue a mesma ordem." />

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* rotas */}
        <aside className="space-y-2">
          {rotas.length === 0 && <Vazio>Nenhuma rota cadastrada. Cadastre em “Rotas, motoristas…”.</Vazio>}
          {rotas.filter((r) => r.ativo).map((r) => {
            const total = clientes.filter((c) => c.rota_id === r.id).length;
            const sem = clientes.filter((c) => c.rota_id === r.id && c.ordem_visita == null).length;
            return (
              <button key={r.id} onClick={() => {
                if (mudou && r.id !== rotaId) return avisar("Salve a ordem desta rota antes de abrir outra (ou recarregue a página para descartar).", "erro");
                setRotaId(r.id); setBusca("");
              }}
                className={`cartao block w-full p-3 text-left ${r.id === rotaId ? "border-marca-500 ring-2 ring-marca-500/30" : "hover:border-zinc-400"}`}>
                <div className="font-semibold">{r.nome}</div>
                <div className="text-sm text-zinc-500">👤 {nomeVend(r.vendedor_id) ?? <span className="text-amber-600">sem vendedor</span>} · {total} clientes</div>
                {sem > 0 && <div className="text-xs font-semibold text-amber-600">{sem} sem posição no roteiro</div>}
              </button>
            );
          })}
        </aside>

        {/* roteiro da rota escolhida */}
        <section className="min-w-0">
          {!rota ? <Vazio>Escolha uma rota ao lado.</Vazio> : (
            <div className="space-y-4">
              <div className="cartao flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="titulo text-2xl">Rota {rota.nome}</div>
                  <div className="text-zinc-500">Vendedor responsável: <b className="text-zinc-800 dark:text-zinc-200">{nomeVend(rota.vendedor_id) ?? "nenhum"}</b></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {podeEditar && <Botao variante="secundario" onClick={() => setTroca({ vendedor: rota.vendedor_id ?? "", mover: true })}>👤 Trocar vendedor</Botao>}
                  <Botao variante="secundario" onClick={imprimir} disabled={!ordem.length}>🖨 Imprimir roteiro</Botao>
                  {podeEditar && <Botao onClick={salvar} disabled={!mudou} carregando={salvando}>Salvar ordem</Botao>}
                </div>
              </div>
              {mudou && <p className="rounded-lg bg-marca-50 p-2 text-sm font-semibold text-marca-700 dark:bg-marca-500/10 dark:text-marca-100">Você mudou a ordem. Clique em “Salvar ordem” para valer.</p>}

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="titulo text-lg">Ordem de visita ({ordem.length})</h2>
                  <input className="campo max-w-xs" placeholder="Achar cliente na lista…" value={busca} onChange={(e) => setBusca(e.target.value)} />
                </div>
                {ordem.length === 0 ? <Vazio>Nenhum cliente no roteiro ainda. Adicione da lista “Sem posição” abaixo, na ordem da visita.</Vazio> : (
                  <ol className="cartao divide-y divide-zinc-100 dark:divide-zinc-800">
                    {ordem.map((c, i) => {
                      const achou = busca.trim() && combina(`${c.razao_social} ${c.nome_fantasia ?? ""} ${c.bairro ?? ""}`, busca);
                      return (
                        <li key={c.id} draggable={podeEditar}
                          onDragStart={() => setArrastando(i)}
                          onDragOver={(e) => { e.preventDefault(); if (arrastando !== null && arrastando !== i) { mover(arrastando, i); setArrastando(i); } }}
                          onDragEnd={() => setArrastando(null)}
                          className={`flex items-center gap-3 px-3 py-2 ${arrastando === i ? "opacity-50" : ""} ${achou ? "bg-amber-50 dark:bg-amber-500/10" : ""}`}>
                          {podeEditar && <span className="cursor-grab select-none text-zinc-400" aria-hidden>⋮⋮</span>}
                          {podeEditar ? (
                            <input className="h-9 w-12 shrink-0 rounded-lg bg-marca-500 text-center font-display text-lg font-bold text-white" defaultValue={i + 1} key={`${c.id}-${i}`}
                              aria-label={`Posição de ${c.razao_social}`} inputMode="numeric"
                              onBlur={(e) => irPara(i, e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} title="Digite a posição e aperte Enter" />
                          ) : <span className="grid h-9 w-12 shrink-0 place-items-center rounded-lg bg-marca-500 font-display text-lg font-bold text-white">{i + 1}</span>}
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-semibold">{c.razao_social}{c.nome_fantasia && <span className="font-normal text-zinc-500"> · {c.nome_fantasia}</span>}</div>
                            <div className="truncate text-xs text-zinc-500">{endereco(c) || "sem endereço"}{c.telefone ? ` · ${c.telefone}` : ""}</div>
                          </div>
                          {podeEditar && (
                            <div className="flex shrink-0">
                              <Botao variante="fantasma" tamanho="p" aria-label="Subir" disabled={i === 0} onClick={() => mover(i, i - 1)}>▲</Botao>
                              <Botao variante="fantasma" tamanho="p" aria-label="Descer" disabled={i === ordem.length - 1} onClick={() => mover(i, i + 1)}>▼</Botao>
                              <Botao variante="fantasma" tamanho="p" aria-label="Tirar do roteiro" onClick={() => setOrdem((l) => l.filter((x) => x.id !== c.id))}>✕</Botao>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
                {podeEditar && <p className="mt-1 text-xs text-zinc-500">Arraste, use as setas ou digite o número da posição no quadrado laranja e aperte Enter.</p>}
              </div>

              {semOrdem.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h2 className="titulo text-lg">Sem posição ({semOrdem.length})</h2>
                    {podeEditar && <Botao variante="secundario" tamanho="p" onClick={() => setOrdem((l) => [...l, ...semOrdem])}>Adicionar todos ao fim</Botao>}
                  </div>
                  <div className="cartao divide-y divide-zinc-100 dark:divide-zinc-800">
                    {semOrdem.map((c) => (
                      <div key={c.id} className="flex items-center gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{c.razao_social}</div>
                          <div className="truncate text-xs text-zinc-500">{endereco(c)}</div>
                        </div>
                        {podeEditar && <Botao tamanho="p" onClick={() => setOrdem((l) => [...l, c])}>+ Pôr na posição {ordem.length + 1}</Botao>}
                      </div>
                    ))}
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">Clientes desta rota que ainda não estão no roteiro. A rota do cliente se escolhe no cadastro de Clientes.</p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <Modal aberto={!!troca} aoFechar={() => setTroca(null)} titulo={`Vendedor da rota ${rota?.nome ?? ""}`} largura="max-w-md"
        rodape={<><Botao variante="secundario" onClick={() => setTroca(null)}>Cancelar</Botao><Botao onClick={trocarVendedor}>Confirmar</Botao></>}>
        {troca && (
          <div className="space-y-3">
            <div>
              <label className="rotulo" htmlFor="tv">Novo vendedor responsável</label>
              <select id="tv" className="campo" value={troca.vendedor} onChange={(e) => setTroca({ ...troca, vendedor: e.target.value })}>
                <option value="">— nenhum —</option>
                {vends.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
              </select>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 size-4" checked={troca.mover} onChange={(e) => setTroca({ ...troca, mover: e.target.checked })} />
              <span>Passar também os clientes da rota para a carteira do novo vendedor (eles aparecem com ★ no celular dele e contam para ele).</span>
            </label>
            <p className="text-sm text-zinc-500">A ordem de visita continua a mesma. O novo vendedor vê o roteiro no celular dele.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
