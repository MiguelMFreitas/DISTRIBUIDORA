"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { fmtDataHora, fmtMoeda, fmtQtd, hojeISO, TURNOS } from "@/lib/formato";
import { Cabecalho, Selo } from "@/components/ui";
import { usePerfil, usePode } from "@/components/perfil-contexto";
import { PedidoDetalhe } from "@/components/pedido-detalhe";
import { STATUS_CARGA } from "@/lib/tipos";

type Aguardando = { id: string; numero: number; total: number; feito_em: string; clientes: { razao_social: string }; perfis: { nome: string } | null };
type CargaHoje = { id: string; numero: number; turno: "manha" | "tarde"; status: string; veiculos: { nome: string } | null; motoristas: { nome: string } | null; pedidos: { count: number }[] };
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

  const verPedidos = pode("pedidos_ver_todos") || pode("cargas");
  const podeCargas = pode("cargas");

  const carregar = useCallback(async () => {
    const inicio = new Date(hojeISO() + "T00:00:00").toISOString();
    if (verPedidos) {
      const [{ data: ph }, { count }, { data: ag }] = await Promise.all([
        sb.from("pedidos").select("total").gte("feito_em", inicio).not("status", "in", "(cancelado,recusado)"),
        sb.from("pedidos").select("id", { count: "exact", head: true }).eq("status", "liberado").is("carga_id", null),
        sb.from("pedidos").select("id, numero, total, feito_em, clientes(razao_social), perfis!pedidos_vendedor_id_fkey(nome)").eq("status", "aguardando_aprovacao").order("numero"),
      ]);
      setHoje({ qtd: ph?.length ?? 0, valor: (ph ?? []).reduce((s: number, p: { total: number }) => s + Number(p.total), 0) });
      setSemCarga(count ?? 0);
      setAguardando((ag ?? []) as unknown as Aguardando[]);
    }
    if (podeCargas) {
      const { data } = await sb.from("cargas").select("id, numero, turno, status, veiculos(nome), motoristas(nome), pedidos(count)").eq("data", hojeISO()).order("turno").order("numero");
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
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Numero titulo="Pedidos hoje" valor={hoje.qtd} sub={fmtMoeda(hoje.valor)} href="/pedidos" />
          <Numero titulo="Sem carga" valor={semCarga} sub="liberados, esperando carga" href="/cargas" />
          <Numero titulo="Aguardando aprovação" valor={aguardando.length} sub="desconto acima do limite" destaque={aguardando.length > 0} />
          <Numero titulo="Estoque baixo" valor={baixos.length} sub="produtos no mínimo ou zerados" href="/estoque" destaque={baixos.some((b) => b.estoque <= 0)} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
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
