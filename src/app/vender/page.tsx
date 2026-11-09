"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseNavegador } from "@/lib/supabase/client";
import { alfa, combina, fmtDataHora, fmtMoeda, fmtQtd, hojeISO, UNIDADES } from "@/lib/formato";
import type { Cliente, Produto } from "@/lib/tipos";
import { STATUS_PEDIDO, type StatusPedido } from "@/lib/tipos";
import {
  atualizarCatalogo, lerCatalogo, lerEnviados, lerFila, novoId, salvarNaFila, sincronizar, tirarDaFila, totalItens,
  type Catalogo, type ItemPedido, type PedidoEnviado, type PedidoFila,
} from "@/lib/offline";
import { Avisos, avisar } from "@/components/ui";

type Tela = "inicio" | "cliente" | "itens" | "revisar" | "pronto";
type Rascunho = { client_id: string; cliente: Cliente | null; itens: ItemPedido[]; observacao: string };
const CHAVE_RASCUNHO = "vender_rascunho";
const vazio = (): Rascunho => ({ client_id: novoId(), cliente: null, itens: [], observacao: "" });

/* ---------- pedaços de interface ---------- */
function Passo({ valor, meia, max, aoMudar }: { valor: number; meia: boolean; max: number; aoMudar: (n: number) => void }) {
  const passo = meia ? 0.5 : 1;
  const [texto, setTexto] = useState(String(valor).replace(".", ","));
  useEffect(() => { setTexto(String(valor).replace(".", ",")); }, [valor]);
  function confirmar(t: string) {
    let n = Number(t.replace(",", "."));
    if (!isFinite(n) || n < 0) n = 0;
    n = meia ? Math.round(n * 2) / 2 : Math.round(n);
    aoMudar(Math.min(n, max));
  }
  return (
    <div className="flex items-center overflow-hidden rounded-xl border border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      <button className="h-11 w-11 text-2xl font-semibold text-zinc-500 active:bg-zinc-100" onClick={() => aoMudar(Math.max(0, valor - passo))} aria-label="Diminuir">−</button>
      <input className="h-11 w-14 border-x border-zinc-300 bg-transparent text-center text-lg font-bold dark:border-zinc-700" inputMode="decimal"
        value={texto} onChange={(e) => setTexto(e.target.value)} onBlur={(e) => confirmar(e.target.value)} onFocus={(e) => e.target.select()}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
      <button className="h-11 w-11 text-2xl font-semibold text-marca-600 active:bg-zinc-100 disabled:opacity-30" disabled={valor + passo > max} onClick={() => aoMudar(Math.min(max, valor + passo))} aria-label="Aumentar">+</button>
    </div>
  );
}

function SeloEstoque({ disp, minimo }: { disp: number; minimo: number }) {
  if (disp <= 0) return <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700 dark:bg-red-500/20 dark:text-red-200">Sem estoque</span>;
  if (disp <= minimo) return <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">Pouco: {fmtQtd(disp)}</span>;
  return <span className="text-xs text-zinc-500">Estoque {fmtQtd(disp)}</span>;
}

export default function Vender() {
  const sb = supabaseNavegador();
  const router = useRouter();
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [fila, setFila] = useState<PedidoFila[]>([]);
  const [enviados, setEnviados] = useState<PedidoEnviado[]>([]);
  const [hojeServidor, setHojeServidor] = useState<{ numero: number; status: StatusPedido; total: number; feito_em: string; cliente_id: string; clientes: { razao_social: string } }[] | null>(null);
  const [roteiroAberto, setRoteiroAberto] = useState(true);
  // clientes do roteiro que têm pedido (de qualquer um), vindos do servidor
  const [comPedidoServidor, setComPedidoServidor] = useState<{ hoje: string[]; anterior: { dia: string; ids: string[] } | null }>({ hoje: [], anterior: null });
  const [alertaOntemVisto, setAlertaOntemVisto] = useState<string | null>(null);
  const [tela, setTela] = useState<Tela>("inicio");
  const [r, setR] = useState<Rascunho>(vazio);
  const [busca, setBusca] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ tipo: "ok" | "fila" | "aprovar"; numero?: number } | null>(null);
  const [precisaLogin, setPrecisaLogin] = useState(false);
  const buscaRef = useRef<HTMLInputElement>(null);

  /* ---------- carregar: primeiro do aparelho, depois do servidor ---------- */
  const recarregarListas = useCallback(async () => {
    setFila(await lerFila());
    setEnviados(await lerEnviados());
  }, []);

  const buscarHoje = useCallback(async (uid: string) => {
    const { data } = await sb.from("pedidos").select("numero, status, total, feito_em, cliente_id, clientes(razao_social)")
      .eq("vendedor_id", uid).gte("feito_em", new Date(hojeISO() + "T00:00:00").toISOString()).order("numero", { ascending: false });
    if (data) setHojeServidor(data as unknown as typeof hojeServidor);
    // dia anterior de trabalho (pula o domingo)
    const ant = new Date(hojeISO() + "T12:00:00"); ant.setDate(ant.getDate() - 1); if (ant.getDay() === 0) ant.setDate(ant.getDate() - 1);
    const diaAnt = ant.toISOString().slice(0, 10);
    const [h, a] = await Promise.all([
      sb.rpc("clientes_do_roteiro_com_pedido", { p_dia: hojeISO() }),
      sb.rpc("clientes_do_roteiro_com_pedido", { p_dia: diaAnt }),
    ]);
    const ids = (d: unknown) => ((d ?? []) as unknown[]).map((x) => (typeof x === "string" ? x : Object.values(x as object)[0] as string));
    if (!h.error && !a.error) {
      const novo = { hoje: ids(h.data), anterior: { dia: diaAnt, ids: ids(a.data) } };
      setComPedidoServidor(novo);
      try { localStorage.setItem("vender_alerta", JSON.stringify({ ...novo, em: hojeISO() })); } catch {}
    }
  }, [sb]);

  const enviarFila = useCallback(async () => {
    const res = await sincronizar(sb);
    await recarregarListas();
    if (res.precisaLogin) setPrecisaLogin(true);
    if (res.enviados) avisar(`${res.enviados} pedido(s) da fila enviado(s)`);
    if (res.erros) avisar(`${res.erros} pedido(s) com problema. Veja na lista.`, "erro");
    if (res.enviados && userId) buscarHoje(userId);
    return res;
  }, [sb, recarregarListas, userId, buscarHoje]);

  useEffect(() => {
    (async () => {
      setOnline(navigator.onLine);
      setCat(await lerCatalogo());
      await recarregarListas();
      try { const s = localStorage.getItem(CHAVE_RASCUNHO); if (s) setR(JSON.parse(s)); } catch {}
      try {
        const al = JSON.parse(localStorage.getItem("vender_alerta") ?? "null");
        if (al?.em === hojeISO()) setComPedidoServidor({ hoje: al.hoje ?? [], anterior: al.anterior ?? null });
        setAlertaOntemVisto(localStorage.getItem("vender_alerta_ontem_visto"));
      } catch {}
      const { data: { session } } = await sb.auth.getSession();
      const uid = session?.user.id ?? (await lerCatalogo()).perfil?.id ?? null;
      if (!uid) { if (navigator.onLine) router.replace("/login"); return; }
      setUserId(uid);
      if (navigator.onLine && session) {
        try { setCat(await atualizarCatalogo(sb, uid)); } catch { /* fica com o do aparelho */ }
        buscarHoje(uid);
      }
    })();
  }, [sb, router, recarregarListas, buscarHoje]);

  // service worker (abre sem internet) + guarda os arquivos desta tela
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready).then((reg) => {
      const urls = performance.getEntriesByType("resource").map((e) => e.name).filter((u) => u.startsWith(location.origin + "/_next/static/"));
      reg.active?.postMessage({ tipo: "cachear", urls: ["/vender", ...urls] });
    }).catch(() => {});
  }, []);

  // internet voltou: envia a fila
  useEffect(() => {
    const on = () => { setOnline(true); enviarFila(); };
    const off = () => setOnline(false);
    const vis = () => { if (document.visibilityState === "visible" && navigator.onLine) enviarFila(); };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    document.addEventListener("visibilitychange", vis);
    const t = setInterval(() => { if (navigator.onLine) enviarFila(); }, 30000);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); document.removeEventListener("visibilitychange", vis); clearInterval(t); };
  }, [enviarFila]);

  // guarda o pedido em andamento (se fechar o app, não perde)
  useEffect(() => {
    try {
      if (r.cliente || r.itens.length) localStorage.setItem(CHAVE_RASCUNHO, JSON.stringify(r));
      else localStorage.removeItem(CHAVE_RASCUNHO);
    } catch {}
  }, [r]);

  /* ---------- estoque disponível = do aparelho − o que está na fila ---------- */
  const reservado = useMemo(() => {
    const m: Record<string, number> = {};
    fila.filter((p) => p.estado !== "erro" && p.client_id !== r.client_id).forEach((p) => p.itens.forEach((i) => { m[i.produto_id] = (m[i.produto_id] ?? 0) + i.quantidade; }));
    return m;
  }, [fila, r.client_id]);
  const disponivel = useCallback((p: Produto) => Math.max(0, Number(p.estoque) - (reservado[p.id] ?? 0)), [reservado]);

  const perfil = cat?.perfil;
  const descMax = perfil?.admin ? 100 : Number(perfil?.desconto_max ?? 0);
  const ordemCat = useMemo(() => Object.fromEntries((cat?.categorias ?? []).map((c) => [c.id, c.ordem])), [cat]);

  const clientesFiltrados = useMemo(() => {
    if (!cat) return [];
    let l = cat.clientes;
    if (busca.trim()) l = l.filter((c) => combina(`${c.razao_social} ${c.nome_fantasia ?? ""} ${c.codigo ?? ""} ${c.bairro ?? ""} ${c.cpf_cnpj ?? ""}`, busca));
    // clientes do vendedor primeiro
    return [...l].sort((a, b) => Number(b.vendedor_id === userId) - Number(a.vendedor_id === userId) || alfa(a.razao_social, b.razao_social)).slice(0, 60);
  }, [cat, busca, userId]);

  const produtosFiltrados = useMemo(() => {
    if (!cat || !busca.trim()) return [];
    return cat.produtos.filter((p) => combina(`${p.nome} ${p.codigo ?? ""}`, busca)).sort((a, b) => alfa(a.nome, b.nome)).slice(0, 40);
  }, [cat, busca]);

  const total = totalItens(r.itens);
  const precisaAprovar = r.itens.some((i) => i.desconto_pct > descMax);

  /* ---------- ações ---------- */
  function novoPedido() {
    setR(vazio());
    setBusca("");
    setTela("cliente");
    setTimeout(() => buscaRef.current?.focus(), 50);
  }

  // clientes que já têm pedido hoje (enviado, na fila ou no servidor)
  const comPedidoHoje = useMemo(() => {
    const s = new Set<string>();
    (hojeServidor ?? []).filter((p) => !["cancelado", "recusado"].includes(p.status)).forEach((p) => s.add(p.cliente_id));
    fila.forEach((p) => s.add(p.cliente_id));
    enviados.filter((e) => e.feito_em.slice(0, 10) === hojeISO() && e.cliente_id).forEach((e) => s.add(e.cliente_id!));
    comPedidoServidor.hoje.forEach((id) => s.add(id));
    return s;
  }, [hojeServidor, fila, enviados, comPedidoServidor]);

  // roteiro de visitas das rotas em que este vendedor é o responsável
  const roteiros = useMemo(() => (cat?.rotas ?? []).map((rt) => ({
    rota: rt,
    clientes: (cat?.clientes ?? []).filter((c) => c.rota_id === rt.id && c.ordem_visita != null).sort((a, b) => a.ordem_visita! - b.ordem_visita!),
  })).filter((x) => x.clientes.length), [cat]);

  const faltamHoje = useMemo(() => roteiros.flatMap((x) => x.clientes).filter((c) => !comPedidoHoje.has(c.id)), [roteiros, comPedidoHoje]);
  const naoCompraramAntes = useMemo(() => {
    const ant = comPedidoServidor.anterior;
    if (!ant) return [];
    const set = new Set(ant.ids);
    return roteiros.flatMap((x) => x.clientes).filter((c) => !set.has(c.id));
  }, [roteiros, comPedidoServidor]);
  const tarde = new Date().getHours() >= 14;
  const nomes = (l: Cliente[]) => l.slice(0, 6).map((c) => c.nome_fantasia || c.razao_social).join(", ") + (l.length > 6 ? ` e mais ${l.length - 6}` : "");

  function pedidoPara(c: Cliente) {
    setR({ ...vazio(), cliente: c });
    setBusca("");
    setTela("itens");
    setTimeout(() => buscaRef.current?.focus(), 50);
  }

  function escolherCliente(c: Cliente) {
    setR((x) => ({ ...x, cliente: c }));
    setBusca("");
    setTela("itens");
    setTimeout(() => buscaRef.current?.focus(), 50);
  }

  function adicionar(p: Produto) {
    const disp = disponivel(p);
    const atual = r.itens.find((i) => i.produto_id === p.id);
    if (disp <= 0) return avisar("Produto sem estoque.", "erro");
    if (atual) {
      setR((x) => ({ ...x, itens: x.itens.map((i) => (i.produto_id === p.id ? { ...i, quantidade: Math.min(disp, i.quantidade + 1) } : i)) }));
    } else {
      setR((x) => ({ ...x, itens: [...x.itens, { produto_id: p.id, nome: p.nome, unidade: p.unidade, permite_meia: p.permite_meia, preco: Number(p.preco), quantidade: Math.min(1, disp), desconto_pct: 0 }] }));
    }
    if (disp <= p.estoque_minimo) avisar(`Atenção: só tem ${fmtQtd(disp)} de ${p.nome}`);
    setBusca("");
    buscaRef.current?.focus();
  }

  const mudarItem = (id: string, campos: Partial<ItemPedido>) =>
    setR((x) => ({ ...x, itens: x.itens.map((i) => (i.produto_id === id ? { ...i, ...campos } : i)) }));
  const tirarItem = (id: string) => setR((x) => ({ ...x, itens: x.itens.filter((i) => i.produto_id !== id) }));

  async function enviar() {
    if (!r.cliente || !r.itens.length) return;
    const itens = r.itens.filter((i) => i.quantidade > 0);
    if (!itens.length) return avisar("Coloque a quantidade dos produtos.", "erro");
    setEnviando(true);
    const pedido: PedidoFila = {
      client_id: r.client_id, cliente_id: r.cliente.id, cliente_nome: r.cliente.razao_social,
      itens, observacao: r.observacao, feito_em: new Date().toISOString(), estado: "pendente",
    };
    await salvarNaFila(pedido); // primeiro guarda no aparelho: nunca perde o pedido
    const res = await sincronizar(sb);
    await recarregarListas();
    setEnviando(false);
    const env = (await lerEnviados()).find((e) => e.client_id === pedido.client_id);
    const naFila = (await lerFila()).find((f) => f.client_id === pedido.client_id);
    if (naFila?.estado === "erro") {
      // servidor recusou (ex.: estoque acabou): volta para o pedido para corrigir
      avisar(naFila.erro ?? "O pedido não foi aceito.", "erro");
      await tirarDaFila(pedido.client_id);
      await recarregarListas();
      if (userId) try { setCat(await atualizarCatalogo(sb, userId)); } catch {}
      setTela("itens");
      return;
    }
    if (res.precisaLogin) setPrecisaLogin(true);
    setResultado(env ? { tipo: env.status === "aguardando_aprovacao" ? "aprovar" : "ok", numero: env.numero } : { tipo: "fila" });
    if (env && userId) buscarHoje(userId);
    setR(vazio());
    setTela("pronto");
  }

  async function corrigirDaFila(p: PedidoFila) {
    // volta um pedido com erro para a tela de itens
    const cliente = cat?.clientes.find((c) => c.id === p.cliente_id) ?? null;
    await tirarDaFila(p.client_id);
    await recarregarListas();
    setR({ client_id: p.client_id, cliente, itens: p.itens.map((i) => {
      const falta = p.faltas?.find((f) => f.produto_id === i.produto_id);
      return falta ? { ...i, quantidade: Math.min(i.quantidade, falta.disponivel) } : i;
    }).filter((i) => i.quantidade > 0), observacao: p.observacao });
    setTela("itens");
  }

  async function sair() {
    if (fila.length && !confirm(`Há ${fila.length} pedido(s) ainda não enviado(s). Eles continuam guardados neste celular. Sair mesmo?`)) return;
    await sb.auth.signOut();
    router.replace("/login");
  }

  /* ---------- telas ---------- */
  const voltar = () => setTela(tela === "revisar" ? "itens" : tela === "itens" ? (r.itens.length ? "inicio" : "cliente") : "inicio");

  const topo = (
    <header className="sticky top-0 z-30 bg-zinc-900 text-white">
      <div className="mx-auto flex max-w-xl items-center gap-2 px-4 py-3">
        {tela !== "inicio" && tela !== "pronto" ? (
          <button onClick={voltar} className="-ml-2 rounded-lg px-2 py-1 text-lg" aria-label="Voltar">←</button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-xl font-bold uppercase tracking-wide">
            {tela === "inicio" || tela === "pronto" ? "Pedidos" : tela === "cliente" ? "Escolha o cliente" : tela === "revisar" ? "Revisar pedido" : r.cliente?.razao_social}
          </div>
          {tela === "itens" && <button className="text-xs text-zinc-300 underline" onClick={() => { setBusca(""); setTela("cliente"); }}>trocar cliente</button>}
        </div>
        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${online ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/30 text-red-200"}`}>
          <span className={`size-2 rounded-full ${online ? "bg-emerald-400" : "bg-red-400"}`} />{online ? "Online" : "Sem internet"}
        </span>
      </div>
    </header>
  );

  if (!cat) return <>{topo}<p className="p-6 text-center text-zinc-500">Carregando…</p></>;

  return (
    <div className="min-h-full bg-zinc-100 pb-28 dark:bg-zinc-950">
      {topo}
      <div className="mx-auto max-w-xl px-4 pt-4">
        {precisaLogin && (
          <div className="mb-3 rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-500/20 dark:text-amber-100">
            Sua sessão expirou. Os pedidos continuam guardados. <button className="font-bold underline" onClick={() => router.push("/login")}>Entrar de novo</button> para enviar.
          </div>
        )}

        {/* ---------------- INÍCIO ---------------- */}
        {tela === "inicio" && (
          <div className="space-y-4">
            <button onClick={novoPedido} className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-marca-500 text-xl font-bold text-white shadow-lg active:bg-marca-600">
              + Novo pedido
            </button>
            {roteiros.length > 0 && faltamHoje.length > 0 && (
              <button onClick={() => { setRoteiroAberto(true); document.getElementById("meu-roteiro")?.scrollIntoView({ behavior: "smooth" }); }}
                className={`w-full rounded-2xl border-2 p-4 text-left ${tarde ? "border-red-500 bg-red-50 text-red-900 dark:bg-red-500/15 dark:text-red-100" : "border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-100"}`}>
                <div className="text-lg font-bold">{tarde ? "🚨" : "⚠️"} Ainda {faltamHoje.length === 1 ? "falta 1 cliente" : `faltam ${faltamHoje.length} clientes`} sem pedido hoje</div>
                <div className="mt-1 text-sm">{nomes(faltamHoje)}</div>
                <div className="mt-2 text-sm font-bold underline">Ver no roteiro →</div>
              </button>
            )}
            {roteiros.length > 0 && faltamHoje.length === 0 && (
              <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-4 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-100">
                <div className="text-lg font-bold">🎉 Todos os clientes do roteiro têm pedido hoje!</div>
              </div>
            )}
            {naoCompraramAntes.length > 0 && comPedidoServidor.anterior && alertaOntemVisto !== comPedidoServidor.anterior.dia && (
              <div className="rounded-2xl border-2 border-red-500 bg-red-50 p-4 text-red-900 dark:bg-red-500/15 dark:text-red-100">
                <div className="text-lg font-bold">❌ {new Date(comPedidoServidor.anterior.dia + "T12:00:00").getDay() === 6 && new Date().getDay() === 1 ? "No sábado" : "Ontem"} você não vendeu para {naoCompraramAntes.length === 1 ? "1 cliente" : `${naoCompraramAntes.length} clientes`}</div>
                <div className="mt-1 text-sm">{nomes(naoCompraramAntes)}</div>
                <div className="mt-1 text-sm">Capriche na visita a eles hoje.</div>
                <button className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white"
                  onClick={() => { const d = comPedidoServidor.anterior!.dia; setAlertaOntemVisto(d); try { localStorage.setItem("vender_alerta_ontem_visto", d); } catch {} }}>Entendi</button>
              </div>
            )}

            {(r.cliente || r.itens.length > 0) && (
              <button onClick={() => setTela(r.cliente ? "itens" : "cliente")} className="cartao flex w-full items-center justify-between p-4 text-left">
                <span><span className="block text-xs font-semibold uppercase text-marca-600">Pedido em andamento</span><span className="font-semibold">{r.cliente?.razao_social ?? "sem cliente"} · {r.itens.length} itens</span></span>
                <span className="font-bold">{fmtMoeda(total)} →</span>
              </button>
            )}

            {fila.length > 0 && (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="titulo text-lg">Guardados no celular ({fila.length})</h2>
                  {online && <button className="text-sm font-bold text-marca-600" onClick={enviarFila}>Enviar agora</button>}
                </div>
                <div className="cartao divide-y divide-zinc-100 dark:divide-zinc-800">
                  {fila.map((p) => (
                    <div key={p.client_id} className="p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{p.cliente_nome}</span>
                        <span className="font-semibold">{fmtMoeda(totalItens(p.itens))}</span>
                      </div>
                      {p.estado === "erro" ? (
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="text-sm text-red-600">{p.erro}</span>
                          <button className="shrink-0 rounded-lg bg-red-600 px-3 py-1 text-sm font-bold text-white" onClick={() => corrigirDaFila(p)}>Corrigir</button>
                        </div>
                      ) : (
                        <div className="text-sm text-zinc-500">⏳ Será enviado quando tiver internet · {fmtDataHora(p.feito_em)}</div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {roteiros.map(({ rota, clientes: lista }) => {
              const feitos = lista.filter((c) => comPedidoHoje.has(c.id)).length;
              const proximo = lista.find((c) => !comPedidoHoje.has(c.id));
              return (
                <section key={rota.id} id="meu-roteiro" className="scroll-mt-20">
                  <button className="mb-2 flex w-full items-baseline justify-between text-left" onClick={() => setRoteiroAberto((x) => !x)} aria-expanded={roteiroAberto}>
                    <h2 className="titulo text-lg">🗺️ Meu roteiro · {rota.nome}</h2>
                    <span className="text-sm font-semibold text-zinc-500">{feitos} de {lista.length} {roteiroAberto ? "▲" : "▼"}</span>
                  </button>
                  <div className="mb-2 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${(feitos / lista.length) * 100}%` }} /></div>
                  {roteiroAberto && (
                    <div className="cartao divide-y divide-zinc-100 dark:divide-zinc-800">
                      {lista.map((c, i) => {
                        const feito = comPedidoHoje.has(c.id);
                        const ehProximo = proximo?.id === c.id;
                        return (
                          <div key={c.id} className={`flex items-center gap-3 p-3 ${ehProximo ? "bg-marca-50 dark:bg-marca-500/10" : ""}`}>
                            <span className={`grid size-8 shrink-0 place-items-center rounded-lg font-display font-bold ${feito ? "bg-emerald-500 text-white" : ehProximo ? "bg-marca-500 text-white" : "bg-zinc-200 dark:bg-zinc-800"}`}>{feito ? "✓" : i + 1}</span>
                            <div className="min-w-0 flex-1">
                              <div className={`truncate font-semibold ${feito ? "text-zinc-400 line-through" : ""}`}>{c.razao_social}</div>
                              <div className="truncate text-xs text-zinc-500">{ehProximo && <b className="text-marca-600">PRÓXIMO · </b>}{[c.endereco && `${c.endereco}${c.numero ? ", " + c.numero : ""}`, c.bairro].filter(Boolean).join(" · ")}</div>
                            </div>
                            {!feito && <button className="shrink-0 rounded-lg bg-marca-500 px-3 py-2 text-sm font-bold text-white" onClick={() => pedidoPara(c)}>Pedido</button>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              );
            })}

            <section>
              <h2 className="titulo mb-2 text-lg">Meus pedidos de hoje</h2>
              {(() => {
                const lista = hojeServidor ?? enviados.filter((e) => e.feito_em.slice(0, 10) === hojeISO()).map((e) => ({ numero: e.numero, status: e.status as StatusPedido, total: e.total, feito_em: e.feito_em, clientes: { razao_social: e.cliente_nome } }));
                if (!lista.length) return <p className="cartao p-4 text-center text-zinc-500">Nenhum pedido enviado hoje.</p>;
                const soma = lista.filter((p) => !["cancelado", "recusado"].includes(p.status)).reduce((s, p) => s + Number(p.total), 0);
                return (
                  <>
                    <p className="mb-2 text-sm text-zinc-500">{lista.length} pedido(s) · {fmtMoeda(soma)}</p>
                    <div className="cartao divide-y divide-zinc-100 dark:divide-zinc-800">
                      {lista.map((p) => (
                        <div key={p.numero} className="flex items-center justify-between gap-2 p-3">
                          <div className="min-w-0"><div className="truncate font-semibold">{p.clientes.razao_social}</div><div className="text-xs text-zinc-500">Nº {p.numero} · {fmtDataHora(p.feito_em)}</div></div>
                          <div className="text-right"><div className="font-semibold">{fmtMoeda(p.total)}</div><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_PEDIDO[p.status]?.cor ?? ""}`}>{STATUS_PEDIDO[p.status]?.nome ?? p.status}</span></div>
                        </div>
                      ))}
                    </div>
                  </>
                );
              })()}
            </section>

            <div className="flex items-center justify-between pt-2 text-xs text-zinc-500">
              <span>{perfil?.nome} · catálogo de {cat.atualizado_em ? fmtDataHora(cat.atualizado_em) : "—"}</span>
              <span className="flex gap-3">
                {online && userId && <button className="underline" onClick={async () => { try { setCat(await atualizarCatalogo(sb, userId)); avisar("Catálogo atualizado"); } catch { avisar("Não deu para atualizar", "erro"); } }}>Atualizar</button>}
                {perfil && (perfil.admin || perfil.permissoes.length > 1) && <button className="underline" onClick={() => router.push("/painel")}>Painel</button>}
                <button className="underline" onClick={sair}>Sair</button>
              </span>
            </div>
          </div>
        )}

        {/* ---------------- CLIENTE ---------------- */}
        {tela === "cliente" && (
          <div className="space-y-3">
            <input ref={buscaRef} className="campo h-12 text-base" placeholder="Nome, fantasia, bairro ou código…" value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
            <div className="cartao divide-y divide-zinc-100 dark:divide-zinc-800">
              {clientesFiltrados.length === 0 && <p className="p-4 text-center text-zinc-500">Nenhum cliente encontrado.</p>}
              {clientesFiltrados.map((c) => (
                <button key={c.id} onClick={() => escolherCliente(c)} className="block w-full p-3 text-left active:bg-zinc-50 dark:active:bg-zinc-800">
                  <div className="font-semibold">{c.razao_social}{c.vendedor_id === userId && <span className="ml-1 text-xs text-marca-600">★</span>}</div>
                  <div className="text-sm text-zinc-500">{[c.nome_fantasia, c.bairro, c.cidade].filter(Boolean).join(" · ")}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ---------------- ITENS ---------------- */}
        {tela === "itens" && (
          <div className="space-y-3">
            <div className="sticky top-[68px] z-20 -mx-4 bg-zinc-100 px-4 pb-2 pt-1 dark:bg-zinc-950">
              <input ref={buscaRef} className="campo h-12 text-base" placeholder="🔍 Pesquisar produto (ex.: skol lata)" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </div>

            {busca.trim() ? (
              <div className="cartao divide-y divide-zinc-100 dark:divide-zinc-800">
                {produtosFiltrados.length === 0 && <p className="p-4 text-center text-zinc-500">Nenhum produto encontrado.</p>}
                {produtosFiltrados.map((p) => {
                  const disp = disponivel(p);
                  const no = r.itens.find((i) => i.produto_id === p.id);
                  return (
                    <button key={p.id} disabled={disp <= 0} onClick={() => adicionar(p)} className="flex w-full items-center gap-3 p-3 text-left active:bg-zinc-50 disabled:opacity-50 dark:active:bg-zinc-800">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{p.nome}</div>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-semibold text-zinc-700 dark:text-zinc-300">{fmtMoeda(p.preco)}/{p.unidade}</span>
                          <SeloEstoque disp={disp} minimo={Number(p.estoque_minimo)} />
                        </div>
                      </div>
                      {no ? <span className="rounded-full bg-marca-500 px-2.5 py-1 text-sm font-bold text-white">{fmtQtd(no.quantidade)}</span>
                        : <span className="grid size-9 place-items-center rounded-full bg-marca-100 text-xl font-bold text-marca-700 dark:bg-marca-500/20">+</span>}
                    </button>
                  );
                })}
              </div>
            ) : r.itens.length === 0 ? (
              <p className="cartao p-6 text-center text-zinc-500">Pesquise e toque no produto para adicionar.</p>
            ) : (
              <div className="space-y-2">
                {[...r.itens].sort((a, b) => {
                  const pa = cat.produtos.find((p) => p.id === a.produto_id), pb = cat.produtos.find((p) => p.id === b.produto_id);
                  return (ordemCat[pa?.categoria_id ?? ""] ?? 999) - (ordemCat[pb?.categoria_id ?? ""] ?? 999) || alfa(a.nome, b.nome);
                }).map((i) => {
                  const p = cat.produtos.find((x) => x.id === i.produto_id);
                  const disp = p ? disponivel(p) : i.quantidade;
                  const unit = Math.round(i.preco * (1 - i.desconto_pct / 100) * 100) / 100;
                  return (
                    <div key={i.produto_id} className="cartao p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 font-semibold">{i.nome}</div>
                        <button className="-mr-1 -mt-1 rounded-lg px-2 py-1 text-zinc-400" onClick={() => tirarItem(i.produto_id)} aria-label="Remover">✕</button>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div>
                          <Passo valor={i.quantidade} meia={i.permite_meia} max={disp} aoMudar={(n) => mudarItem(i.produto_id, { quantidade: n })} />
                          <div className="mt-1 text-xs text-zinc-500">
                            {UNIDADES[i.unidade as keyof typeof UNIDADES]?.nome ?? i.unidade}{i.permite_meia ? " (aceita ½)" : ""} · máx. {fmtQtd(disp)}
                          </div>
                        </div>
                        <div className="text-right">
                          <label className="flex items-center justify-end gap-1 text-sm text-zinc-500">
                            Desc.
                            <input className={`h-9 w-14 rounded-lg border px-1 text-center font-semibold ${i.desconto_pct > descMax ? "border-amber-500 bg-amber-50 text-amber-800 dark:bg-amber-500/10" : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900"}`}
                              inputMode="decimal" value={i.desconto_pct || ""} placeholder="0"
                              onChange={(e) => { const n = Math.min(100, Math.max(0, Number(e.target.value.replace(",", ".")) || 0)); mudarItem(i.produto_id, { desconto_pct: n }); }} />%
                          </label>
                          <div className="mt-1 text-sm">{fmtMoeda(unit)} × {fmtQtd(i.quantidade)}</div>
                          <div className="text-lg font-bold">{fmtMoeda(unit * i.quantidade)}</div>
                        </div>
                      </div>
                      {i.quantidade === 0 && <div className="mt-1 text-xs font-semibold text-red-600">Sem quantidade: não vai no pedido</div>}
                    </div>
                  );
                })}
                {precisaAprovar && <p className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-500/20 dark:text-amber-100">Desconto acima de {fmtQtd(descMax)}%: o pedido vai precisar de aprovação do escritório.</p>}
              </div>
            )}
          </div>
        )}

        {/* ---------------- REVISAR ---------------- */}
        {tela === "revisar" && r.cliente && (
          <div className="space-y-3">
            <div className="cartao p-4">
              <div className="text-xs font-semibold uppercase text-zinc-500">Cliente</div>
              <div className="text-lg font-bold">{r.cliente.razao_social}</div>
              <div className="text-sm text-zinc-500">{[r.cliente.endereco, r.cliente.bairro, r.cliente.cidade].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="cartao divide-y divide-zinc-100 dark:divide-zinc-800">
              {r.itens.filter((i) => i.quantidade > 0).map((i) => {
                const unit = Math.round(i.preco * (1 - i.desconto_pct / 100) * 100) / 100;
                return (
                  <div key={i.produto_id} className="flex items-center justify-between gap-2 p-3">
                    <div className="min-w-0"><span className="font-bold">{fmtQtd(i.quantidade)} {i.unidade}</span> · {i.nome}{i.desconto_pct > 0 && <span className={`ml-1 text-xs font-bold ${i.desconto_pct > descMax ? "text-amber-600" : "text-zinc-500"}`}>−{fmtQtd(i.desconto_pct)}%</span>}</div>
                    <div className="font-semibold">{fmtMoeda(unit * i.quantidade)}</div>
                  </div>
                );
              })}
            </div>
            <div className="cartao p-4">
              <label className="rotulo">Observação</label>
              <textarea className="campo min-h-20" placeholder="Ex.: entregar depois das 14h" value={r.observacao} onChange={(e) => setR((x) => ({ ...x, observacao: e.target.value }))} />
            </div>
            {precisaAprovar && <p className="rounded-xl bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-500/20 dark:text-amber-100">Este pedido tem desconto acima do seu limite ({fmtQtd(descMax)}%). Ele vai chegar como “aguardando aprovação”.</p>}
            {!online && <p className="rounded-xl bg-zinc-200 p-3 text-sm dark:bg-zinc-800">Sem internet agora: o pedido fica guardado no celular e é enviado sozinho quando a internet voltar.</p>}
          </div>
        )}

        {/* ---------------- PRONTO ---------------- */}
        {tela === "pronto" && resultado && (
          <div className="space-y-4 pt-8 text-center">
            <div className="text-6xl">{resultado.tipo === "fila" ? "📲" : resultado.tipo === "aprovar" ? "⏳" : "✅"}</div>
            <h2 className="titulo text-2xl">
              {resultado.tipo === "ok" && `Pedido nº ${resultado.numero} enviado`}
              {resultado.tipo === "aprovar" && `Pedido nº ${resultado.numero} aguardando aprovação`}
              {resultado.tipo === "fila" && "Pedido guardado no celular"}
            </h2>
            <p className="text-zinc-500">
              {resultado.tipo === "fila" ? "Assim que tiver internet ele é enviado sozinho. Pode continuar trabalhando." : resultado.tipo === "aprovar" ? "O escritório vai revisar o desconto." : "O escritório já recebeu."}
            </p>
            <button onClick={novoPedido} className="h-14 w-full rounded-2xl bg-marca-500 text-lg font-bold text-white">+ Novo pedido</button>
            <button onClick={() => setTela("inicio")} className="h-12 w-full rounded-2xl border border-zinc-300 font-semibold dark:border-zinc-700">Voltar ao início</button>
          </div>
        )}
      </div>

      {/* barra de baixo */}
      {(tela === "itens" || tela === "revisar") && r.itens.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3">
            <div className="flex-1">
              <div className="text-xs text-zinc-500">{r.itens.filter((i) => i.quantidade > 0).length} produtos · {fmtQtd(r.itens.reduce((s, i) => s + i.quantidade, 0))} itens</div>
              <div className="text-2xl font-bold">{fmtMoeda(total)}</div>
            </div>
            {tela === "itens" ? (
              <button onClick={() => { setBusca(""); setTela("revisar"); }} className="h-12 rounded-xl bg-marca-500 px-6 text-lg font-bold text-white">Revisar →</button>
            ) : (
              <button onClick={enviar} disabled={enviando} className="h-12 rounded-xl bg-emerald-600 px-6 text-lg font-bold text-white disabled:opacity-60">{enviando ? "Enviando…" : "Enviar pedido"}</button>
            )}
          </div>
        </div>
      )}
      <Avisos />
    </div>
  );
}
