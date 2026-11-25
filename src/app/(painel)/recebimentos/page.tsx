"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { combina, erroMsg, fmtDataHora, fmtMoeda, fmtQtd, hojeISO } from "@/lib/formato";
import { STATUS_PEDIDO, type StatusPedido } from "@/lib/tipos";
import { Botao, BotaoConfirmar, Cabecalho, Modal, Selo, Vazio, avisar } from "@/components/ui";
import { usePode } from "@/components/perfil-contexto";

type Ped = {
  id: string; numero: number; status: StatusPedido; total: number; total_devolvido: number; valor_pago: number | null;
  pago_em: string | null; pago_forma: string | null; pontos_ganhos: number; feito_em: string; entrega: string; origem: string;
  contato_nome: string | null; clientes: { razao_social: string; nome_fantasia: string | null; identificacao?: string | null } | null;
};
type Item = { id: string; quantidade: number; devolvido: number; preco_unit: number; troca_id: string | null; produtos: { nome: string; unidade: string; permite_meia: boolean } };

const FORMAS = [["dinheiro", "💵 Dinheiro"], ["pix", "📱 Pix"], ["cartao", "💳 Cartão"], ["boleto", "🧾 Boleto"], ["outro", "Outro"]] as const;
const nomeForma = (f: string | null) => FORMAS.find((x) => x[0] === f)?.[1] ?? "—";
const nomeCliente = (p: Ped) => (p.origem === "link" ? p.contato_nome : p.clientes?.identificacao || p.clientes?.nome_fantasia || p.clientes?.razao_social) ?? "—";
const aReceber = (p: Ped) => Number(p.total) - Number(p.total_devolvido);
const diasAtras = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function Recebimentos() {
  const sb = supabaseNavegador();
  const pode = usePode();
  const [aba, setAba] = useState<"receber" | "recebidos">("receber");
  const [de, setDe] = useState(diasAtras(30));
  const [ate, setAte] = useState(hojeISO());
  const [busca, setBusca] = useState("");
  const [naoEntregues, setNaoEntregues] = useState(false);
  const [lista, setLista] = useState<Ped[] | null>(null);
  const [receber, setReceber] = useState<Ped | null>(null);
  const [voltou, setVoltou] = useState<{ p: Ped; itens: Item[]; qtd: Record<string, number> } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setLista(null);
    let q = sb.from("pedidos")
      .select("id, numero, status, total, total_devolvido, valor_pago, pago_em, pago_forma, pontos_ganhos, feito_em, entrega, origem, contato_nome, clientes(razao_social, nome_fantasia, identificacao)")
      .not("status", "in", "(cancelado,recusado,aguardando_aprovacao)")
      .gte("feito_em", new Date(de + "T00:00:00").toISOString()).lte("feito_em", new Date(ate + "T23:59:59").toISOString())
      .order("numero", { ascending: false }).limit(1000);
    q = aba === "receber" ? q.is("pago_em", null) : q.not("pago_em", "is", null);
    if (aba === "receber" && !naoEntregues) q = q.eq("status", "entregue");
    const { data, error } = await q;
    if (error) { avisar(/total_devolvido|pago_em|column/i.test(error.message) ? "Rode a atualização 28 no Supabase para usar os recebimentos." : erroMsg(error), "erro"); setLista([]); return; }
    setLista((data ?? []) as unknown as Ped[]);
  }, [sb, aba, de, ate, naoEntregues]);
  useEffect(() => { carregar(); }, [carregar]);

  const visiveis = useMemo(() => (lista ?? []).filter((p) => !busca.trim() || combina(`${p.numero} ${nomeCliente(p)} ${p.clientes?.razao_social ?? ""}`, busca)), [lista, busca]);
  const soma = visiveis.reduce((s, p) => s + (aba === "receber" ? aReceber(p) : Number(p.valor_pago ?? 0)), 0);

  async function marcar(p: Ped, forma: string) {
    setOcupado(true);
    const { data, error } = await sb.rpc("marcar_pago", { p_pedido: p.id, p_forma: forma });
    setOcupado(false);
    if (error) return avisar(erroMsg(error), "erro");
    const r = data as { valor: number; pontos: number };
    avisar(`Nº ${p.numero} recebido: ${fmtMoeda(r.valor)}${r.pontos ? ` · +${r.pontos} pontos para o cliente` : ""}`);
    setReceber(null);
    carregar();
  }
  async function desfazer(p: Ped) {
    const { error } = await sb.rpc("desfazer_pago", { p_pedido: p.id });
    if (error) return avisar(erroMsg(error), "erro");
    avisar(`Recebimento do nº ${p.numero} desfeito`);
    carregar();
  }
  async function abrirVoltou(p: Ped) {
    const { data, error } = await sb.from("pedido_itens").select("id, quantidade, devolvido, preco_unit, troca_id, produtos(nome, unidade, permite_meia)").eq("pedido_id", p.id);
    if (error) return avisar(erroMsg(error), "erro");
    setVoltou({ p, itens: (data ?? []) as unknown as Item[], qtd: {} });
  }
  async function salvarVoltou() {
    if (!voltou) return;
    const lancar = Object.entries(voltou.qtd).filter(([, q]) => q > 0);
    if (!lancar.length) return avisar("Coloque a quantidade que voltou.", "erro");
    setOcupado(true);
    for (const [item, q] of lancar) {
      const { error } = await sb.rpc("devolver_item", { p_item: item, p_qtd: q });
      if (error) { setOcupado(false); return avisar(erroMsg(error), "erro"); }
    }
    setOcupado(false);
    avisar(`Devolução registrada no pedido nº ${voltou.p.numero}. Os produtos voltaram para o estoque.`);
    setVoltou(null);
    carregar();
  }

  if (!pode("financeiro") && !pode("pedidos_ver_todos")) return <Vazio>Sem acesso.</Vazio>;

  return (
    <>
      <Cabecalho titulo="Recebimentos" sub="Marque os pedidos que foram pagos. Pedido do robô do WhatsApp dá pontos ao cliente quando é recebido (só pelo que ficou: o que voltou não conta)." />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700" role="tablist">
          {([["receber", "A receber"], ["recebidos", "Recebidos"]] as const).map(([k, n]) => (
            <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold ${aba === k ? "bg-marca-500 text-white" : "text-zinc-600 dark:text-zinc-300"}`}>{n}</button>
          ))}
        </div>
        <input type="date" className="campo w-auto!" value={de} onChange={(e) => setDe(e.target.value)} aria-label="De" />
        <input type="date" className="campo w-auto!" value={ate} onChange={(e) => setAte(e.target.value)} aria-label="Até" />
        <input className="campo max-w-xs" placeholder="Cliente ou nº" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Pesquisar" />
        {aba === "receber" && <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400"><input type="checkbox" checked={naoEntregues} onChange={(e) => setNaoEntregues(e.target.checked)} /> Mostrar também os que ainda não foram entregues</label>}
      </div>

      <div className="cartao mb-3 flex flex-wrap items-baseline justify-between gap-2 p-4">
        <span className="text-sm font-semibold uppercase text-zinc-500">{aba === "receber" ? "Total a receber" : "Total recebido"} ({visiveis.length} pedidos)</span>
        <span className="font-display text-3xl font-bold">{fmtMoeda(soma)}</span>
      </div>

      {lista === null ? <div className="cartao p-8 text-center text-zinc-500">Carregando…</div> : visiveis.length === 0 ? (
        <Vazio>{aba === "receber" ? "Nenhum pedido entregue esperando pagamento neste período." : "Nenhum pedido recebido neste período."}</Vazio>
      ) : (
        <div className="cartao divide-y divide-zinc-100 dark:divide-zinc-800">
          {visiveis.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-zinc-500">Nº {p.numero} · {fmtDataHora(p.feito_em)} · {p.entrega === "moto" ? "🏍️ moto" : p.entrega === "balcao" ? "🏪 balcão" : "🚚 caminhão"}</div>
                <div className="truncate font-semibold">{nomeCliente(p)}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <Selo cor={STATUS_PEDIDO[p.status].cor}>{STATUS_PEDIDO[p.status].nome}</Selo>
                  {p.origem === "whatsapp" && <Selo cor="bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200">🤖 WhatsApp · ganha pontos</Selo>}
                  {aba === "recebidos" && <span className="text-xs text-zinc-500">{nomeForma(p.pago_forma)} · {p.pago_em ? fmtDataHora(p.pago_em) : ""}{p.pontos_ganhos ? ` · +${p.pontos_ganhos} pontos` : ""}</span>}
                </div>
              </div>
              <div className="text-right">
                {Number(p.total_devolvido) > 0 && <div className="text-xs text-zinc-500">{fmtMoeda(p.total)} − voltou {fmtMoeda(p.total_devolvido)}</div>}
                <div className="text-lg font-bold">{fmtMoeda(aba === "receber" ? aReceber(p) : Number(p.valor_pago ?? 0))}</div>
              </div>
              <div className="flex gap-2">
                {aba === "receber" ? <>
                  <Botao variante="secundario" tamanho="p" onClick={() => abrirVoltou(p)}>Voltou item</Botao>
                  <Botao tamanho="p" onClick={() => setReceber(p)}>Recebido</Botao>
                </> : <BotaoConfirmar variante="fantasma" tamanho="p" aoConfirmar={() => desfazer(p)} textoConfirmar="Desfazer?">Desfazer</BotaoConfirmar>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal aberto={!!receber} aoFechar={() => setReceber(null)} titulo={receber ? `Receber nº ${receber.numero}` : ""} largura="max-w-md">
        {receber && (
          <div className="space-y-3">
            <p><b>{nomeCliente(receber)}</b></p>
            <div className="flex items-baseline justify-between rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800">
              <span className="text-sm text-zinc-500">Valor a receber{Number(receber.total_devolvido) > 0 ? " (já sem o que voltou)" : ""}</span>
              <span className="font-display text-2xl font-bold">{fmtMoeda(aReceber(receber))}</span>
            </div>
            {receber.origem === "whatsapp" && <p className="text-sm text-emerald-700 dark:text-emerald-300">🤖 Pedido do robô: o cliente ganha os pontos agora.</p>}
            <p className="text-sm font-semibold">Como pagou?</p>
            <div className="grid grid-cols-2 gap-2">
              {FORMAS.map(([k, n]) => <Botao key={k} variante="secundario" disabled={ocupado} onClick={() => marcar(receber, k)}>{n}</Botao>)}
            </div>
            <p className="text-xs text-zinc-500">Voltou algum item? Feche e toque em “Voltou item” antes de receber.</p>
          </div>
        )}
      </Modal>

      <Modal aberto={!!voltou} aoFechar={() => setVoltou(null)} titulo={voltou ? `Voltou item · nº ${voltou.p.numero}` : ""} largura="max-w-lg"
        rodape={<><Botao variante="secundario" onClick={() => setVoltou(null)}>Cancelar</Botao><Botao onClick={salvarVoltou} carregando={ocupado}>Registrar devolução</Botao></>}>
        {voltou && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-500">Coloque quanto voltou de cada produto. Volta para o estoque e sai do valor do pedido.</p>
            {voltou.itens.map((i) => {
              const max = Number(i.quantidade) - Number(i.devolvido);
              return (
                <div key={i.id} className="flex items-center gap-3 border-b border-zinc-100 py-2 last:border-0 dark:border-zinc-800">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{i.troca_id && "🎁 "}{i.produtos.nome}</div>
                    <div className="text-xs text-zinc-500">Pediu {fmtQtd(i.quantidade)} {i.produtos.unidade}{Number(i.devolvido) > 0 ? ` · já voltaram ${fmtQtd(i.devolvido)}` : ""} · {fmtMoeda(i.preco_unit)}</div>
                  </div>
                  <input type="number" min={0} max={max} step={i.produtos.permite_meia ? 0.5 : 1} className="campo w-20! text-center" aria-label={`Quanto voltou de ${i.produtos.nome}`}
                    disabled={max <= 0} value={voltou.qtd[i.id] ?? ""} placeholder="0"
                    onChange={(e) => setVoltou({ ...voltou, qtd: { ...voltou.qtd, [i.id]: Math.min(max, Math.max(0, Number(e.target.value) || 0)) } })} />
                </div>
              );
            })}
          </div>
        )}
      </Modal>
    </>
  );
}
