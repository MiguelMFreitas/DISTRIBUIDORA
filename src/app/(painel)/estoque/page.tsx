"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { combina, erroMsg, fmtDataHora, fmtQtd } from "@/lib/formato";
import type { Produto } from "@/lib/tipos";
import { Botao, Cabecalho, Modal, Selo, avisar } from "@/components/ui";
import { BuscaProduto } from "@/components/busca-produto";
import { Exige } from "@/components/perfil-contexto";

type Mov = { id: string; tipo: string; quantidade: number; saldo: number; observacao: string | null; criado_em: string; produtos: { nome: string } | null; perfis: { nome: string } | null };
const TIPOS: Record<string, string> = { entrada: "Entrada", venda: "Venda", cancelamento: "Cancelamento", devolucao: "Devolução", ajuste: "Ajuste" };

export default function Estoque() {
  const sb = supabaseNavegador();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [movs, setMovs] = useState<Mov[]>([]);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "baixo" | "zerado">("todos");
  const [entrada, setEntrada] = useState(false);
  const [linhas, setLinhas] = useState<{ p: Produto; qtd: string }[]>([]);
  const [obs, setObs] = useState("");
  const [ajuste, setAjuste] = useState<{ p: Produto; valor: string; obs: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const [{ data: p }, { data: m }] = await Promise.all([
      sb.from("produtos").select("*").eq("ativo", true).order("nome"),
      sb.from("estoque_movimentos").select("id, tipo, quantidade, saldo, observacao, criado_em, produtos(nome), perfis(nome)").order("criado_em", { ascending: false }).limit(60),
    ]);
    setProdutos((p ?? []) as Produto[]);
    setMovs((m ?? []) as unknown as Mov[]);
  }, [sb]);
  useEffect(() => { carregar(); }, [carregar]);

  const lista = useMemo(() => {
    let l = produtos;
    if (filtro === "baixo") l = l.filter((p) => p.estoque > 0 && p.estoque <= p.estoque_minimo);
    if (filtro === "zerado") l = l.filter((p) => p.estoque <= 0);
    if (busca.trim()) l = l.filter((p) => combina(`${p.nome} ${p.codigo ?? ""}`, busca));
    return l;
  }, [produtos, filtro, busca]);

  const nBaixo = produtos.filter((p) => p.estoque > 0 && p.estoque <= p.estoque_minimo).length;
  const nZerado = produtos.filter((p) => p.estoque <= 0).length;

  async function lancarEntrada() {
    const validas = linhas.filter((l) => Number(l.qtd.replace(",", ".")) > 0);
    if (!validas.length) return avisar("Coloque a quantidade de pelo menos um produto.", "erro");
    setSalvando(true);
    for (const l of validas) {
      const { error } = await sb.rpc("entrada_estoque", { p_produto: l.p.id, p_quantidade: Number(l.qtd.replace(",", ".")), p_observacao: obs || null });
      if (error) { setSalvando(false); avisar(`${l.p.nome}: ${erroMsg(error)}`, "erro"); carregar(); return; }
      setLinhas((x) => x.filter((y) => y.p.id !== l.p.id));
    }
    setSalvando(false);
    avisar(`Entrada de ${validas.length} produto(s) lançada`);
    setEntrada(false); setLinhas([]); setObs("");
    carregar();
  }

  async function salvarAjuste() {
    if (!ajuste) return;
    const { error } = await sb.rpc("ajustar_estoque", { p_produto: ajuste.p.id, p_novo_saldo: Number(ajuste.valor.replace(",", ".")), p_observacao: ajuste.obs || null });
    if (error) return avisar(erroMsg(error), "erro");
    avisar("Estoque ajustado");
    setAjuste(null);
    carregar();
  }

  return (
    <Exige perm="estoque">
      <Cabecalho titulo="Estoque" sub="Lance aqui a mercadoria que chegou. Pedidos baixam o estoque sozinhos.">
        <Botao onClick={() => setEntrada(true)}>+ Lançar entrada</Botao>
      </Cabecalho>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input className="campo max-w-xs" placeholder="Pesquisar produto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            {([["todos", `Todos (${produtos.length})`], ["baixo", `Estoque baixo (${nBaixo})`], ["zerado", `Sem estoque (${nZerado})`]] as const).map(([k, n]) => (
              <button key={k} onClick={() => setFiltro(k)} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${filtro === k ? "border-marca-500 bg-marca-500 text-white" : "border-zinc-300 dark:border-zinc-700"}`}>{n}</button>
            ))}
          </div>
          <div className="cartao overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <tr><th className="px-3 py-2">Produto</th><th className="px-3 py-2">Un.</th><th className="px-3 py-2 text-right">Mínimo</th><th className="px-3 py-2 text-right">Estoque</th><th /></tr>
              </thead>
              <tbody>
                {lista.slice(0, 300).map((p) => (
                  <tr key={p.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-3 py-2 font-medium">{p.nome}</td>
                    <td className="px-3 py-2">{p.unidade}</td>
                    <td className="px-3 py-2 text-right text-zinc-500">{fmtQtd(p.estoque_minimo)}</td>
                    <td className="px-3 py-2 text-right">
                      <Selo cor={p.estoque <= 0 ? "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200" : p.estoque <= p.estoque_minimo ? "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200" : "bg-zinc-100 dark:bg-zinc-800"}>{fmtQtd(p.estoque)}</Selo>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      <Botao variante="fantasma" tamanho="p" onClick={() => { setLinhas([{ p, qtd: "" }]); setEntrada(true); }}>Entrada</Botao>
                      <Botao variante="fantasma" tamanho="p" onClick={() => setAjuste({ p, valor: String(p.estoque), obs: "" })}>Ajustar</Botao>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="titulo mb-2 text-lg">Últimos movimentos</h2>
          <div className="cartao divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {movs.length === 0 && <p className="p-4 text-zinc-500">Nenhum movimento ainda.</p>}
            {movs.map((m) => (
              <div key={m.id} className="flex items-start justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="font-medium">{m.produtos?.nome}</div>
                  <div className="text-xs text-zinc-500">{TIPOS[m.tipo]} · {fmtDataHora(m.criado_em)}{m.perfis ? ` · ${m.perfis.nome}` : ""}{m.observacao ? ` · ${m.observacao}` : ""}</div>
                </div>
                <div className="text-right">
                  <div className={`font-semibold ${m.quantidade > 0 ? "text-emerald-600" : "text-red-600"}`}>{m.quantidade > 0 ? "+" : ""}{fmtQtd(m.quantidade)}</div>
                  <div className="text-xs text-zinc-500">saldo {fmtQtd(m.saldo)}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <Modal aberto={entrada} aoFechar={() => setEntrada(false)} titulo="Lançar entrada de mercadoria"
        rodape={<><Botao variante="secundario" onClick={() => setEntrada(false)}>Cancelar</Botao><Botao onClick={lancarEntrada} carregando={salvando}>Lançar entrada</Botao></>}>
        <div className="space-y-3">
          <BuscaProduto produtos={produtos} placeholder="Pesquise e adicione os produtos que chegaram…"
            aoEscolher={(p) => setLinhas((l) => (l.some((x) => x.p.id === p.id) ? l : [...l, { p, qtd: "" }]))} />
          {linhas.length === 0 && <p className="text-sm text-zinc-500">Adicione os produtos da nota.</p>}
          {linhas.map((l, i) => (
            <div key={l.p.id} className="flex items-center gap-2">
              <span className="flex-1 font-medium">{l.p.nome} <span className="text-sm text-zinc-500">({l.p.unidade}, hoje {fmtQtd(l.p.estoque)})</span></span>
              <input className="campo w-28 text-right" inputMode="decimal" placeholder="Qtd" autoFocus={i === linhas.length - 1} value={l.qtd}
                onChange={(e) => setLinhas((x) => x.map((y) => (y.p.id === l.p.id ? { ...y, qtd: e.target.value } : y)))} />
              <Botao variante="fantasma" tamanho="p" onClick={() => setLinhas((x) => x.filter((y) => y.p.id !== l.p.id))}>✕</Botao>
            </div>
          ))}
          <div>
            <label className="rotulo">Observação (nota fiscal, fornecedor…)</label>
            <input className="campo" value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>
      </Modal>

      <Modal aberto={!!ajuste} aoFechar={() => setAjuste(null)} titulo="Ajustar estoque" largura="max-w-md"
        rodape={<><Botao variante="secundario" onClick={() => setAjuste(null)}>Cancelar</Botao><Botao onClick={salvarAjuste}>Salvar</Botao></>}>
        {ajuste && (
          <div className="space-y-3">
            <p className="font-semibold">{ajuste.p.nome}</p>
            <p className="text-sm text-zinc-500">Use depois de contar o estoque. Fica registrado no histórico.</p>
            <div><label className="rotulo">Quantidade contada</label><input className="campo" inputMode="decimal" value={ajuste.valor} onChange={(e) => setAjuste({ ...ajuste, valor: e.target.value })} /></div>
            <div><label className="rotulo">Motivo</label><input className="campo" value={ajuste.obs} onChange={(e) => setAjuste({ ...ajuste, obs: e.target.value })} placeholder="Ex.: contagem de sexta" /></div>
          </div>
        )}
      </Modal>
    </Exige>
  );
}
