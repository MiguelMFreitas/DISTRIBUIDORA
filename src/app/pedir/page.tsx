"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { combina, erroMsg, fmtMoeda, fmtQtd } from "@/lib/formato";

/* Página pública: o cliente abre pelo link, escolhe os produtos e finaliza. Sem login. */

type Prod = { id: string; nome: string; unidade: string; permite_meia: boolean; preco: number; categoria: string | null; ordem: number; esgotado: boolean };
type Catalogo = { ligado: boolean; aviso: string | null; produtos: Prod[] };
type Dados = { nome: string; telefone: string; endereco: string; bairro: string; referencia: string };

const EMPRESA = process.env.NEXT_PUBLIC_EMPRESA_NOME || "Distribuidora";
const UN: Record<string, string> = { CX: "caixa", FD: "fardo", LT: "litro", UN: "unidade" };
const VAZIO: Dados = { nome: "", telefone: "", endereco: "", bairro: "", referencia: "" };
const novoId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID()
  : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16)));
const lerDados = (): Dados => { try { return { ...VAZIO, ...JSON.parse(localStorage.getItem("pedir_dados") ?? "{}") }; } catch { return VAZIO; } };
const numero = (t: string) => { const n = Number(t.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };

export default function Pedir() {
  const sb = supabaseNavegador();
  const [cat, setCat] = useState<Catalogo | null>(null);
  const [erroCat, setErroCat] = useState("");
  const [qtd, setQtd] = useState<Record<string, number>>({});
  const [busca, setBusca] = useState("");
  const [etapa, setEtapa] = useState<"produtos" | "dados" | "pronto">("produtos");
  const [dados, setDados] = useState<Dados>(VAZIO);
  const [pagamento, setPagamento] = useState<"dinheiro" | "pix" | null>(null);
  const [precisaTroco, setPrecisaTroco] = useState<boolean | null>(null);
  const [trocoPara, setTrocoPara] = useState("");
  const [obs, setObs] = useState("");
  const [clientId, setClientId] = useState(novoId);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState<{ numero: number; total: number } | null>(null);

  async function carregar() {
    const { data, error } = await sb.rpc("loja_catalogo");
    if (error) return setErroCat("Não foi possível abrir a lista de produtos. Verifique a internet e tente de novo.");
    setCat(data as Catalogo);
  }
  useEffect(() => { carregar(); setDados(lerDados()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ao mexer nos dados, some o aviso de "Falta: ..."
  useEffect(() => { setErro(""); }, [dados, pagamento, precisaTroco, trocoPara]);

  const produtos = cat?.produtos ?? [];
  const filtrados = useMemo(() => produtos.filter((p) => !busca.trim() || combina(`${p.nome} ${p.categoria ?? ""}`, busca)), [produtos, busca]);
  const grupos = useMemo(() => {
    const g: { nome: string; itens: Prod[] }[] = [];
    filtrados.forEach((p) => { const n = p.categoria ?? "Outros"; const x = g.find((y) => y.nome === n); if (x) x.itens.push(p); else g.push({ nome: n, itens: [p] }); });
    return g;
  }, [filtrados]);
  const itens = produtos.filter((p) => (qtd[p.id] ?? 0) > 0);
  const total = itens.reduce((s, p) => s + Math.round(p.preco * qtd[p.id] * 100) / 100, 0);
  const qtdTotal = itens.reduce((s, p) => s + qtd[p.id], 0);
  const mudar = (p: Prod, n: number) => setQtd((q) => ({ ...q, [p.id]: Math.max(0, Math.min(999, n)) }));

  const tel = dados.telefone.replace(/\D/g, "");
  const troco = numero(trocoPara);
  const faltando = [
    dados.nome.trim().length < 2 && "seu nome",
    (tel.length < 10 || tel.length > 13) && "telefone com DDD",
    dados.endereco.trim().length < 5 && "endereço com número",
    dados.bairro.trim().length < 2 && "bairro",
    !pagamento && "forma de pagamento",
    pagamento === "dinheiro" && precisaTroco === null && "se precisa de troco",
    pagamento === "dinheiro" && precisaTroco && troco <= total && "troco para quanto (maior que o total)",
  ].filter(Boolean) as string[];

  async function finalizar() {
    if (faltando.length) return setErro("Falta: " + faltando.join(", ") + ".");
    setEnviando(true); setErro("");
    try { localStorage.setItem("pedir_dados", JSON.stringify(dados)); } catch {}
    const { data, error } = await sb.rpc("loja_pedido", {
      p_client_id: clientId, p_nome: dados.nome, p_telefone: dados.telefone, p_endereco: dados.endereco, p_bairro: dados.bairro,
      p_referencia: dados.referencia || null, p_pagamento: pagamento, p_troco_para: pagamento === "dinheiro" && precisaTroco ? troco : null,
      p_observacao: obs || null, p_itens: itens.map((p) => ({ produto_id: p.id, quantidade: qtd[p.id] })),
    });
    setEnviando(false);
    if (error) {
      setErro(erroMsg(error));
      if (/estoque|disponível/i.test(error.message)) carregar();
      return;
    }
    setFeito(data as { numero: number; total: number });
    setEtapa("pronto");
    window.scrollTo(0, 0);
  }

  function outroPedido() {
    setQtd({}); setObs(""); setPagamento(null); setPrecisaTroco(null); setTrocoPara(""); setErro(""); setFeito(null);
    setClientId(novoId()); setEtapa("produtos"); carregar();
  }

  const campo = "h-12 w-full rounded-xl border border-zinc-300 bg-white px-3 text-base outline-none focus:border-marca-500 focus:ring-2 focus:ring-marca-500/30 dark:border-zinc-700 dark:bg-zinc-900";
  const opcao = (ativo: boolean) => `h-14 rounded-xl border-2 text-lg font-bold ${ativo ? "border-marca-500 bg-marca-50 text-marca-900 dark:bg-marca-500/15 dark:text-marca-100" : "border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900"}`;

  return (
    <div className="min-h-dvh bg-zinc-100 pb-28 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="bg-zinc-900 px-4 pb-4 pt-5 text-white">
        <div className="mx-auto max-w-xl">
          <h1 className="font-display text-2xl font-bold uppercase tracking-wide">{EMPRESA}</h1>
          <p className="text-sm text-zinc-300">{cat?.aviso || "Faça seu pedido pelo celular."}</p>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 pt-4">
        {erroCat && <div className="rounded-xl bg-red-100 p-4 text-red-900">{erroCat} <button className="font-bold underline" onClick={() => { setErroCat(""); carregar(); }}>Tentar de novo</button></div>}
        {!cat && !erroCat && <p className="p-8 text-center text-zinc-500">Carregando produtos…</p>}
        {cat && !cat.ligado && etapa !== "pronto" && <div className="rounded-xl bg-white p-6 text-center shadow-sm dark:bg-zinc-900"><div className="text-4xl">⏸️</div><p className="mt-2 text-lg font-semibold">Os pedidos pelo link estão fechados agora.</p><p className="text-zinc-500">Tente mais tarde ou fale com a gente.</p></div>}

        {/* ---------- 1. produtos ---------- */}
        {cat?.ligado && etapa === "produtos" && (
          <>
            <input className={`${campo} mb-3`} placeholder="🔍 Procurar produto…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Procurar produto" />
            {grupos.length === 0 && <p className="p-6 text-center text-zinc-500">Nenhum produto encontrado.</p>}
            {grupos.map((g) => (
              <section key={g.nome} className="mb-4">
                <h2 className="mb-1.5 px-1 font-display text-lg font-bold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">{g.nome}</h2>
                <div className="divide-y divide-zinc-100 overflow-hidden rounded-2xl bg-white shadow-sm dark:divide-zinc-800 dark:bg-zinc-900">
                  {g.itens.map((p) => {
                    const n = qtd[p.id] ?? 0;
                    return (
                      <div key={p.id} className={`flex items-center gap-3 p-3 ${p.esgotado ? "opacity-50" : ""}`}>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold leading-tight">{p.nome}</div>
                          <div className="text-sm text-zinc-500"><b className="text-zinc-900 dark:text-zinc-100">{fmtMoeda(p.preco)}</b> / {UN[p.unidade] ?? p.unidade}</div>
                        </div>
                        {p.esgotado ? <span className="rounded-full bg-zinc-200 px-3 py-1 text-sm font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">Esgotado</span>
                          : n === 0 ? <button onClick={() => mudar(p, 1)} className="h-11 rounded-xl bg-marca-500 px-5 font-bold text-white" aria-label={`Adicionar ${p.nome}`}>+ Pôr</button>
                          : (
                            <div className="flex items-center overflow-hidden rounded-xl border border-zinc-300 dark:border-zinc-700">
                              <button onClick={() => mudar(p, n - 1)} className="h-11 w-11 text-2xl font-bold" aria-label={`Tirar um ${p.nome}`}>−</button>
                              <span className="w-10 text-center text-lg font-bold" aria-label={`Quantidade de ${p.nome}`}>{fmtQtd(n)}</span>
                              <button onClick={() => mudar(p, n + 1)} className="h-11 w-11 text-2xl font-bold text-marca-600" aria-label={`Mais um ${p.nome}`}>+</button>
                            </div>
                          )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </>
        )}

        {/* ---------- 2. dados e pagamento ---------- */}
        {cat?.ligado && etapa === "dados" && (
          <div className="space-y-4">
            <button onClick={() => setEtapa("produtos")} className="font-semibold text-marca-600">← Voltar aos produtos</button>
            <section className="rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900">
              <h2 className="mb-2 font-display text-lg font-bold uppercase">Seu pedido</h2>
              {itens.map((p) => (
                <div key={p.id} className="flex justify-between gap-2 border-b border-zinc-100 py-1.5 last:border-0 dark:border-zinc-800">
                  <span><b>{fmtQtd(qtd[p.id])}×</b> {p.nome}</span><span className="font-semibold">{fmtMoeda(p.preco * qtd[p.id])}</span>
                </div>
              ))}
              <div className="mt-2 flex justify-between text-xl font-bold"><span>Total</span><span>{fmtMoeda(total)}</span></div>
            </section>

            <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900">
              <h2 className="font-display text-lg font-bold uppercase">Entrega</h2>
              <label className="block"><span className="text-sm font-semibold">Nome</span><input className={campo} autoComplete="name" value={dados.nome} onChange={(e) => setDados({ ...dados, nome: e.target.value })} /></label>
              <label className="block"><span className="text-sm font-semibold">Telefone (WhatsApp) com DDD</span><input className={campo} type="tel" inputMode="tel" autoComplete="tel" placeholder="(85) 99999-9999" value={dados.telefone} onChange={(e) => setDados({ ...dados, telefone: e.target.value })} /></label>
              <label className="block"><span className="text-sm font-semibold">Endereço (rua e número)</span><input className={campo} autoComplete="street-address" value={dados.endereco} onChange={(e) => setDados({ ...dados, endereco: e.target.value })} /></label>
              <label className="block"><span className="text-sm font-semibold">Bairro</span><input className={campo} value={dados.bairro} onChange={(e) => setDados({ ...dados, bairro: e.target.value })} /></label>
              <label className="block"><span className="text-sm font-semibold">Ponto de referência <span className="font-normal text-zinc-500">(opcional)</span></span><input className={campo} value={dados.referencia} onChange={(e) => setDados({ ...dados, referencia: e.target.value })} /></label>
              <label className="block"><span className="text-sm font-semibold">Observação <span className="font-normal text-zinc-500">(opcional)</span></span><textarea className={`${campo} h-20 py-2`} value={obs} onChange={(e) => setObs(e.target.value)} /></label>
            </section>

            <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm dark:bg-zinc-900">
              <h2 className="font-display text-lg font-bold uppercase">Pagamento na entrega</h2>
              <div className="grid grid-cols-2 gap-2">
                <button className={opcao(pagamento === "dinheiro")} onClick={() => setPagamento("dinheiro")}>💵 Dinheiro</button>
                <button className={opcao(pagamento === "pix")} onClick={() => { setPagamento("pix"); setPrecisaTroco(null); }}>📱 Pix</button>
              </div>
              {pagamento === "dinheiro" && (
                <>
                  <p className="font-semibold">Precisa de troco?</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button className={opcao(precisaTroco === false)} onClick={() => setPrecisaTroco(false)}>Não</button>
                    <button className={opcao(precisaTroco === true)} onClick={() => setPrecisaTroco(true)}>Sim</button>
                  </div>
                  {precisaTroco && (
                    <label className="block"><span className="text-sm font-semibold">Troco para quanto?</span>
                      <input className={campo} inputMode="decimal" placeholder="Ex.: 100" value={trocoPara} onChange={(e) => setTrocoPara(e.target.value)} />
                      {troco > total && <span className="text-sm text-zinc-500">Seu troco: <b>{fmtMoeda(troco - total)}</b></span>}
                      {trocoPara && troco <= total && <span className="text-sm font-semibold text-red-600">Tem que ser mais que {fmtMoeda(total)}</span>}
                    </label>
                  )}
                </>
              )}
              {pagamento === "pix" && <p className="text-sm text-zinc-500">A chave Pix vai com o entregador ou a gente manda pelo WhatsApp.</p>}
              <p className="text-xs text-zinc-500">Não aceitamos cartão.</p>
            </section>
            {erro && <p className="rounded-xl bg-red-100 p-3 font-semibold text-red-900 dark:bg-red-500/20 dark:text-red-100">{erro}</p>}
          </div>
        )}

        {/* ---------- 3. pronto ---------- */}
        {etapa === "pronto" && feito && (
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm dark:bg-zinc-900">
            <div className="text-5xl">✅</div>
            <h2 className="mt-2 font-display text-2xl font-bold uppercase">Pedido nº {feito.numero} recebido!</h2>
            <p className="mt-1 text-lg">Total: <b>{fmtMoeda(feito.total)}</b> · {pagamento === "pix" ? "Pix" : precisaTroco ? `Dinheiro, troco para ${fmtMoeda(troco)}` : "Dinheiro, sem troco"}</p>
            <p className="mt-2 text-zinc-500">Já estamos separando. Se precisar, a gente liga no {dados.telefone}.</p>
            <button onClick={outroPedido} className="mt-5 h-12 rounded-xl border border-zinc-300 px-6 font-semibold dark:border-zinc-700">Fazer outro pedido</button>
          </div>
        )}
      </main>

      {/* barra de baixo */}
      {cat?.ligado && etapa !== "pronto" && itens.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 border-t border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
          <div className="mx-auto flex max-w-xl items-center justify-between gap-3">
            <div><div className="text-sm text-zinc-500">{itens.length} produto(s) · {fmtQtd(qtdTotal)} itens</div><div className="font-display text-2xl font-bold">{fmtMoeda(total)}</div></div>
            {etapa === "produtos"
              ? <button onClick={() => { setEtapa("dados"); setErro(""); window.scrollTo(0, 0); }} className="h-12 rounded-xl bg-marca-500 px-6 text-lg font-bold text-white">Continuar →</button>
              : <button onClick={finalizar} disabled={enviando} className="h-12 rounded-xl bg-emerald-600 px-6 text-lg font-bold text-white disabled:opacity-60">{enviando ? "Enviando…" : "Finalizar pedido"}</button>}
          </div>
        </div>
      )}
    </div>
  );
}
