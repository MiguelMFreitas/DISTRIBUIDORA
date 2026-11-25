"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { alfa, combina, erroMsg, fmtData, fmtDataHora, fmtQtd, hojeISO } from "@/lib/formato";
import type { Produto } from "@/lib/tipos";
import { Botao, BotaoConfirmar, Cabecalho, Modal, Selo, Vazio, avisar } from "@/components/ui";
import { Cadastro, type Campo, type Coluna } from "@/components/cadastro";
import { BuscaProduto } from "@/components/busca-produto";
import { usePerfil, usePode } from "@/components/perfil-contexto";

/* =====================================================================
   Clube de pontos: clientes (saldo, extrato, troca), prêmios, desafios e níveis.
   Só pedidos feitos pelo robô do WhatsApp ganham pontos, quando são pagos.
   ===================================================================== */

type Nivel = "bronze" | "prata" | "ouro";
const NIVEIS: Record<Nivel, { nome: string; cor: string }> = {
  bronze: { nome: "🥉 Bronze", cor: "bg-orange-100 text-orange-900 dark:bg-orange-500/20 dark:text-orange-200" },
  prata: { nome: "🥈 Prata", cor: "bg-zinc-200 text-zinc-800 dark:bg-zinc-600 dark:text-zinc-100" },
  ouro: { nome: "🥇 Ouro", cor: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200" },
};
type ClienteClube = { id: string; codigo: string | null; nome: string; whatsapp: string | null; nivel: Nivel; saldo: number; a_vencer_30: number; proximo_vencimento: string | null; trocas_abertas: number };
type Extrato = {
  saldo: number; nivel: Nivel; multiplicador: number;
  movimentos: { id: string; tipo: string; pontos: number; vence_em: string | null; descricao: string | null; criado_em: string; pedido: number | null }[];
  lotes: { vence_em: string; pontos: number }[];
  trocas: { id: string; status: string; pontos: number; quantidade: number; criado_em: string; produto: string; pedido: number | null }[];
  desafios: { id: string; titulo: string; meta: number; bonus: number; fim: string; progresso: number; cumprido: boolean }[];
};
type Premio = { id: string; pontos: number; quantidade: number; ativo: boolean; produtos: { nome: string } };
type Desafio = { id: string; titulo: string; descricao: string | null; inicio: string; fim: string; produtos: string[]; meta: number; bonus: number; ativo: boolean };
type Config = { pontos_por_real: number; validade_meses: number; multiplicadores: Record<Nivel, number>; metas_prata: number; metas_ouro: number;
  meta_rota: boolean; produtos_foco: string[]; produtos_foco_minimo: number; quantidade_minima: number; volume_minimo: number };
const CONFIG_PADRAO: Config = { pontos_por_real: 1, validade_meses: 3, multiplicadores: { bronze: 1, prata: 1.2, ouro: 1.5 }, metas_prata: 2, metas_ouro: 4,
  meta_rota: true, produtos_foco: [], produtos_foco_minimo: 1, quantidade_minima: 0, volume_minimo: 0 };
const TIPO_MOV: Record<string, string> = { compra: "🛒 Compra", desafio: "🎯 Desafio", ajuste: "✏️ Ajuste", troca: "🎁 Troca", troca_cancelada: "↩️ Troca cancelada", vencimento: "⌛ Venceram", estorno: "↩️ Estorno" };
const STATUS_TROCA: Record<string, string> = { pendente: "espera o próximo pedido", no_pedido: "já está num pedido", entregue: "entregue", cancelada: "cancelada" };
const n = (x: unknown) => Number(x ?? 0);
const fmtPts = (x: number) => `${n(x).toLocaleString("pt-BR")} pts`;

/* ---------------- escolher produtos (chips) ---------------- */
function EscolherProdutos({ produtos, ids, aoMudar }: { produtos: Produto[]; ids: string[]; aoMudar: (ids: string[]) => void }) {
  return (
    <div className="space-y-2">
      <BuscaProduto produtos={produtos.filter((p) => !ids.includes(p.id))} aoEscolher={(p) => aoMudar([...ids, p.id])} placeholder="Pesquisar produto para pôr na lista…" />
      <div className="flex flex-wrap gap-1.5">
        {ids.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-full bg-marca-100 py-1 pl-3 pr-1 text-sm font-semibold text-marca-900 dark:bg-marca-500/20 dark:text-marca-100">
            {produtos.find((p) => p.id === id)?.nome ?? "produto"}
            <button type="button" className="grid size-6 place-items-center rounded-full hover:bg-marca-200" onClick={() => aoMudar(ids.filter((x) => x !== id))} aria-label="Tirar">×</button>
          </span>
        ))}
        {ids.length === 0 && <span className="text-sm text-zinc-500">Nenhum produto escolhido.</span>}
      </div>
    </div>
  );
}

/* ---------------- aba Clientes ---------------- */
function AbaClientes({ premios }: { premios: Premio[] }) {
  const sb = supabaseNavegador();
  const eu = usePerfil();
  const [lista, setLista] = useState<ClienteClube[] | null>(null);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<ClienteClube | null>(null);
  const [ext, setExt] = useState<Extrato | null>(null);
  const [ajuste, setAjuste] = useState({ pontos: "", motivo: "" });

  const carregar = useCallback(async () => {
    const { data, error } = await sb.rpc("clube_clientes");
    if (error) { avisar(/clube_clientes|function/i.test(error.message) ? "Rode a atualização 28 no Supabase para usar o clube de pontos." : erroMsg(error), "erro"); setLista([]); return; }
    setLista((data ?? []) as ClienteClube[]);
  }, [sb]);
  useEffect(() => { carregar(); }, [carregar]);
  const abrir = useCallback(async (c: ClienteClube) => {
    setAberto(c); setExt(null);
    const { data, error } = await sb.rpc("extrato_pontos", { p_cliente: c.id });
    if (error) return avisar(erroMsg(error), "erro");
    setExt(data as Extrato);
  }, [sb]);

  async function trocar(p: Premio) {
    if (!aberto) return;
    const { error } = await sb.rpc("trocar_pontos", { p_cliente: aberto.id, p_premio: p.id });
    if (error) return avisar(erroMsg(error), "erro");
    avisar(`Troca feita: ${p.produtos.nome} vai de graça no próximo pedido`);
    abrir(aberto); carregar();
  }
  async function cancelarTroca(id: string) {
    const { error } = await sb.rpc("cancelar_troca", { p_troca: id });
    if (error) return avisar(erroMsg(error), "erro");
    avisar("Troca cancelada: pontos devolvidos");
    if (aberto) abrir(aberto); carregar();
  }
  async function ajustar() {
    if (!aberto) return;
    const pts = Math.trunc(Number(ajuste.pontos));
    if (!pts) return avisar("Coloque os pontos (use − para tirar).", "erro");
    const { error } = await sb.rpc("ajustar_pontos", { p_cliente: aberto.id, p_pontos: pts, p_motivo: ajuste.motivo });
    if (error) return avisar(erroMsg(error), "erro");
    avisar("Ajuste feito"); setAjuste({ pontos: "", motivo: "" });
    abrir(aberto); carregar();
  }

  const visiveis = (lista ?? []).filter((c) => !busca.trim() || combina(`${c.nome} ${c.codigo ?? ""} ${c.whatsapp ?? ""}`, busca));
  const total = (lista ?? []).reduce((s, c) => s + n(c.saldo), 0);
  const porNivel = (["ouro", "prata", "bronze"] as Nivel[]).map((k) => [k, (lista ?? []).filter((c) => c.nivel === k).length] as const);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="cartao p-4"><div className="text-xs font-semibold uppercase text-zinc-500">Clientes no clube</div><div className="font-display text-3xl font-bold">{lista?.length ?? "—"}</div></div>
        <div className="cartao p-4"><div className="text-xs font-semibold uppercase text-zinc-500">Pontos com os clientes</div><div className="font-display text-3xl font-bold">{total.toLocaleString("pt-BR")}</div></div>
        <div className="cartao col-span-2 p-4"><div className="text-xs font-semibold uppercase text-zinc-500">Níveis deste mês</div>
          <div className="mt-1 flex flex-wrap gap-2">{porNivel.map(([k, q]) => <Selo key={k} cor={NIVEIS[k].cor}>{NIVEIS[k].nome}: {q}</Selo>)}</div></div>
      </div>
      <input className="campo max-w-sm" placeholder="Pesquisar cliente, código ou WhatsApp" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Pesquisar cliente" />
      {lista === null ? <div className="cartao p-8 text-center text-zinc-500">Carregando…</div> : visiveis.length === 0 ? (
        <Vazio>Nenhum cliente no clube ainda. Para entrar, o cliente precisa ter o <b>WhatsApp</b> no cadastro (tela Clientes). Os pontos vêm dos pedidos feitos pelo robô, quando são pagos.</Vazio>
      ) : (
        <div className="cartao divide-y divide-zinc-100 dark:divide-zinc-800">
          {visiveis.map((c) => (
            <button key={c.id} onClick={() => abrir(c)} className="flex w-full flex-wrap items-center gap-3 p-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{c.nome}</div>
                <div className="text-xs text-zinc-500">{c.whatsapp ? `WhatsApp ${c.whatsapp}` : "sem WhatsApp no cadastro"}{c.trocas_abertas ? ` · 🎁 ${c.trocas_abertas} prêmio(s) para entregar` : ""}</div>
              </div>
              <Selo cor={NIVEIS[c.nivel].cor}>{NIVEIS[c.nivel].nome}</Selo>
              <div className="w-32 text-right">
                <div className="text-lg font-bold">{fmtPts(c.saldo)}</div>
                {n(c.a_vencer_30) > 0 && <div className="text-xs font-semibold text-red-600">{n(c.a_vencer_30).toLocaleString("pt-BR")} vencem até {c.proximo_vencimento ? fmtData(c.proximo_vencimento) : ""}</div>}
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal aberto={!!aberto} aoFechar={() => setAberto(null)} titulo={aberto?.nome ?? ""} largura="max-w-3xl">
        {!ext ? <p className="text-zinc-500">Carregando…</p> : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
              <div className="font-display text-4xl font-bold">{fmtPts(ext.saldo)}</div>
              <Selo cor={NIVEIS[ext.nivel].cor}>{NIVEIS[ext.nivel].nome} · {String(ext.multiplicador).replace(".", ",")} ponto por R$ 1</Selo>
            </div>
            {ext.lotes.length > 0 && (
              <div className="text-sm"><b>Vencimentos:</b> {ext.lotes.map((l) => `${fmtPts(l.pontos)} em ${fmtData(l.vence_em)}`).join(" · ")}</div>
            )}

            <section>
              <h3 className="mb-1 font-bold">Trocar pontos por prêmio</h3>
              {premios.filter((p) => p.ativo).length === 0 ? <p className="text-sm text-zinc-500">Cadastre os prêmios na aba Prêmios.</p> : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {premios.filter((p) => p.ativo).sort((a, b) => a.pontos - b.pontos).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
                      <div className="min-w-0 text-sm"><b>{fmtQtd(p.quantidade)}×</b> {p.produtos.nome}<div className="text-xs text-zinc-500">{fmtPts(p.pontos)}</div></div>
                      <BotaoConfirmar tamanho="p" disabled={ext.saldo < p.pontos} aoConfirmar={() => trocar(p)} textoConfirmar="Trocar?">Trocar</BotaoConfirmar>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-1 text-xs text-zinc-500">O prêmio vai de graça no próximo pedido do cliente (o robô também vai fazer a troca pelo WhatsApp).</p>
            </section>

            {ext.trocas.length > 0 && (
              <section>
                <h3 className="mb-1 font-bold">Prêmios trocados</h3>
                {ext.trocas.map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2 border-b border-zinc-100 py-1.5 text-sm dark:border-zinc-800">
                    <span>🎁 {fmtQtd(t.quantidade)}× {t.produto} · {fmtPts(t.pontos)} · <span className="text-zinc-500">{STATUS_TROCA[t.status]}{t.pedido ? ` (nº ${t.pedido})` : ""}</span></span>
                    {t.status === "pendente" && <BotaoConfirmar tamanho="p" variante="fantasma" aoConfirmar={() => cancelarTroca(t.id)} textoConfirmar="Cancelar?">Cancelar</BotaoConfirmar>}
                  </div>
                ))}
              </section>
            )}

            {ext.desafios.length > 0 && (
              <section>
                <h3 className="mb-1 font-bold">Desafios</h3>
                {ext.desafios.map((d) => (
                  <div key={d.id} className="py-1 text-sm">
                    <div className="flex justify-between"><span>{d.cumprido ? "✅" : "🎯"} {d.titulo} <span className="text-zinc-500">(até {fmtData(d.fim)} · +{d.bonus} pts)</span></span><b>{fmtQtd(n(d.progresso))} de {fmtQtd(n(d.meta))}</b></div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"><div className="h-full bg-marca-500" style={{ width: `${Math.min(100, (n(d.progresso) / n(d.meta)) * 100)}%` }} /></div>
                  </div>
                ))}
              </section>
            )}

            {eu.admin && (
              <section className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/60">
                <h3 className="mb-2 font-bold">Ajuste manual</h3>
                <div className="flex flex-wrap gap-2">
                  <input className="campo w-28!" inputMode="numeric" placeholder="+100 ou −50" value={ajuste.pontos} onChange={(e) => setAjuste({ ...ajuste, pontos: e.target.value.replace("−", "-") })} aria-label="Pontos" />
                  <input className="campo flex-1" placeholder="Motivo (ex.: cortesia, erro no pedido 120)" value={ajuste.motivo} onChange={(e) => setAjuste({ ...ajuste, motivo: e.target.value })} aria-label="Motivo" />
                  <Botao variante="secundario" onClick={ajustar}>Lançar</Botao>
                </div>
              </section>
            )}

            <section>
              <h3 className="mb-1 font-bold">Extrato</h3>
              {ext.movimentos.length === 0 ? <p className="text-sm text-zinc-500">Nenhum movimento ainda.</p> : (
                <div className="max-h-72 overflow-y-auto">
                  {ext.movimentos.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-2 border-b border-zinc-100 py-1.5 text-sm dark:border-zinc-800">
                      <div className="min-w-0"><div>{TIPO_MOV[m.tipo] ?? m.tipo} · {m.descricao}</div><div className="text-xs text-zinc-500">{fmtDataHora(m.criado_em)}{m.vence_em ? ` · vence ${fmtData(m.vence_em)}` : ""}</div></div>
                      <b className={m.pontos > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600"}>{m.pontos > 0 ? "+" : ""}{m.pontos.toLocaleString("pt-BR")}</b>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </Modal>
    </div>
  );
}

/* ---------------- aba Desafios ---------------- */
function AbaDesafios({ produtos }: { produtos: Produto[] }) {
  const sb = supabaseNavegador();
  const eu = usePerfil();
  const [lista, setLista] = useState<Desafio[]>([]);
  const [form, setForm] = useState<Partial<Desafio> | null>(null);
  const [ranking, setRanking] = useState<{ d: Desafio; linhas: { id: string; nome: string; progresso: number; cumprido: boolean }[] } | null>(null);
  const carregar = useCallback(async () => {
    const { data, error } = await sb.from("desafios").select("*").order("fim", { ascending: false });
    if (error) return avisar(erroMsg(error), "erro");
    setLista((data ?? []) as Desafio[]);
  }, [sb]);
  useEffect(() => { carregar(); }, [carregar]);
  const nomeProd = (id: string) => produtos.find((p) => p.id === id)?.nome ?? "produto";

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const d = { titulo: (form.titulo ?? "").trim(), descricao: form.descricao?.trim() || null, inicio: form.inicio, fim: form.fim, produtos: form.produtos ?? [],
      meta: Number(form.meta), bonus: Math.trunc(Number(form.bonus)), ativo: form.ativo ?? true };
    if (!d.titulo || !d.inicio || !d.fim || !d.produtos.length || !(d.meta > 0) || !(d.bonus > 0)) return avisar("Preencha título, período, produtos, meta e pontos de bônus.", "erro");
    const { error } = form.id ? await sb.from("desafios").update(d).eq("id", form.id) : await sb.from("desafios").insert(d);
    if (error) return avisar(erroMsg(error), "erro");
    avisar("Desafio salvo"); setForm(null); carregar();
  }
  async function verRanking(d: Desafio) {
    const { data, error } = await sb.rpc("progresso_desafio", { p_desafio: d.id });
    if (error) return avisar(erroMsg(error), "erro");
    setRanking({ d, linhas: (data ?? []) as { id: string; nome: string; progresso: number; cumprido: boolean }[] });
  }
  const hoje = hojeISO();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-500">Ex.: “Compre 10 fardos de Coca 2L em dezembro e ganhe +500 pontos”. Conta os pedidos do robô feitos no período e já pagos (o que voltou não conta).</p>
        {eu.admin && <Botao onClick={() => { const fim = new Date(); fim.setMonth(fim.getMonth() + 1, 0); setForm({ inicio: hoje, fim: `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, "0")}-${String(fim.getDate()).padStart(2, "0")}`, produtos: [], ativo: true }); }}>+ Novo desafio</Botao>}
      </div>
      {lista.length === 0 ? <Vazio>Nenhum desafio ainda.</Vazio> : (
        <div className="grid gap-3 md:grid-cols-2">
          {lista.map((d) => {
            const vigente = d.ativo && d.inicio <= hoje && d.fim >= hoje;
            return (
              <div key={d.id} className={`cartao space-y-2 p-4 ${d.ativo ? "" : "opacity-60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-lg font-bold">🎯 {d.titulo}</h3>
                  <Selo cor={vigente ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"}>{vigente ? "valendo" : !d.ativo ? "desligado" : d.inicio > hoje ? "ainda não começou" : "terminou"}</Selo>
                </div>
                {d.descricao && <p className="text-sm text-zinc-500">{d.descricao}</p>}
                <p className="text-sm"><b>{fmtQtd(d.meta)}</b> fardos/caixas de <b>{d.produtos.map(nomeProd).join(", ")}</b> · {fmtData(d.inicio)} a {fmtData(d.fim)} · <b>+{d.bonus.toLocaleString("pt-BR")} pontos</b></p>
                <div className="flex gap-2">
                  <Botao tamanho="p" variante="secundario" onClick={() => verRanking(d)}>Quem está participando</Botao>
                  {eu.admin && <Botao tamanho="p" variante="fantasma" onClick={() => setForm(d)}>Editar</Botao>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal aberto={!!form} aoFechar={() => setForm(null)} titulo={form?.id ? "Editar desafio" : "Novo desafio"} largura="max-w-xl"
        rodape={<><Botao variante="secundario" onClick={() => setForm(null)}>Cancelar</Botao><Botao type="submit" form="form-desafio">Salvar</Botao></>}>
        {form && (
          <form id="form-desafio" onSubmit={salvar} className="space-y-3">
            <label className="block"><span className="rotulo">Título (o robô usa este texto)</span><input className="campo" value={form.titulo ?? ""} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ex.: Coca em dobro de dezembro" /></label>
            <label className="block"><span className="rotulo">Explicação (opcional)</span><input className="campo" value={form.descricao ?? ""} onChange={(e) => setForm({ ...form, descricao: e.target.value })} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="rotulo">Começa</span><input type="date" className="campo" value={form.inicio ?? ""} onChange={(e) => setForm({ ...form, inicio: e.target.value })} /></label>
              <label className="block"><span className="rotulo">Termina</span><input type="date" className="campo" value={form.fim ?? ""} onChange={(e) => setForm({ ...form, fim: e.target.value })} /></label>
            </div>
            <div><span className="rotulo">Produtos que contam</span><EscolherProdutos produtos={produtos} ids={form.produtos ?? []} aoMudar={(ids) => setForm({ ...form, produtos: ids })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="rotulo">Meta (fardos/caixas)</span><input className="campo" inputMode="decimal" value={form.meta ?? ""} onChange={(e) => setForm({ ...form, meta: e.target.value as unknown as number })} /></label>
              <label className="block"><span className="rotulo">Pontos de bônus</span><input className="campo" inputMode="numeric" value={form.bonus ?? ""} onChange={(e) => setForm({ ...form, bonus: e.target.value as unknown as number })} /></label>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.ativo ?? true} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Desafio ligado</label>
          </form>
        )}
      </Modal>

      <Modal aberto={!!ranking} aoFechar={() => setRanking(null)} titulo={ranking ? ranking.d.titulo : ""} largura="max-w-lg">
        {ranking && (ranking.linhas.length === 0 ? <p className="text-zinc-500">Ninguém comprou os produtos deste desafio ainda.</p> : (
          <div className="space-y-2">
            {ranking.linhas.map((l) => (
              <div key={l.id} className="text-sm">
                <div className="flex justify-between"><span>{l.cumprido ? "✅ " : ""}{l.nome}</span><b>{fmtQtd(n(l.progresso))} de {fmtQtd(n(ranking.d.meta))}</b></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"><div className="h-full bg-marca-500" style={{ width: `${Math.min(100, (n(l.progresso) / n(ranking.d.meta)) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        ))}
      </Modal>
    </div>
  );
}

/* ---------------- aba Níveis ---------------- */
function AbaNiveis({ produtos }: { produtos: Produto[] }) {
  const sb = supabaseNavegador();
  const eu = usePerfil();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    sb.from("configuracoes").select("valor").eq("chave", "clube").maybeSingle().then(({ data }) => setCfg({ ...CONFIG_PADRAO, ...((data?.valor ?? {}) as Partial<Config>) }));
  }, [sb]);
  if (!cfg) return <div className="cartao p-8 text-center text-zinc-500">Carregando…</div>;
  const metasAtivas = [cfg.meta_rota, cfg.produtos_foco.length > 0, cfg.quantidade_minima > 0, cfg.volume_minimo > 0].filter(Boolean).length;
  const num = (v: string) => Number(v.replace(",", ".")) || 0;

  async function salvar() {
    if (!cfg) return;
    setSalvando(true);
    const { error } = await sb.from("configuracoes").upsert({ chave: "clube", valor: cfg });
    if (error) { setSalvando(false); return avisar(erroMsg(error), "erro"); }
    const r = await sb.rpc("calcular_niveis", { p_mes: hojeISO() });
    setSalvando(false);
    if (r.error) return avisar(erroMsg(r.error), "erro");
    avisar("Regras salvas e níveis deste mês recalculados");
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="cartao space-y-1 p-4 text-sm">
        <p><b>Pontos:</b> {cfg.pontos_por_real} ponto a cada R$ 1 pago, só em pedido do robô do WhatsApp. Valem <b>{cfg.validade_meses} meses</b>; o robô avisa com 30, 15, 10 e 5 dias.</p>
        <p><b>Como funciona o nível:</b> todo mês o sistema olha as compras do mês anterior. Quem bate as metas sobe de nível e ganha mais pontos por real naquele mês.</p>
      </div>

      <section className="cartao space-y-3 p-4">
        <h3 className="titulo text-lg">Metas do mês</h3>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 size-5" disabled={!eu.admin} checked={cfg.meta_rota} onChange={(e) => setCfg({ ...cfg, meta_rota: e.target.checked })} />
          <span><b>Comprar toda rota</b><span className="block text-sm text-zinc-500">Comprou em todas as passagens da rota do bairro dele no mês (pela Agenda de visitas). Bairro sem agenda: comprou em 4 semanas.</span></span></label>
        <div>
          <b>Comprar certos produtos</b>
          <p className="text-sm text-zinc-500">Comprou pelo menos <input className="campo inline-block w-16! px-2! py-1!" disabled={!eu.admin} inputMode="numeric" value={cfg.produtos_foco_minimo} onChange={(e) => setCfg({ ...cfg, produtos_foco_minimo: Math.max(1, Math.trunc(num(e.target.value))) })} aria-label="Quantos produtos da lista" /> produto(s) diferente(s) desta lista:</p>
          {eu.admin ? <EscolherProdutos produtos={produtos} ids={cfg.produtos_foco} aoMudar={(ids) => setCfg({ ...cfg, produtos_foco: ids })} />
            : <p className="text-sm">{cfg.produtos_foco.map((id) => produtos.find((p) => p.id === id)?.nome).filter(Boolean).join(", ") || "nenhum"}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="rotulo">Comprar certa quantidade (fardos/caixas no mês)</span>
            <input className="campo" disabled={!eu.admin} inputMode="decimal" value={cfg.quantidade_minima || ""} placeholder="0 = não usar" onChange={(e) => setCfg({ ...cfg, quantidade_minima: num(e.target.value) })} /></label>
          <label className="block"><span className="rotulo">Comprar certo volume (litros no mês)</span>
            <input className="campo" disabled={!eu.admin} inputMode="decimal" value={cfg.volume_minimo || ""} placeholder="0 = não usar" onChange={(e) => setCfg({ ...cfg, volume_minimo: num(e.target.value) })} /></label>
        </div>
        <p className="text-xs text-zinc-500">O volume usa o campo “Litros no fardo/caixa” do cadastro de cada produto.</p>
      </section>

      <section className="cartao space-y-3 p-4">
        <h3 className="titulo text-lg">Níveis</h3>
        <p className="text-sm text-zinc-500">Metas ligadas agora: <b>{metasAtivas}</b>.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(["bronze", "prata", "ouro"] as Nivel[]).map((k) => (
            <div key={k} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              <Selo cor={NIVEIS[k].cor}>{NIVEIS[k].nome}</Selo>
              <label className="mt-2 block"><span className="rotulo">Pontos por R$ 1</span>
                <input className="campo" disabled={!eu.admin} inputMode="decimal" value={String(cfg.multiplicadores[k]).replace(".", ",")} onChange={(e) => setCfg({ ...cfg, multiplicadores: { ...cfg.multiplicadores, [k]: num(e.target.value) } })} /></label>
              {k !== "bronze" && <label className="mt-2 block"><span className="rotulo">Metas para chegar</span>
                <input className="campo" disabled={!eu.admin} inputMode="numeric" value={k === "prata" ? cfg.metas_prata : cfg.metas_ouro}
                  onChange={(e) => setCfg({ ...cfg, [k === "prata" ? "metas_prata" : "metas_ouro"]: Math.max(1, Math.trunc(num(e.target.value))) })} /></label>}
              {k === "bronze" && <p className="mt-2 text-xs text-zinc-500">Todo cliente começa no Bronze.</p>}
            </div>
          ))}
        </div>
        {cfg.metas_ouro > metasAtivas && <p className="text-sm font-semibold text-amber-700">Ouro pede {cfg.metas_ouro} metas, mas só {metasAtivas} estão ligadas: ninguém chega ao Ouro.</p>}
        {eu.admin && <Botao onClick={salvar} carregando={salvando}>Salvar e recalcular os níveis deste mês</Botao>}
      </section>
    </div>
  );
}

/* ---------------- página ---------------- */
const CAMPOS_PREMIO: Campo[] = [
  { nome: "produto_id", rotulo: "Produto que o cliente ganha", ref: { tabela: "produtos", rotulo: "nome" }, obrigatorio: true, largura: 6 },
  { nome: "quantidade", rotulo: "Quantidade (fardos/caixas)", tipo: "numero", obrigatorio: true, padrao: 1, largura: 3 },
  { nome: "pontos", rotulo: "Quantos pontos custa", tipo: "numero", obrigatorio: true, largura: 3 },
  { nome: "ativo", rotulo: "Prêmio ligado (aparece para os clientes)", tipo: "bool", padrao: true },
];
const COLUNAS_PREMIO: Coluna[] = [
  { rotulo: "Prêmio", valor: (l, r) => <span className="font-semibold">🎁 {fmtQtd(l.quantidade)}× {r.produto_id?.[l.produto_id] ?? "—"}</span> },
  { rotulo: "Pontos", valor: (l) => <b>{fmtPts(l.pontos)}</b>, classe: "text-right whitespace-nowrap" },
];

export default function Clube() {
  const sb = supabaseNavegador();
  const pode = usePode();
  const eu = usePerfil();
  const [aba, setAba] = useState<"clientes" | "premios" | "desafios" | "niveis">("clientes");
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [premios, setPremios] = useState<Premio[]>([]);
  useEffect(() => {
    sb.from("produtos").select("*").eq("ativo", true).then(({ data }) => setProdutos(((data ?? []) as Produto[]).sort((a, b) => alfa(a.nome, b.nome))));
    sb.from("premios").select("id, pontos, quantidade, ativo, produtos(nome)").then(({ data }) => setPremios((data ?? []) as unknown as Premio[]));
  }, [sb, aba]);
  const abas = useMemo(() => [["clientes", "👥 Clientes"], ["premios", "🎁 Prêmios"], ["desafios", "🎯 Desafios"], ["niveis", "🏅 Níveis e metas"]] as const, []);

  if (!pode("pedidos_ver_todos") && !pode("clientes") && !pode("financeiro")) return <Vazio>Sem acesso.</Vazio>;
  return (
    <>
      <Cabecalho titulo="Clube de pontos" sub="Pontos dos pedidos feitos pelo robô do WhatsApp: entram quando o pedido é pago, valem 3 meses e viram prêmios." />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800" role="tablist">
        {abas.map(([k, nome]) => (
          <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold whitespace-nowrap ${aba === k ? "border-marca-500 text-marca-700 dark:text-marca-500" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"}`}>{nome}</button>
        ))}
      </div>
      {aba === "clientes" && <AbaClientes premios={premios} />}
      {aba === "premios" && (
        <>
          <p className="mb-3 text-sm text-zinc-500">O que o cliente pode ganhar trocando pontos. O prêmio sai de graça no próximo pedido dele e aparece no pedido, no cupom e no romaneio.</p>
          <Cadastro tabela="premios" singular="Prêmio" campos={CAMPOS_PREMIO} colunas={COLUNAS_PREMIO} buscaEm={[]} ordem="pontos" podeEditar={eu.admin} />
        </>
      )}
      {aba === "desafios" && <AbaDesafios produtos={produtos} />}
      {aba === "niveis" && <AbaNiveis produtos={produtos} />}
    </>
  );
}
