"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { fmtDataHora, fmtMoeda, fmtQtd, hojeISO, TURNOS } from "@/lib/formato";
import { Cabecalho, Selo, avisar } from "@/components/ui";
import { usePerfil, usePode } from "@/components/perfil-contexto";
import { PedidoDetalhe } from "@/components/pedido-detalhe";
import { STATUS_CARGA } from "@/lib/tipos";

type Aguardando = { id: string; numero: number; total: number; feito_em: string; clientes: { razao_social: string }; perfis: { nome: string } | null };
type CargaHoje = { id: string; numero: number; turno: "manha" | "tarde"; status: string; veiculos: { nome: string } | null; motoristas: { nome: string } | null; pedidos: { count: number }[] };
type Desconto = {
  id: string; pedido_id: string; quantidade: number; preco_tabela: number; preco_unit: number; desconto_pct: number; precisa_aprovacao: boolean;
  produtos: { nome: string; preco_minimo: number | null };
  pedidos: { numero: number; feito_em: string; status: string; clientes: { razao_social: string }; perfis: { nome: string } | null };
};
type DoLink = { id: string; numero: number; total: number; feito_em: string; contato_nome: string; contato_bairro: string | null; pagamento: string | null; entrega: string };
type Baixo = { id: string; nome: string; estoque: number; estoque_minimo: number; unidade: string };

function Numero({ titulo, valor, sub, href, destaque }: { titulo: string; valor: React.ReactNode; sub?: string; href?: string; destaque?: boolean }) {
  const corpo = (
    <div className={`cartao h-full p-4 ${destaque ? "border-amber-400 bg-amber-50 dark:bg-amber-500/10" : ""}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{titulo}</div>
      <div className="mt-1 font-display text-4xl font-bold">{valor}</div>
      {sub && <div className="text-sm text-zinc-500">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{corpo}</Link> : corpo;
}

export default function Painel() {
  const sb = supabaseNavegador();
  const eu = usePerfil();
  const pode = usePode();
  const [hoje, setHoje] = useState({ qtd: 0, valor: 0 });
  const [semCarga, setSemCarga] = useState(0);
  const [aguardando, setAguardando] = useState<Aguardando[]>([]);
  const [cargas, setCargas] = useState<CargaHoje[]>([]);
  const [baixos, setBaixos] = useState<Baixo[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [descontos, setDescontos] = useState<Desconto[]>([]);
  const [moto, setMoto] = useState(0);
  const [doLink, setDoLink] = useState<DoLink[]>([]);
  const vistosLink = useRef<Set<string> | null>(null);
  const vistos = useRef<Set<string> | null>(null);

  const verPedidos = pode("pedidos_ver_todos") || pode("cargas");
  const podeCargas = pode("cargas");

  const carregar = useCallback(async () => {
    const inicio = new Date(hojeISO() + "T00:00:00").toISOString();
    if (verPedidos) {
      const [{ data: ph }, { count }, { data: ag }] = await Promise.all([
        sb.from("pedidos").select("total").gte("feito_em", inicio).not("status", "in", "(cancelado,recusado)"),
        sb.from("pedidos").select("id", { count: "exact", head: true }).eq("status", "liberado").is("carga_id", null).eq("entrega", "caminhao"),
        sb.from("pedidos").select("id, numero, total, feito_em, clientes(razao_social), perfis!pedidos_vendedor_id_fkey(nome)").eq("status", "aguardando_aprovacao").order("numero"),
      ]);
      setHoje({ qtd: ph?.length ?? 0, valor: (ph ?? []).reduce((s: number, p: { total: number }) => s + Number(p.total), 0) });
      setSemCarga(count ?? 0);
      const { count: cm } = await sb.from("pedidos").select("id", { count: "exact", head: true }).eq("status", "liberado").eq("entrega", "moto");
      setMoto(cm ?? 0);
      // pedidos novos pelo link (ainda não vistos): avisa
      const { data: dl } = await sb.from("pedidos").select("id, numero, total, feito_em, contato_nome, contato_bairro, pagamento, entrega")
        .eq("origem", "link").is("visto_em", null).not("status", "in", "(cancelado,recusado)").order("numero");
      const listaLink = (dl ?? []) as DoLink[];
      if (vistosLink.current) {
        const novos = listaLink.filter((d) => !vistosLink.current!.has(d.id));
        if (novos.length) {
          avisar(`🔗 Pedido novo pelo link: nº ${novos.map((d) => d.numero).join(", ")} (${novos[0].contato_nome})`);
          try { // bip curto
            const ac = new AudioContext(), o = ac.createOscillator(), g = ac.createGain();
            o.frequency.value = 880; g.gain.value = 0.15; o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.25);
          } catch {}
        }
      }
      vistosLink.current = new Set(listaLink.map((d) => d.id));
      setDoLink(listaLink);
      setAguardando((ag ?? []) as unknown as Aguardando[]);
      // todos os descontos de hoje (avisa quando chega um novo)
      const { data: ds } = await sb.from("pedido_itens")
        .select("id, pedido_id, quantidade, preco_tabela, preco_unit, desconto_pct, precisa_aprovacao, produtos(nome, preco_minimo), pedidos!inner(numero, feito_em, status, clientes(razao_social), perfis!pedidos_vendedor_id_fkey(nome))")
        .gt("desconto_pct", 0).lt("desconto_pct", 100).gte("pedidos.feito_em", inicio).not("pedidos.status", "in", "(cancelado,recusado)");
      const lista = ((ds ?? []) as unknown as Desconto[]).sort((a, b) => b.pedidos.feito_em.localeCompare(a.pedidos.feito_em) || a.pedidos.numero - b.pedidos.numero);
      if (vistos.current) {
        const novos = lista.filter((d) => !vistos.current!.has(d.id));
        const pedidosNovos = [...new Set(novos.map((d) => d.pedidos.numero))];
        if (pedidosNovos.length) avisar(`💲 Desconto novo: pedido${pedidosNovos.length > 1 ? "s" : ""} nº ${pedidosNovos.join(", ")} (${novos[0].pedidos.perfis?.nome ?? "—"})`);
      }
      vistos.current = new Set(lista.map((d) => d.id));
      setDescontos(lista);
    }
    if (podeCargas) {
      const { data } = await sb.from("cargas").select("id, numero:numero_dia, turno, status, veiculos(nome), motoristas(nome), pedidos(count)").eq("data", hojeISO()).order("turno").order("numero");
      setCargas((data ?? []) as unknown as CargaHoje[]);
    }
    const { data: prods } = await sb.from("produtos").select("id, nome, estoque, estoque_minimo, unidade").eq("ativo", true).order("estoque");
    setBaixos(((prods ?? []) as Baixo[]).filter((p) => p.estoque <= p.estoque_minimo).slice(0, 12));
  }, [sb, verPedidos, podeCargas]);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 30000); // pedidos novos dos vendedores aparecem sozinhos
    return () => clearInterval(t);
  }, [carregar]);

  return (
    <>
      <Cabecalho titulo={`Olá, ${eu.nome.split(" ")[0]}`} sub={new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })} />

      {verPedidos && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Numero titulo="Pedidos hoje" valor={hoje.qtd} sub={fmtMoeda(hoje.valor)} href="/pedidos" />
          <Numero titulo="Sem carga" valor={semCarga} sub="liberados, esperando carga" href="/cargas" />
          <Numero titulo="🏍️ Moto" valor={moto} sub="para entregar de moto" href="/moto" destaque={moto > 0} />
          <Numero titulo="Aguardando aprovação" valor={aguardando.length} sub="preço mudado ou sem estoque" destaque={aguardando.length > 0} />
          <Numero titulo="Estoque baixo" valor={baixos.length} sub="produtos no mínimo ou zerados" href="/estoque" destaque={baixos.some((b) => b.estoque <= 0)} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {verPedidos && doLink.length > 0 && (
          <section className="lg:col-span-2">
            <div className="mb-2 flex items-center justify-between"><h2 className="titulo text-lg">🔗 Pedidos novos pelo link ({doLink.length})</h2><Link href="/link" className="text-sm font-semibold text-marca-600">Link de pedidos →</Link></div>
            <div className="cartao divide-y divide-sky-100 border-sky-300 bg-sky-50 dark:divide-sky-900 dark:bg-sky-500/10">
              {doLink.map((d) => (
                <button key={d.id} onClick={() => setAberto(d.id)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-sky-100/60 dark:hover:bg-sky-500/20">
                  <div><div className="font-semibold">Nº {d.numero} · {d.contato_nome}</div><div className="text-sm text-zinc-500">{d.contato_bairro} · {fmtDataHora(d.feito_em)} · {d.pagamento === "pix" ? "Pix" : "Dinheiro"} · {d.entrega === "moto" ? "🏍️ moto" : d.entrega === "caminhao" ? "🚚 caminhão" : "🏪 balcão"}</div></div>
                  <div className="text-right"><div className="font-semibold">{fmtMoeda(d.total)}</div><div className="text-xs font-semibold text-sky-700 dark:text-sky-300">Abrir →</div></div>
                </button>
              ))}
            </div>
          </section>
        )}

        {verPedidos && aguardando.length > 0 && (
          <section>
            <h2 className="titulo mb-2 text-lg">Aguardando aprovação</h2>
            <div className="cartao divide-y divide-zinc-100 dark:divide-zinc-800">
              {aguardando.map((a) => (
                <button key={a.id} onClick={() => setAberto(a.id)} className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <div><div className="font-semibold">Nº {a.numero} · {a.clientes.razao_social}</div><div className="text-sm text-zinc-500">{a.perfis?.nome} · {fmtDataHora(a.feito_em)}</div></div>
                  <div className="text-right"><div className="font-semibold">{fmtMoeda(a.total)}</div><div className="text-xs font-semibold text-marca-600">{eu.admin ? "Revisar →" : ""}</div></div>
                </button>
              ))}
            </div>
          </section>
        )}

        {verPedidos && (
          <section className="lg:col-span-2">
            <h2 className="titulo mb-2 text-lg">Descontos de hoje <span className="text-base font-normal text-zinc-500">({descontos.length})</span></h2>
            {descontos.length === 0 ? <p className="cartao p-4 text-zinc-500">Nenhum desconto hoje.</p> : (
              <div className="cartao overflow-x-auto">
                <table className="w-full text-[15px]">
                  <thead className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                    <tr><th className="px-3 py-2">Pedido</th><th className="px-3 py-2">Vendedor</th><th className="px-3 py-2">Produto</th><th className="px-3 py-2 text-right">Tabela</th><th className="px-3 py-2 text-right">Vendido</th><th className="px-3 py-2 text-right">Desc.</th><th className="px-3 py-2 text-right">Qtd</th><th className="px-3 py-2" /></tr>
                  </thead>
                  <tbody>
                    {descontos.map((d) => {
                      const pend = d.precisa_aprovacao && d.pedidos.status === "aguardando_aprovacao";
                      const abaixoMin = d.produtos.preco_minimo != null && Number(d.preco_unit) < Number(d.produtos.preco_minimo) - 0.001;
                      return (
                        <tr key={d.id} onClick={() => setAberto(d.pedido_id)} className={`cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50 ${pend ? "bg-amber-50 dark:bg-amber-500/10" : ""}`}>
                          <td className="px-3 py-2"><b>Nº {d.pedidos.numero}</b><div className="text-xs text-zinc-500">{d.pedidos.clientes.razao_social}</div></td>
                          <td className="px-3 py-2">{d.pedidos.perfis?.nome ?? "—"}</td>
                          <td className="px-3 py-2">{d.produtos.nome}{abaixoMin && <div className="text-xs font-bold text-red-600">abaixo do mínimo ({fmtMoeda(d.produtos.preco_minimo!)})</div>}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap text-zinc-500">{fmtMoeda(d.preco_tabela)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap font-semibold">{fmtMoeda(d.preco_unit)}</td>
                          <td className="px-3 py-2 text-right font-semibold text-amber-600">{Number(d.desconto_pct).toLocaleString("pt-BR")}%</td>
                          <td className="px-3 py-2 text-right">{fmtQtd(d.quantidade)}</td>
                          <td className="px-3 py-2 text-right text-xs font-bold whitespace-nowrap">{pend ? <span className="text-amber-700 dark:text-amber-300">Aprovar →</span> : <span className="text-zinc-400">ok</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {pode("cargas") && (
          <section>
            <div className="mb-2 flex items-center justify-between"><h2 className="titulo text-lg">Cargas de hoje</h2><Link href="/cargas" className="text-sm font-semibold text-marca-600">Ver todas →</Link></div>
            <div className="cartao divide-y divide-zinc-100 dark:divide-zinc-800">
              {cargas.length === 0 && <p className="p-4 text-zinc-500">Nenhuma carga montada hoje.</p>}
              {cargas.map((c) => (
                <Link key={c.id} href={`/cargas/${c.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <div><div className="font-semibold">Carga {c.numero} · {TURNOS[c.turno]}</div><div className="text-sm text-zinc-500">{c.veiculos?.nome ?? "Sem veículo"} · {c.motoristas?.nome ?? "Sem motorista"} · {c.pedidos[0]?.count ?? 0} pedidos</div></div>
                  <Selo cor={STATUS_CARGA[c.status][1]}>{STATUS_CARGA[c.status][0]}</Selo>
                </Link>
              ))}
            </div>
          </section>
        )}

        {baixos.length > 0 && (
          <section>
            <h2 className="titulo mb-2 text-lg">Estoque baixo</h2>
            <div className="cartao divide-y divide-zinc-100 dark:divide-zinc-800">
              {baixos.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-3 p-3">
                  <span className="font-medium">{b.nome}</span>
                  <Selo cor={b.estoque <= 0 ? "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200" : "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200"}>
                    {b.estoque <= 0 ? "Zerado" : `${fmtQtd(b.estoque)} ${b.unidade} (mín. ${fmtQtd(b.estoque_minimo)})`}
                  </Selo>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {pode("pedidos_criar") && !verPedidos && (
        <Link href="/vender" className="cartao mt-6 block p-6 text-center text-lg font-semibold text-marca-600">📱 Abrir o app de pedidos</Link>
      )}

      <PedidoDetalhe id={aberto} aoFechar={() => setAberto(null)} aoMudar={carregar} />
    </>
  );
}
