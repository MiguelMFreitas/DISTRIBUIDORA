"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { alfa, combina, erroMsg } from "@/lib/formato";
import { Botao, BotaoConfirmar, Modal, Vazio, avisar } from "./ui";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Linha = Record<string, any>;

export type Campo = {
  nome: string;
  rotulo: string;
  tipo?: "texto" | "numero" | "moeda" | "bool" | "select" | "area";
  opcoes?: { valor: string; nome: string }[];
  ref?: { tabela: string; rotulo: string; ordem?: string };
  obrigatorio?: boolean;
  largura?: 1 | 2 | 3 | 6; // em sextos da linha
  ajuda?: string;
  padrao?: any;
  passo?: number;
  maiusculo?: boolean;
};

export type Coluna = {
  rotulo: string;
  valor: (l: Linha, refs: Record<string, Record<string, string>>) => React.ReactNode;
  classe?: string;
};

type Props = {
  tabela: string;
  singular: string;
  campos: Campo[];
  colunas: Coluna[];
  buscaEm: string[];
  ordem: string;
  podeEditar: boolean;
  select?: string;
  /** Recarrega quando muda (ex.: depois de uma entrada de estoque) */
  versao?: number;
  acoesExtras?: (l: Linha, recarregar: () => void) => React.ReactNode;
  filtros?: (linhas: Linha[]) => { nome: string; teste: (l: Linha) => boolean }[];
};

const LARG: Record<number, string> = { 1: "sm:col-span-1", 2: "sm:col-span-2", 3: "sm:col-span-3", 6: "sm:col-span-6" };

export function Cadastro({ tabela, singular, campos, colunas, buscaEm, ordem, podeEditar, select = "*", versao = 0, acoesExtras, filtros }: Props) {
  const sb = supabaseNavegador();
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [refs, setRefs] = useState<Record<string, Record<string, string>>>({});
  const [opcoesRef, setOpcoesRef] = useState<Record<string, { valor: string; nome: string }[]>>({});
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState("");
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [filtro, setFiltro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Linha | null>(null);
  const [salvando, setSalvando] = useState(false);

  const temAtivo = campos.some((c) => c.nome === "ativo");

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await sb.from(tabela).select(select).order(ordem);
    if (error) avisar(erroMsg(error), "erro");
    // ordem alfabética do português (o banco põe palavras com acento no fim)
    const lista = ((data as unknown as Linha[]) ?? []).slice();
    if (lista.length && typeof lista[0][ordem] === "string") lista.sort((a, b) => alfa(a[ordem], b[ordem]));
    setLinhas(lista);
    // tabelas ligadas (rota, categoria, vendedor...)
    const novasRefs: Record<string, Record<string, string>> = {};
    const novasOpcoes: Record<string, { valor: string; nome: string }[]> = {};
    await Promise.all(
      campos
        .filter((c) => c.ref)
        .map(async (c) => {
          const r = c.ref!;
          const { data: d } = await sb.from(r.tabela).select(`id, ${r.rotulo}`).order(r.ordem ?? r.rotulo);
          const lista = ((d as unknown as Linha[]) ?? []).map((x) => ({ valor: x.id as string, nome: x[r.rotulo] as string }));
          if (!r.ordem || r.ordem === r.rotulo) lista.sort((a, b) => alfa(a.nome, b.nome));
          novasOpcoes[c.nome] = lista;
          novasRefs[c.nome] = Object.fromEntries(lista.map((x) => [x.valor, x.nome]));
        }),
    );
    setRefs(novasRefs);
    setOpcoesRef(novasOpcoes);
    setCarregando(false);
  }, [sb, tabela, select, ordem, campos]);

  useEffect(() => { carregar(); }, [carregar, versao]);

  const listaFiltros = useMemo(() => (filtros ? filtros(linhas) : []), [filtros, linhas]);

  const visiveis = useMemo(() => {
    let l = linhas;
    if (temAtivo && !mostrarInativos) l = l.filter((x) => x.ativo);
    if (filtro) {
      const f = listaFiltros.find((x) => x.nome === filtro);
      if (f) l = l.filter(f.teste);
    }
    if (busca.trim()) l = l.filter((x) => combina(buscaEm.map((c) => x[c] ?? "").join(" "), busca));
    return l;
  }, [linhas, temAtivo, mostrarInativos, busca, buscaEm, filtro, listaFiltros]);

  function novo() {
    const l: Linha = {};
    campos.forEach((c) => { l[c.nome] = c.padrao ?? (c.tipo === "bool" ? false : ""); });
    setEditando(l);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    setSalvando(true);
    const dados: Linha = {};
    for (const c of campos) {
      let v = editando[c.nome];
      if (c.tipo === "numero" || c.tipo === "moeda") v = v === "" || v == null ? (c.obrigatorio ? 0 : null) : Number(String(v).replace(",", "."));
      else if (c.tipo === "bool") v = !!v;
      else if (typeof v === "string") { v = v.trim(); if (c.maiusculo) v = v.toLocaleUpperCase("pt-BR"); if (v === "") v = null; }
      dados[c.nome] = v;
    }
    const q = editando.id ? sb.from(tabela).update(dados).eq("id", editando.id) : sb.from(tabela).insert(dados);
    const { error } = await q;
    setSalvando(false);
    if (error) {
      avisar(error.code === "23505" ? "Já existe um cadastro com esse nome ou código." : erroMsg(error), "erro");
      return;
    }
    avisar(`${singular} salvo`);
    setEditando(null);
    carregar();
  }

  async function apagar(id: string) {
    const { error } = await sb.from(tabela).delete().eq("id", id);
    if (error) {
      avisar(error.code === "23503" ? "Não dá para apagar: já foi usado em pedidos. Desmarque “Ativo” para esconder." : erroMsg(error), "erro");
      return;
    }
    avisar(`${singular} apagado`);
    setEditando(null);
    carregar();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input className="campo max-w-sm flex-1" placeholder="Pesquisar…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        {listaFiltros.map((f) => (
          <button key={f.nome} onClick={() => setFiltro(filtro === f.nome ? null : f.nome)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${filtro === f.nome ? "border-marca-500 bg-marca-500 text-white" : "border-zinc-300 dark:border-zinc-700"}`}>
            {f.nome}
          </button>
        ))}
        {temAtivo && (
          <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" checked={mostrarInativos} onChange={(e) => setMostrarInativos(e.target.checked)} /> Mostrar inativos
          </label>
        )}
        <div className="flex-1" />
        <span className="text-sm text-zinc-500">{visiveis.length} de {linhas.length}</span>
        {podeEditar && <Botao onClick={novo}>+ Novo</Botao>}
      </div>

      {carregando ? (
        <div className="cartao p-8 text-center text-zinc-500">Carregando…</div>
      ) : visiveis.length === 0 ? (
        <Vazio>{linhas.length ? "Nada encontrado com essa pesquisa." : `Nenhum cadastro ainda. ${podeEditar ? "Clique em “+ Novo”." : ""}`}</Vazio>
      ) : (
        <div className="cartao overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
              <tr>
                {colunas.map((c) => <th key={c.rotulo} className={`px-3 py-2 font-semibold ${c.classe ?? ""}`}>{c.rotulo}</th>)}
                <th className="w-px px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visiveis.slice(0, 300).map((l) => (
                <tr key={l.id} className={`border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50 ${temAtivo && !l.ativo ? "opacity-50" : ""}`}>
                  {colunas.map((c) => <td key={c.rotulo} className={`px-3 py-2 ${c.classe ?? ""}`}>{c.valor(l, refs)}</td>)}
                  <td className="whitespace-nowrap px-3 py-1.5 text-right">
                    {acoesExtras?.(l, carregar)}
                    {podeEditar && <Botao variante="fantasma" tamanho="p" onClick={() => setEditando({ ...l })}>Editar</Botao>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visiveis.length > 300 && <p className="p-3 text-center text-sm text-zinc-500">Mostrando 300. Use a pesquisa para achar os outros.</p>}
        </div>
      )}

      <Modal
        aberto={!!editando}
        aoFechar={() => setEditando(null)}
        titulo={editando?.id ? `Editar ${singular.toLowerCase()}` : `Novo ${singular.toLowerCase()}`}
        rodape={
          <>
            {editando?.id && <BotaoConfirmar variante="secundario" className="mr-auto" aoConfirmar={() => apagar(editando.id)} textoConfirmar="Apagar mesmo?">Apagar</BotaoConfirmar>}
            <Botao variante="secundario" onClick={() => setEditando(null)}>Cancelar</Botao>
            <Botao type="submit" form="form-cadastro" carregando={salvando}>Salvar</Botao>
          </>
        }
      >
        {editando && (
          <form id="form-cadastro" onSubmit={salvar} className="grid grid-cols-1 gap-3 sm:grid-cols-6">
            {campos.map((c) => (
              <div key={c.nome} className={LARG[c.largura ?? 6]}>
                {c.tipo === "bool" ? (
                  <label className="flex h-full items-center gap-2 pt-5 font-medium">
                    <input type="checkbox" className="size-5 accent-marca-500" checked={!!editando[c.nome]} onChange={(e) => setEditando({ ...editando, [c.nome]: e.target.checked })} />
                    {c.rotulo}
                  </label>
                ) : (
                  <>
                    <label className="rotulo" htmlFor={`c-${c.nome}`}>{c.rotulo}{c.obrigatorio && " *"}</label>
                    {c.tipo === "select" || c.ref ? (
                      <select id={`c-${c.nome}`} className="campo" required={c.obrigatorio} value={editando[c.nome] ?? ""} onChange={(e) => setEditando({ ...editando, [c.nome]: e.target.value || null })}>
                        {!c.obrigatorio && <option value="">—</option>}
                        {(c.opcoes ?? opcoesRef[c.nome] ?? []).map((o) => <option key={o.valor} value={o.valor}>{o.nome}</option>)}
                      </select>
                    ) : c.tipo === "area" ? (
                      <textarea id={`c-${c.nome}`} className="campo min-h-20" value={editando[c.nome] ?? ""} onChange={(e) => setEditando({ ...editando, [c.nome]: e.target.value })} />
                    ) : (
                      <input
                        id={`c-${c.nome}`}
                        className={`campo ${c.maiusculo ? "uppercase" : ""}`}
                        required={c.obrigatorio}
                        type={c.tipo === "numero" || c.tipo === "moeda" ? "number" : "text"}
                        step={c.tipo === "moeda" ? 0.01 : c.passo ?? "any"}
                        inputMode={c.tipo === "numero" || c.tipo === "moeda" ? "decimal" : undefined}
                        value={editando[c.nome] ?? ""}
                        onChange={(e) => setEditando({ ...editando, [c.nome]: e.target.value })}
                      />
                    )}
                  </>
                )}
                {c.ajuda && <p className="mt-1 text-xs text-zinc-500">{c.ajuda}</p>}
              </div>
            ))}
          </form>
        )}
      </Modal>
    </div>
  );
}
