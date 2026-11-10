"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg, fmtMoeda, hojeISO } from "@/lib/formato";
import { Botao, Cabecalho, Vazio, avisar } from "@/components/ui";
import { Exige } from "@/components/perfil-contexto";
import { NOME_TURNO, type ItemAgenda, type Turno } from "@/lib/agenda";

type Rota = { id: string; nome: string; vendedor_id: string | null; perfis: { nome: string } | null };
type Cli = { id: string; razao_social: string; nome_fantasia: string | null; bairro: string | null; telefone: string | null; rota_id: string; ordem_visita: number };
type Ped = { id: string; numero: number; total: number; cliente_id: string; status: string; perfis: { nome: string } | null };

const somarDias = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export default function Visitas() {
  const sb = supabaseNavegador();
  const [dia, setDia] = useState(hojeISO());
  const [rotas, setRotas] = useState<Rota[]>([]);
  const [clientes, setClientes] = useState<Cli[]>([]);
  const [pedidos, setPedidos] = useState<Ped[] | null>(null);
  const [soNao, setSoNao] = useState(false);
  const [abertas, setAbertas] = useState<Set<string>>(new Set());
  const [agenda, setAgenda] = useState<ItemAgenda[]>([]);
  const [todasRotas, setTodasRotas] = useState(false);
  const [nomes, setNomes] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([
      sb.from("rotas").select("id, nome, vendedor_id, perfis(nome)").eq("ativo", true).order("nome"),
      sb.from("clientes").select("id, razao_social, nome_fantasia, bairro, telefone, rota_id, ordem_visita").eq("ativo", true).not("ordem_visita", "is", null),
      sb.from("agenda_visitas").select("vendedor_id, dia_semana, turno, rota_id"),
      sb.from("perfis").select("id, nome"),
    ]).then(([r, c, a, pf]) => {
      setNomes(Object.fromEntries(((pf.data ?? []) as { id: string; nome: string }[]).map((x) => [x.id, x.nome])));
      setAgenda((a.data ?? []) as ItemAgenda[]);
      if (r.error || c.error) return avisar(erroMsg(r.error || c.error), "erro");
      setRotas((r.data ?? []) as unknown as Rota[]);
      setClientes((c.data ?? []) as Cli[]);
    });
  }, [sb]);

  useEffect(() => {
    setPedidos(null);
    const ini = new Date(dia + "T00:00:00"), fim = new Date(dia + "T00:00:00"); fim.setDate(fim.getDate() + 1);
    sb.from("pedidos").select("id, numero, total, cliente_id, status, perfis!pedidos_vendedor_id_fkey(nome)")
      .gte("feito_em", ini.toISOString()).lt("feito_em", fim.toISOString()).not("status", "in", "(cancelado,recusado)")
      .then(({ data, error }) => {
        if (error) return avisar(erroMsg(error), "erro");
        setPedidos((data ?? []) as unknown as Ped[]);
      });
  }, [sb, dia]);

  // pedidos do dia por cliente
  const porCliente = useMemo(() => {
    const m = new Map<string, Ped[]>();
    (pedidos ?? []).forEach((p) => m.set(p.cliente_id, [...(m.get(p.cliente_id) ?? []), p]));
    return m;
  }, [pedidos]);

  // com agenda: só as rotas do dia da semana escolhido, separadas por manhã/tarde
  const usarAgenda = agenda.length > 0 && !todasRotas;
  const grupos = useMemo(() => {
    const dow = new Date(dia + "T12:00:00").getDay();
    const slots: { rota: Rota; turno: Turno | null; vendedor_id?: string }[] = usarAgenda
      ? agenda.filter((a) => a.dia_semana === dow).sort((a, b) => a.turno.localeCompare(b.turno) * -1 || 0)
          .map((a) => ({ rota: rotas.find((r) => r.id === a.rota_id)!, turno: a.turno, vendedor_id: a.vendedor_id })).filter((x) => x.rota)
          .sort((a, b) => (a.turno === b.turno ? a.rota.nome.localeCompare(b.rota.nome, "pt-BR") : a.turno === "manha" ? -1 : 1))
      : rotas.map((rota) => ({ rota, turno: null }));
    return slots.map(({ rota: r, turno, vendedor_id }) => {
      const lista = clientes.filter((c) => c.rota_id === r.id).sort((a, b) => a.ordem_visita - b.ordem_visita);
      const compraram = lista.filter((c) => porCliente.has(c.id));
      return { chave: `${turno}-${r.id}-${vendedor_id ?? ""}`, rota: r, turno, vendedor_id, lista, compraram: compraram.length, naoCompraram: lista.length - compraram.length, valor: compraram.reduce((s, c) => s + porCliente.get(c.id)!.reduce((x, p) => x + Number(p.total), 0), 0) };
    }).filter((g) => g.lista.length);
  }, [rotas, clientes, porCliente, agenda, usarAgenda, dia]);

  const tot = grupos.reduce((s, g) => ({ clientes: s.clientes + g.lista.length, sim: s.sim + g.compraram, nao: s.nao + g.naoCompraram }), { clientes: 0, sim: 0, nao: 0 });
  const ehHoje = dia === hojeISO();
  const alternar = (id: string) => setAbertas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const tudoAberto = grupos.length > 0 && grupos.every((g) => abertas.has(g.chave));

  return (
    <Exige perm="pedidos_ver_todos">
      <Cabecalho titulo="Visitas do dia" sub={`${new Date(dia + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}${ehHoje ? " (hoje)" : ""} · clientes do roteiro que compraram e que não compraram`}>
        <span className="nao-imprimir flex flex-wrap gap-2">
          <Botao variante="secundario" onClick={() => setDia(somarDias(dia, -1))} aria-label="Dia anterior">←</Botao>
          <input type="date" className="campo w-auto!" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} aria-label="Dia" />
          <Botao variante="secundario" onClick={() => setDia(somarDias(dia, 1))} disabled={ehHoje} aria-label="Próximo dia">→</Botao>
          <Botao variante={soNao ? "primario" : "secundario"} onClick={() => setSoNao(!soNao)}>{soNao ? "✓ " : ""}Só os que não compraram</Botao>
          {agenda.length > 0 && <Botao variante={todasRotas ? "primario" : "secundario"} onClick={() => setTodasRotas(!todasRotas)}>{todasRotas ? "✓ " : ""}Todas as rotas</Botao>}
          <Botao variante="secundario" onClick={() => { setAbertas(new Set(grupos.map((g) => g.chave))); setTimeout(() => window.print(), 100); }}>🖨 Imprimir</Botao>
        </span>
      </Cabecalho>

      {pedidos === null ? <div className="cartao p-8 text-center text-zinc-500">Carregando…</div> : grupos.length === 0 ? (
        <Vazio>{usarAgenda ? "Nenhuma rota na agenda para este dia da semana. Veja em “Agenda de visitas” ou clique em “Todas as rotas”." : "Nenhuma rota com roteiro montado. Monte a ordem dos clientes em “Roteiro de visitas”."}</Vazio>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="cartao p-4"><div className="text-xs font-semibold uppercase text-zinc-500">Clientes nos roteiros</div><div className="font-display text-3xl font-bold">{tot.clientes}</div></div>
            <div className="cartao p-4"><div className="text-xs font-semibold uppercase text-zinc-500">Compraram</div><div className="font-display text-3xl font-bold text-emerald-600">{tot.sim}</div></div>
            <div className="cartao p-4"><div className="text-xs font-semibold uppercase text-zinc-500">Não compraram</div><div className="font-display text-3xl font-bold text-red-600">{tot.nao}</div></div>
          </div>
          <div className="nao-imprimir text-right">
            <button className="text-sm font-semibold text-marca-600" onClick={() => setAbertas(tudoAberto ? new Set() : new Set(grupos.map((g) => g.chave)))}>{tudoAberto ? "Fechar todas" : "Abrir todas"}</button>
          </div>

          {grupos.map((g) => {
            const aberta = abertas.has(g.chave);
            const lista = soNao ? g.lista.filter((c) => !porCliente.has(c.id)) : g.lista;
            return (
              <section key={g.chave} className="cartao overflow-hidden">
                <button onClick={() => alternar(g.chave)} aria-expanded={aberta} className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <div>
                    <div className="titulo text-xl">{g.turno ? `${g.turno === "manha" ? "☀️" : "🌇"} ${NOME_TURNO[g.turno]} · ` : ""}{g.rota.nome}</div>
                    <div className="text-sm text-zinc-500">👤 {(g.vendedor_id && nomes[g.vendedor_id]) || g.rota.perfis?.nome || "sem vendedor"} · {g.lista.length} clientes · {fmtMoeda(g.valor)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-bold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">✅ {g.compraram} compraram</span>
                    <span className={`rounded-full px-3 py-1 text-sm font-bold ${g.naoCompraram ? "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>❌ {g.naoCompraram} não compraram</span>
                    <span className="nao-imprimir text-zinc-400">{aberta ? "▲" : "▼"}</span>
                  </div>
                </button>
                <div className="mx-4 mb-3 h-2 rounded-full bg-red-200 dark:bg-red-500/30"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${(g.compraram / g.lista.length) * 100}%` }} /></div>
                {aberta && (
                  <div className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
                    {lista.length === 0 && <p className="p-4 text-center text-zinc-500">Todos os clientes desta rota compraram. 🎉</p>}
                    {lista.map((c) => {
                      const ps = porCliente.get(c.id);
                      return (
                        <div key={c.id} className={`flex items-center gap-3 px-4 py-2.5 ${ps ? "" : "bg-red-50/60 dark:bg-red-500/5"}`}>
                          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-zinc-100 font-display font-bold dark:bg-zinc-800">{c.ordem_visita}</span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate font-semibold">{c.razao_social}{c.nome_fantasia && <span className="font-normal text-zinc-500"> · {c.nome_fantasia}</span>}</div>
                            <div className="truncate text-xs text-zinc-500">{[c.bairro, c.telefone].filter(Boolean).join(" · ")}</div>
                          </div>
                          {ps ? (
                            <span className="shrink-0 text-right text-sm">
                              <b className="text-emerald-700 dark:text-emerald-400">✅ Comprou {fmtMoeda(ps.reduce((s, p) => s + Number(p.total), 0))}</b>
                              {ps.map((p) => <div key={p.id} className="text-xs text-zinc-500">nº {p.numero} · {p.perfis?.nome ?? "—"} · {fmtMoeda(p.total)}</div>)}
                            </span>
                          ) : <b className="shrink-0 text-sm text-red-600">❌ Não comprou</b>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
          <p className="text-xs text-zinc-500">Conta qualquer pedido do dia para o cliente (do vendedor ou lançado pelo escritório), menos cancelados e recusados. Só aparecem clientes que estão no roteiro de alguma rota.</p>
        </div>
      )}
    </Exige>
  );
}
