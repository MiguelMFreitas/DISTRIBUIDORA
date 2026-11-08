"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg } from "@/lib/formato";
import { Botao, BotaoConfirmar, Cabecalho, Vazio, avisar } from "@/components/ui";
import { Exige } from "@/components/perfil-contexto";

type Cat = { id: string; nome: string; ordem: number; qtd?: number };

export default function Categorias() {
  const sb = supabaseNavegador();
  const [lista, setLista] = useState<Cat[]>([]);
  const [nova, setNova] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [nomeEdit, setNomeEdit] = useState("");
  const [arrastando, setArrastando] = useState<number | null>(null);
  const [mudou, setMudou] = useState(false);

  const carregar = useCallback(async () => {
    const [{ data: cats }, { data: prods }] = await Promise.all([
      sb.from("categorias").select("id, nome, ordem").order("ordem").order("nome"),
      sb.from("produtos").select("categoria_id").eq("ativo", true),
    ]);
    const cont: Record<string, number> = {};
    (prods ?? []).forEach((p: { categoria_id: string | null }) => { if (p.categoria_id) cont[p.categoria_id] = (cont[p.categoria_id] ?? 0) + 1; });
    setLista(((cats ?? []) as Cat[]).map((c) => ({ ...c, qtd: cont[c.id] ?? 0 })));
    setMudou(false);
  }, [sb]);
  useEffect(() => { carregar(); }, [carregar]);

  function mover(de: number, para: number) {
    if (para < 0 || para >= lista.length || de === para) return;
    const l = [...lista];
    const [x] = l.splice(de, 1);
    l.splice(para, 0, x);
    setLista(l);
    setMudou(true);
  }

  async function salvarOrdem() {
    const res = await Promise.all(lista.map((c, i) => sb.from("categorias").update({ ordem: i + 1 }).eq("id", c.id)));
    const erro = res.find((r) => r.error)?.error;
    if (erro) return avisar(erroMsg(erro), "erro");
    avisar("Ordem salva. O romaneio já sai nessa ordem.");
    carregar();
  }

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    const nome = nova.trim();
    if (!nome) return;
    const ordem = (lista.at(-1)?.ordem ?? 0) + 1;
    const { error } = await sb.from("categorias").insert({ nome, ordem });
    if (error) return avisar(error.code === "23505" ? "Essa categoria já existe." : erroMsg(error), "erro");
    setNova("");
    carregar();
  }

  async function renomear(id: string) {
    const { error } = await sb.from("categorias").update({ nome: nomeEdit.trim() }).eq("id", id);
    if (error) return avisar(erroMsg(error), "erro");
    setEditando(null);
    carregar();
  }

  async function apagar(id: string) {
    const { error } = await sb.from("categorias").delete().eq("id", id);
    if (error) return avisar(erroMsg(error), "erro");
    avisar("Categoria apagada. Os produtos dela ficaram sem categoria.");
    carregar();
  }

  return (
    <Exige perm="produtos">
      <Cabecalho titulo="Ordem de carregamento" sub="Arraste ou use as setas. O romaneio lista os produtos nesta ordem: o 1º é o primeiro a subir no caminhão.">
        {mudou && <Botao onClick={salvarOrdem}>Salvar ordem</Botao>}
      </Cabecalho>

      <form onSubmit={adicionar} className="mb-4 flex max-w-xl gap-2">
        <input className="campo" placeholder="Nova categoria (ex.: Refrigerante 2L)" value={nova} onChange={(e) => setNova(e.target.value)} />
        <Botao type="submit">Adicionar</Botao>
      </form>

      {lista.length === 0 ? (
        <Vazio>Nenhuma categoria. Crie a primeira acima, por exemplo “Caixas de vasilhame”.</Vazio>
      ) : (
        <ol className="max-w-xl space-y-2">
          {lista.map((c, i) => (
            <li
              key={c.id}
              draggable
              onDragStart={() => setArrastando(i)}
              onDragOver={(e) => { e.preventDefault(); if (arrastando !== null && arrastando !== i) { mover(arrastando, i); setArrastando(i); } }}
              onDragEnd={() => setArrastando(null)}
              className={`cartao flex items-center gap-3 p-2 pl-3 ${arrastando === i ? "opacity-50 ring-2 ring-marca-500" : ""}`}
            >
              <span className="cursor-grab select-none text-zinc-400" aria-hidden>⋮⋮</span>
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-marca-500 font-display text-lg font-bold text-white">{i + 1}</span>
              {editando === c.id ? (
                <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); renomear(c.id); }}>
                  <input className="campo" autoFocus value={nomeEdit} onChange={(e) => setNomeEdit(e.target.value)} />
                  <Botao type="submit" tamanho="p">OK</Botao>
                </form>
              ) : (
                <button className="flex-1 text-left" onClick={() => { setEditando(c.id); setNomeEdit(c.nome); }} title="Clique para renomear">
                  <span className="font-semibold">{c.nome}</span>
                  <span className="ml-2 text-sm text-zinc-500">{c.qtd} produto{c.qtd === 1 ? "" : "s"}</span>
                </button>
              )}
              <div className="flex">
                <Botao variante="fantasma" tamanho="p" aria-label="Subir" onClick={() => mover(i, i - 1)} disabled={i === 0}>▲</Botao>
                <Botao variante="fantasma" tamanho="p" aria-label="Descer" onClick={() => mover(i, i + 1)} disabled={i === lista.length - 1}>▼</Botao>
                <BotaoConfirmar variante="fantasma" tamanho="p" aoConfirmar={() => apagar(c.id)} textoConfirmar="Apagar?">✕</BotaoConfirmar>
              </div>
            </li>
          ))}
        </ol>
      )}
      {mudou && <div className="mt-4"><Botao onClick={salvarOrdem}>Salvar ordem</Botao></div>}
    </Exige>
  );
}
