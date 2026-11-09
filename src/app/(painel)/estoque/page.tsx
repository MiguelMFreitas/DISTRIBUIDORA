"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { combina, erroMsg, fmtDataHora, fmtMoeda, fmtQtd } from "@/lib/formato";
import type { Produto } from "@/lib/tipos";
import { Botao, Cabecalho, Modal, Selo, avisar } from "@/components/ui";
import { BuscaProduto } from "@/components/busca-produto";
import { Exige } from "@/components/perfil-contexto";

type Mov = {
  id: string; tipo: string; quantidade: number; saldo: number; observacao: string | null; motivo: string | null; criado_em: string;
  valor_unit: number | null; desconto: number; valor_total: number | null;
  produtos: { nome: string } | null; perfis: { nome: string } | null;
};
type LinhaEntrada = { p: Produto; qtd: string; valor: string; desconto: string };

const TIPOS: Record<string, string> = { entrada: "Entrada", venda: "Venda", cancelamento: "Cancelamento", devolucao: "Devolução", ajuste: "Ajuste", saida: "Saída" };
const MOTIVOS = ["Avaria", "Vencido", "Perda / furto", "Uso próprio", "Bonificação / brinde", "Troca com fornecedor", "Outro"];
/** "1.234,50" → 1234.5 · "12,5" → 12.5 · "12.5" → 12.5 */
const num = (s: string) => {
  const t = String(s ?? "").trim();
  return Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t) || 0;
};
const numSimples = num;
const totalLinha = (l: LinhaEntrada) => Math.max(0, numSimples(l.qtd) * numSimples(l.valor) - num(l.desconto));

export default function Estoque() {
  const sb = supabaseNavegador();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [movs, setMovs] = useState<Mov[]>([]);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | "baixo" | "zerado">("todos");
  const [entrada, setEntrada] = useState(false);
  const [linhas, setLinhas] = useState<LinhaEntrada[]>([]);
  const [obs, setObs] = useState("");
  const [ajuste, setAjuste] = useState<{ p: Produto; valor: string; obs: string } | null>(null);
  const [saida, setSaida] = useState<{ p: Produto; qtd: string; motivo: string; obs: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const [{ data: p }, { data: m }] = await Promise.all([
      sb.from("produtos").select("*").eq("ativo", true).order("nome"),
      sb.from("estoque_movimentos").select("id, tipo, quantidade, saldo, observacao, motivo, criado_em, valor_unit, desconto, valor_total, produtos(nome), perfis(nome)").order("criado_em", { ascending: false }).limit(60),
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
  const novaLinha = (p: Produto): LinhaEntrada => ({ p, qtd: "", valor: Number(p.custo) > 0 ? String(p.custo).replace(".", ",") : "", desconto: "" });
  const mudarLinha = (id: string, campos: Partial<LinhaEntrada>) => setLinhas((x) => x.map((y) => (y.p.id === id ? { ...y, ...campos } : y)));
  const totalEntrada = linhas.reduce((s, l) => s + totalLinha(l), 0);
  const descontoEntrada = linhas.reduce((s, l) => s + num(l.desconto), 0);

  async function lancarEntrada() {
    const validas = linhas.filter((l) => numSimples(l.qtd) > 0);
    if (!validas.length) return avisar("Coloque a quantidade de pelo menos um produto.", "erro");
    const semValor = validas.filter((l) => !(numSimples(l.valor) > 0));
    if (semValor.length) return avisar(`Coloque o valor de compra de: ${semValor.map((l) => l.p.nome).join(", ")}`, "erro");
    setSalvando(true);
    for (const l of validas) {
      const { error } = await sb.rpc("entrada_estoque", {
        p_produto: l.p.id, p_quantidade: numSimples(l.qtd), p_observacao: obs || null,
        p_valor_unit: numSimples(l.valor), p_desconto: num(l.desconto),
      });
      if (error) { setSalvando(false); avisar(`${l.p.nome}: ${erroMsg(error)}`, "erro"); carregar(); return; }
      setLinhas((x) => x.filter((y) => y.p.id !== l.p.id));
    }
    setSalvando(false);
    avisar(`Entrada de ${validas.length} produto(s) lançada: ${fmtMoeda(validas.reduce((s, l) => s + totalLinha(l), 0))}`);
    setEntrada(false); setLinhas([]); setObs("");
    carregar();
  }

  async function salvarAjuste() {
    if (!ajuste) return;
    const { error } = await sb.rpc("ajustar_estoque", { p_produto: ajuste.p.id, p_novo_saldo: numSimples(ajuste.valor), p_observacao: ajuste.obs || null });
    if (error) return avisar(erroMsg(error), "erro");
    avisar("Estoque ajustado");
    setAjuste(null);
    carregar();
  }

  async function salvarSaida() {
    if (!saida) return;
    const { error } = await sb.rpc("saida_estoque", { p_produto: saida.p.id, p_quantidade: numSimples(saida.qtd), p_motivo: saida.motivo, p_observacao: saida.obs || null });
    if (error) return avisar(erroMsg(error), "erro");
    avisar(`Saída lançada: ${fmtQtd(numSimples(saida.qtd))} ${saida.p.unidade} de ${saida.p.nome}`);
    setSaida(null);
    carregar();
  }

  return (
    <Exige perm="estoque">
      <Cabecalho titulo="Estoque" sub="Lance aqui a mercadoria que chegou, com o valor de compra. Pedidos baixam o estoque sozinhos.">
        <Botao onClick={() => setEntrada(true)}>+ Lançar entrada</Botao>
      </Cabecalho>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            <input className="campo max-w-xs" placeholder="Pesquisar produto…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            {([["todos", `Todos (${produtos.length})`], ["baixo", `Estoque baixo (${nBaixo})`], ["zerado", `Sem estoque (${nZerado})`]] as const).map(([k, n]) => (
              <button key={k} onClick={() => setFiltro(k)} className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${filtro === k ? "border-marca-500 bg-marca-500 text-white" : "border-zinc-300 dark:border-zinc-700"}`}>{n}</button>
            ))}
          </div>
          <div className="cartao overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <tr><th className="px-3 py-2">Produto</th><th className="px-3 py-2">Un.</th><th className="px-3 py-2 text-right">Custo</th><th className="px-3 py-2 text-right">Mínimo</th><th className="px-3 py-2 text-right">Estoque</th><th /></tr>
              </thead>
              <tbody>
                {lista.slice(0, 300).map((p) => (
                  <tr key={p.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-3 py-2 font-medium">{p.nome}</td>
                    <td className="px-3 py-2">{p.unidade}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{Number(p.custo) > 0 ? fmtMoeda(p.custo) : <span className="text-sm text-amber-600">—</span>}</td>
                    <td className="px-3 py-2 text-right text-zinc-500">{fmtQtd(p.estoque_minimo)}</td>
                    <td className="px-3 py-2 text-right">
                      <Selo cor={p.estoque <= 0 ? "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200" : p.estoque <= p.estoque_minimo ? "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200" : "bg-zinc-100 dark:bg-zinc-800"}>{fmtQtd(p.estoque)}</Selo>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      <Botao variante="fantasma" tamanho="p" onClick={() => { setLinhas([novaLinha(p)]); setEntrada(true); }}>Entrada</Botao>
                      <Botao variante="fantasma" tamanho="p" disabled={p.estoque <= 0} onClick={() => setSaida({ p, qtd: "1", motivo: MOTIVOS[0], obs: "" })}>Saída</Botao>
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
                  <div className="text-xs text-zinc-500">
                    <b className="text-zinc-700 dark:text-zinc-300">{TIPOS[m.tipo]}{m.motivo ? ` · ${m.motivo}` : ""}</b> · {fmtDataHora(m.criado_em)}{m.perfis ? ` · ${m.perfis.nome}` : ""}
                  </div>
                  {m.observacao && <div className="text-xs text-zinc-500">📝 {m.observacao}</div>}
                  {m.valor_total != null && (
                    <div className="text-xs text-zinc-500">
                      {fmtMoeda(m.valor_unit)} × {fmtQtd(Math.abs(m.quantidade))}{Number(m.desconto) > 0 ? ` − desc. ${fmtMoeda(m.desconto)}` : ""} = <b className="text-zinc-700 dark:text-zinc-300">{fmtMoeda(m.valor_total)}</b>
                    </div>
                  )}
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

      <Modal aberto={entrada} aoFechar={() => setEntrada(false)} titulo="Lançar entrada de mercadoria" largura="max-w-4xl"
        rodape={<>
          <span className="mr-auto self-center text-sm text-zinc-500">{descontoEntrada > 0 && `Desconto ${fmtMoeda(descontoEntrada)} · `}Total da entrada <b className="text-lg text-zinc-900 dark:text-zinc-100">{fmtMoeda(totalEntrada)}</b></span>
          <Botao variante="secundario" onClick={() => setEntrada(false)}>Cancelar</Botao>
          <Botao onClick={lancarEntrada} carregando={salvando}>Lançar entrada</Botao>
        </>}>
        <div className="space-y-3">
          <BuscaProduto produtos={produtos} placeholder="Pesquise e adicione os produtos que chegaram…"
            aoEscolher={(p) => setLinhas((l) => (l.some((x) => x.p.id === p.id) ? l : [...l, novaLinha(p)]))} />
          {linhas.length === 0 ? <p className="text-sm text-zinc-500">Adicione os produtos da nota.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <thead className="text-left text-xs uppercase text-zinc-500">
                  <tr><th className="py-1">Produto</th><th className="py-1 text-right">Qtd</th><th className="py-1 text-right">Valor de compra (1 un.)</th><th className="py-1 text-right">Desconto R$</th><th className="py-1 text-right">Total</th><th /></tr>
                </thead>
                <tbody>
                  {linhas.map((l, i) => (
                    <tr key={l.p.id} className="border-t border-zinc-100 dark:border-zinc-800">
                      <td className="py-2 pr-2"><div className="font-medium">{l.p.nome}</div><div className="text-xs text-zinc-500">{l.p.unidade} · hoje {fmtQtd(l.p.estoque)}{Number(l.p.custo) > 0 ? ` · último custo ${fmtMoeda(l.p.custo)}` : ""}</div></td>
                      <td className="py-2 text-right"><input className="campo w-20! text-right" inputMode="decimal" placeholder="Qtd" autoFocus={i === linhas.length - 1} value={l.qtd} onChange={(e) => mudarLinha(l.p.id, { qtd: e.target.value })} aria-label={`Quantidade de ${l.p.nome}`} /></td>
                      <td className="py-2 text-right"><input className="campo w-28! text-right" inputMode="decimal" placeholder="R$" value={l.valor} onChange={(e) => mudarLinha(l.p.id, { valor: e.target.value })} aria-label={`Valor de compra de ${l.p.nome}`} /></td>
                      <td className="py-2 text-right"><input className="campo w-24! text-right" inputMode="decimal" placeholder="0" value={l.desconto} onChange={(e) => mudarLinha(l.p.id, { desconto: e.target.value })} aria-label={`Desconto de ${l.p.nome}`} /></td>
                      <td className="py-2 text-right font-semibold whitespace-nowrap">{fmtMoeda(totalLinha(l))}</td>
                      <td className="py-2 pl-1 text-right"><Botao variante="fantasma" tamanho="p" onClick={() => setLinhas((x) => x.filter((y) => y.p.id !== l.p.id))} aria-label="Remover">✕</Botao></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div>
            <label className="rotulo" htmlFor="obs-entrada">Observação (nota fiscal, fornecedor, condição de pagamento…)</label>
            <input id="obs-entrada" className="campo" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: NF 1234 · Ambev · boleto 28 dias" />
          </div>
          <p className="text-xs text-zinc-500">O custo do produto passa a ser o valor de compra menos o desconto, dividido pela quantidade. É ele que o relatório usa para calcular o lucro.</p>
        </div>
      </Modal>

      <Modal aberto={!!saida} aoFechar={() => setSaida(null)} titulo="Saída de estoque" largura="max-w-md"
        rodape={<><Botao variante="secundario" onClick={() => setSaida(null)}>Cancelar</Botao><Botao onClick={salvarSaida}>Lançar saída</Botao></>}>
        {saida && (
          <div className="space-y-3">
            <p className="font-semibold">{saida.p.nome}</p>
            <p className="text-sm text-zinc-500">Para o que sai sem ser venda. Tem hoje {fmtQtd(saida.p.estoque)} {saida.p.unidade}. O valor registrado é o custo: {Number(saida.p.custo) > 0 ? `${fmtMoeda(saida.p.custo)} por ${saida.p.unidade}` : "este produto ainda não tem custo"}.</p>
            <div><label className="rotulo" htmlFor="s-qtd">Quantidade</label><input id="s-qtd" className="campo" inputMode="decimal" value={saida.qtd} onChange={(e) => setSaida({ ...saida, qtd: e.target.value })} /></div>
            <div><label className="rotulo" htmlFor="s-mot">Motivo</label>
              <select id="s-mot" className="campo" value={saida.motivo} onChange={(e) => setSaida({ ...saida, motivo: e.target.value })}>{MOTIVOS.map((m) => <option key={m}>{m}</option>)}</select>
            </div>
            <div><label className="rotulo" htmlFor="s-obs">Observação</label><input id="s-obs" className="campo" value={saida.obs} onChange={(e) => setSaida({ ...saida, obs: e.target.value })} placeholder="Ex.: caixa rasgada no descarregamento" /></div>
            {Number(saida.p.custo) > 0 && <p className="text-sm">Valor da saída: <b>{fmtMoeda(numSimples(saida.qtd) * Number(saida.p.custo))}</b></p>}
          </div>
        )}
      </Modal>

      <Modal aberto={!!ajuste} aoFechar={() => setAjuste(null)} titulo="Ajustar estoque" largura="max-w-md"
        rodape={<><Botao variante="secundario" onClick={() => setAjuste(null)}>Cancelar</Botao><Botao onClick={salvarAjuste}>Salvar</Botao></>}>
        {ajuste && (
          <div className="space-y-3">
            <p className="font-semibold">{ajuste.p.nome}</p>
            <p className="text-sm text-zinc-500">Use depois de contar o estoque. Fica registrado no histórico.</p>
            <div><label className="rotulo" htmlFor="a-q">Quantidade contada</label><input id="a-q" className="campo" inputMode="decimal" value={ajuste.valor} onChange={(e) => setAjuste({ ...ajuste, valor: e.target.value })} /></div>
            <div><label className="rotulo" htmlFor="a-o">Motivo</label><input id="a-o" className="campo" value={ajuste.obs} onChange={(e) => setAjuste({ ...ajuste, obs: e.target.value })} placeholder="Ex.: contagem de sexta" /></div>
          </div>
        )}
      </Modal>
    </Exige>
  );
}
