"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { combina, erroMsg, fmtDataHora, fmtMoeda, fmtPeso, hojeISO } from "@/lib/formato";
import { STATUS_PEDIDO, type StatusPedido } from "@/lib/tipos";
import { Botao, Cabecalho, Selo, Vazio, avisar } from "@/components/ui";
import { Exige } from "@/components/perfil-contexto";
import { PedidoDetalhe } from "@/components/pedido-detalhe";
import { abrirImpressaoPedidos } from "@/lib/impressao";

type Linha = {
  id: string; numero: number; status: StatusPedido; total: number; peso_kg: number; feito_em: string; impresso_em: string | null; carga_id: string | null;
  clientes: { razao_social: string; nome_fantasia: string | null; bairro: string | null; rota_id: string | null };
  perfis: { nome: string } | null;
  cargas: { numero: number } | null;
};

export default function Pedidos() {
  const sb = supabaseNavegador();
  const [de, setDe] = useState(hojeISO());
  const [ate, setAte] = useState(hojeISO());
  const [status, setStatus] = useState<string>("");
  const [vendedor, setVendedor] = useState("");
  const [rota, setRota] = useState("");
  const [busca, setBusca] = useState("");
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [rotas, setRotas] = useState<{ id: string; nome: string }[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [aberto, setAberto] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await sb.from("pedidos")
      .select("id, numero, status, total, peso_kg, feito_em, impresso_em, carga_id, clientes(razao_social, nome_fantasia, bairro, rota_id), perfis!pedidos_vendedor_id_fkey(nome), cargas(numero)")
      .gte("feito_em", new Date(de + "T00:00:00").toISOString())
      .lt("feito_em", new Date(new Date(ate + "T00:00:00").getTime() + 86400000).toISOString())
      .order("numero", { ascending: false })
      .limit(2000);
    if (error) avisar(erroMsg(error), "erro");
    setLinhas((data ?? []) as unknown as Linha[]);
    setSel(new Set());
    setCarregando(false);
  }, [sb, de, ate]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => { sb.from("rotas").select("id, nome").order("nome").then(({ data }) => setRotas(data ?? [])); }, [sb]);

  const vendedores = useMemo(() => [...new Set(linhas.map((l) => l.perfis?.nome).filter(Boolean))] as string[], [linhas]);
  const nomeRota = useMemo(() => Object.fromEntries(rotas.map((r) => [r.id, r.nome])), [rotas]);

  const visiveis = useMemo(() => linhas.filter((l) =>
    (!status || l.status === status) &&
    (!vendedor || l.perfis?.nome === vendedor) &&
    (!rota || l.clientes.rota_id === rota) &&
    (!busca.trim() || combina(`${l.numero} ${l.clientes.razao_social} ${l.clientes.nome_fantasia ?? ""} ${l.clientes.bairro ?? ""}`, busca)),
  ), [linhas, status, vendedor, rota, busca]);

  const totais = useMemo(() => {
    const v = visiveis.filter((l) => !["cancelado", "recusado"].includes(l.status));
    return { qtd: v.length, valor: v.reduce((s, l) => s + Number(l.total), 0), peso: v.reduce((s, l) => s + Number(l.peso_kg), 0) };
  }, [visiveis]);

  const todosMarcados = visiveis.length > 0 && visiveis.every((l) => sel.has(l.id));
  // "todos" = os da lista filtrada, menos cancelados e recusados
  const imprimiveis = visiveis.filter((l) => !["cancelado", "recusado"].includes(l.status));
  const naoImpressos = visiveis.filter((l) => !l.impresso_em && ["liberado", "carregado"].includes(l.status));

  return (
    <Exige perm="pedidos_ver_todos">
      <Cabecalho titulo="Pedidos" sub={`${totais.qtd} pedidos · ${fmtMoeda(totais.valor)} · ${fmtPeso(totais.peso)}`}>
        <Link href="/pedidos/novo"><Botao>+ Novo pedido</Botao></Link>
        <Botao variante="secundario" disabled={!imprimiveis.length} onClick={() => abrirImpressaoPedidos(imprimiveis.map((l) => l.id))}>🖨 Imprimir todos ({imprimiveis.length})</Botao>
        {naoImpressos.length > 0 && naoImpressos.length < imprimiveis.length && <Botao variante="secundario" onClick={() => abrirImpressaoPedidos(naoImpressos.map((l) => l.id))}>Só os não impressos ({naoImpressos.length})</Botao>}
        <Botao variante="secundario" disabled={!sel.size} onClick={() => abrirImpressaoPedidos([...sel])}>Selecionados ({sel.size})</Botao>
      </Cabecalho>

      <div className="cartao mb-3 grid gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6">
        <div><label className="rotulo">De</label><input type="date" className="campo" value={de} onChange={(e) => setDe(e.target.value)} /></div>
        <div><label className="rotulo">Até</label><input type="date" className="campo" value={ate} onChange={(e) => setAte(e.target.value)} /></div>
        <div><label className="rotulo">Situação</label>
          <select className="campo" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todas</option>
            {Object.entries(STATUS_PEDIDO).map(([k, v]) => <option key={k} value={k}>{v.nome}</option>)}
          </select>
        </div>
        <div><label className="rotulo">Vendedor</label>
          <select className="campo" value={vendedor} onChange={(e) => setVendedor(e.target.value)}>
            <option value="">Todos</option>{vendedores.map((v) => <option key={v}>{v}</option>)}
          </select>
        </div>
        <div><label className="rotulo">Rota</label>
          <select className="campo" value={rota} onChange={(e) => setRota(e.target.value)}>
            <option value="">Todas</option>{rotas.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
          </select>
        </div>
        <div><label className="rotulo">Pesquisar</label><input className="campo" placeholder="Cliente, nº, bairro" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
      </div>

      {carregando ? <div className="cartao p-8 text-center text-zinc-500">Carregando…</div> : visiveis.length === 0 ? <Vazio>Nenhum pedido neste período.</Vazio> : (
        <div className="cartao overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
              <tr>
                <th className="w-10 px-3 py-2"><input type="checkbox" className="size-4" checked={todosMarcados} onChange={() => setSel(todosMarcados ? new Set() : new Set(visiveis.map((l) => l.id)))} aria-label="Marcar todos" /></th>
                <th className="px-2 py-2">Nº</th><th className="px-2 py-2">Cliente</th><th className="px-2 py-2">Rota</th><th className="px-2 py-2">Vendedor</th>
                <th className="px-2 py-2">Feito em</th><th className="px-2 py-2">Situação</th><th className="px-2 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((l) => (
                <tr key={l.id} className={`cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50 ${["cancelado", "recusado"].includes(l.status) ? "opacity-50" : ""}`} onClick={() => setAberto(l.id)}>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="size-4" checked={sel.has(l.id)} onChange={() => setSel((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} />
                  </td>
                  <td className="px-2 py-2 font-semibold">{l.numero}{l.impresso_em && <span title="Já impresso" className="ml-1 text-xs text-zinc-400">🖨</span>}</td>
                  <td className="px-2 py-2"><div className="font-medium">{l.clientes.razao_social}</div><div className="text-xs text-zinc-500">{l.clientes.bairro}</div></td>
                  <td className="px-2 py-2 text-sm">{(l.clientes.rota_id && nomeRota[l.clientes.rota_id]) || "—"}</td>
                  <td className="px-2 py-2 text-sm">{l.perfis?.nome ?? "—"}</td>
                  <td className="px-2 py-2 text-sm whitespace-nowrap">{fmtDataHora(l.feito_em)}</td>
                  <td className="px-2 py-2"><Selo cor={STATUS_PEDIDO[l.status].cor}>{STATUS_PEDIDO[l.status].nome}</Selo>{l.cargas && <div className="mt-0.5 text-xs text-zinc-500">Carga {l.cargas.numero}</div>}</td>
                  <td className="px-2 py-2 text-right font-semibold whitespace-nowrap">{fmtMoeda(l.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PedidoDetalhe id={aberto} aoFechar={() => setAberto(null)} aoMudar={carregar} />
    </Exige>
  );
}
