"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { combina, erroMsg, fmtMoeda, fmtPeso, fmtQtd } from "@/lib/formato";
import type { Cliente, Perfil, Produto } from "@/lib/tipos";
import { Botao, Cabecalho, avisar } from "@/components/ui";
import { BuscaProduto } from "@/components/busca-produto";
import { usePerfil } from "@/components/perfil-contexto";
import { abrirImpressaoPedidos } from "@/lib/impressao";

type Linha = { p: Produto; qtd: number; desc: number };
const novoId = () => crypto.randomUUID();
const unit = (l: Linha) => Math.round(l.p.preco * (1 - l.desc / 100) * 100) / 100;

function BuscaCliente({ clientes, aoEscolher }: { clientes: Cliente[]; aoEscolher: (c: Cliente) => void }) {
  const [q, setQ] = useState("");
  const [aberto, setAberto] = useState(false);
  const [i, setI] = useState(0);
  const res = useMemo(() => (q.trim() ? clientes.filter((c) => combina(`${c.razao_social} ${c.nome_fantasia ?? ""} ${c.codigo ?? ""} ${c.bairro ?? ""} ${c.cpf_cnpj ?? ""}`, q)).slice(0, 12) : []), [q, clientes]);
  const escolher = (c: Cliente) => { aoEscolher(c); setQ(""); };
  return (
    <div className="relative">
      <input className="campo" autoFocus placeholder="Pesquisar cliente: nome, fantasia, código, bairro…" value={q}
        onChange={(e) => { setQ(e.target.value); setAberto(true); setI(0); }} onFocus={() => setAberto(true)} onBlur={() => setTimeout(() => setAberto(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setI(Math.min(i + 1, res.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setI(Math.max(i - 1, 0)); }
          if (e.key === "Enter" && res[i]) { e.preventDefault(); escolher(res[i]); }
        }} />
      {aberto && res.length > 0 && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {res.map((c, k) => (
            <button key={c.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(c)}
              className={`block w-full border-b border-zinc-100 px-3 py-2 text-left last:border-0 dark:border-zinc-800 ${k === i ? "bg-marca-100 dark:bg-marca-500/20" : ""}`}>
              <span className="font-medium">{c.razao_social}</span>
              <span className="block text-sm text-zinc-500">{[c.nome_fantasia, c.bairro, c.cidade].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NovoPedido() {
  const sb = supabaseNavegador();
  const eu = usePerfil();
  const podeVer = eu.admin || eu.permissoes.includes("pedidos_ver_todos");
  const podeFazer = podeVer || eu.permissoes.includes("pedidos_criar");
  const descMax = eu.admin ? 100 : Number(eu.desconto_max);

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [vendedores, setVendedores] = useState<Perfil[]>([]);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [vendedor, setVendedor] = useState(eu.id);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [obs, setObs] = useState("");
  const [clientId, setClientId] = useState(novoId);
  const [salvando, setSalvando] = useState(false);
  const [ultimo, setUltimo] = useState<{ id: string; numero: number; status: string } | null>(null);

  const carregar = useCallback(async () => {
    const [{ data: c }, { data: p }, { data: v }] = await Promise.all([
      sb.from("clientes").select("*").eq("ativo", true).order("razao_social"),
      sb.from("produtos").select("*").eq("ativo", true).order("nome"),
      sb.from("perfis").select("*").eq("ativo", true).order("nome"),
    ]);
    setClientes((c ?? []) as Cliente[]);
    setProdutos((p ?? []) as Produto[]);
    setVendedores(((v ?? []) as Perfil[]).filter((x) => x.admin || x.permissoes.includes("pedidos_criar") || x.id === eu.id));
  }, [sb, eu.id]);
  useEffect(() => { carregar(); }, [carregar]);

  // cliente escolhido: o pedido é do vendedor dono do cliente
  function escolherCliente(c: Cliente) {
    setCliente(c);
    if (c.vendedor_id) setVendedor(c.vendedor_id);
    else if (!podeVer) return avisar("Este cliente não tem vendedor. Defina o vendedor no cadastro de Clientes.", "erro");
  }
  const donoFixo = !!cliente?.vendedor_id;

  function adicionar(p: Produto) {
    if (p.estoque <= 0) return avisar(`${p.nome} está sem estoque.`, "erro");
    setLinhas((l) => (l.some((x) => x.p.id === p.id) ? l.map((x) => (x.p.id === p.id ? { ...x, qtd: Math.min(p.estoque, x.qtd + 1) } : x)) : [...l, { p, qtd: 1, desc: 0 }]));
    if (p.estoque <= p.estoque_minimo) avisar(`Atenção: só tem ${fmtQtd(p.estoque)} de ${p.nome}`);
  }
  const mudar = (id: string, campos: Partial<Linha>) => setLinhas((l) => l.map((x) => (x.p.id === id ? { ...x, ...campos } : x)));

  function ajustarQtd(l: Linha, texto: string) {
    let n = Number(texto.replace(",", ".")) || 0;
    n = l.p.permite_meia ? Math.round(n * 2) / 2 : Math.round(n);
    mudar(l.p.id, { qtd: Math.max(0, Math.min(l.p.estoque, n)) });
  }

  const validas = linhas.filter((l) => l.qtd > 0);
  const total = validas.reduce((s, l) => s + unit(l) * l.qtd, 0);
  const peso = validas.reduce((s, l) => s + l.p.peso_kg * l.qtd, 0);
  const acima = validas.some((l) => l.desc > descMax);

  async function salvar(imprimir: boolean) {
    if (!cliente) return avisar("Escolha o cliente.", "erro");
    if (!validas.length) return avisar("Adicione pelo menos um produto com quantidade.", "erro");
    setSalvando(true);
    const { data, error } = await sb.rpc("criar_pedido", {
      p_client_id: clientId, p_cliente_id: cliente.id,
      p_itens: validas.map((l) => ({ produto_id: l.p.id, quantidade: l.qtd, desconto_pct: l.desc })),
      p_observacao: obs || null, p_feito_em: null, p_vendedor_id: donoFixo ? cliente!.vendedor_id : vendedor === eu.id ? null : vendedor,
    });
    setSalvando(false);
    if (error) {
      if (error.message === "ESTOQUE_INSUFICIENTE") {
        let faltas: { produto: string; disponivel: number }[] = [];
        try { faltas = JSON.parse(error.details ?? "[]"); } catch {}
        avisar("Faltou estoque: " + faltas.map((f) => `${f.produto} (tem ${fmtQtd(f.disponivel)})`).join(", "), "erro");
        carregar();
      } else avisar(erroMsg(error), "erro");
      return;
    }
    const r = data as { id: string; numero: number; status: string };
    setUltimo(r);
    avisar(r.status === "aguardando_aprovacao" ? `Pedido nº ${r.numero} salvo, aguardando aprovação` : `Pedido nº ${r.numero} salvo`);
    if (imprimir) abrirImpressaoPedidos([r.id]);
    setCliente(null); setLinhas([]); setObs(""); setVendedor(eu.id); setClientId(novoId());
    carregar();
  }

  if (!podeFazer) return <div className="cartao p-8 text-center"><p className="titulo">Sem acesso</p><p className="text-zinc-500">Você não tem permissão para fazer pedidos.</p></div>;

  return (
    <>
      <Cabecalho titulo="Novo pedido" sub="Para pedidos que chegam por telefone, WhatsApp ou no balcão.">
        <Link href="/pedidos"><Botao variante="secundario">← Pedidos</Botao></Link>
      </Cabecalho>

      {ultimo && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 p-3 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200">
          <span className="font-semibold">Pedido nº {ultimo.numero} salvo{ultimo.status === "aguardando_aprovacao" ? " (aguardando aprovação)" : ""}.</span>
          <Botao variante="secundario" tamanho="p" onClick={() => abrirImpressaoPedidos([ultimo.id])}>🖨 Imprimir este pedido</Botao>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <section className="cartao space-y-3 p-4">
            <h2 className="titulo text-lg">Cliente</h2>
            {cliente ? (
              <div className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-marca-50 p-3 dark:bg-marca-500/10">
                <div>
                  <div className="font-bold">{cliente.razao_social}</div>
                  <div className="text-sm text-zinc-500">{[cliente.nome_fantasia, cliente.endereco && `${cliente.endereco}${cliente.numero ? ", " + cliente.numero : ""}`, cliente.bairro, cliente.cidade, cliente.telefone].filter(Boolean).join(" · ")}</div>
                </div>
                <Botao variante="secundario" tamanho="p" onClick={() => setCliente(null)}>Trocar</Botao>
              </div>
            ) : <BuscaCliente clientes={clientes} aoEscolher={escolherCliente} />}
            {podeVer && (
              <div className="max-w-sm">
                <label className="rotulo" htmlFor="vend">Vendedor do pedido</label>
                <select id="vend" className="campo" value={vendedor} onChange={(e) => setVendedor(e.target.value)} disabled={donoFixo}>
                  {vendedores.map((v) => <option key={v.id} value={v.id}>{v.id === eu.id ? `${v.nome} (eu)` : v.nome}</option>)}
                </select>
                <p className="mt-1 text-xs text-zinc-500">{donoFixo ? "É o vendedor dono deste cliente (cadastro de Clientes). O pedido conta para ele." : "Este cliente não tem vendedor: defina no cadastro de Clientes."}</p>
              </div>
            )}
          </section>

          <section className="cartao space-y-3 p-4">
            <h2 className="titulo text-lg">Produtos</h2>
            <BuscaProduto produtos={produtos} aoEscolher={adicionar} placeholder="Pesquisar produto pelo nome ou código e apertar Enter…" />
            {linhas.length === 0 ? <p className="text-sm text-zinc-500">Nenhum produto ainda.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[15px]">
                  <thead className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                    <tr><th className="py-2">Produto</th><th className="py-2 text-right">Qtd</th><th className="py-2 text-right">Preço</th><th className="py-2 text-right">Desc. %</th><th className="py-2 text-right">Total</th><th /></tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => (
                      <tr key={l.p.id} className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="py-2 pr-2">
                          <div className="font-medium">{l.p.nome}</div>
                          <div className={`text-xs ${l.p.estoque <= l.p.estoque_minimo ? "font-semibold text-amber-600" : "text-zinc-500"}`}>{l.p.unidade}{l.p.permite_meia ? " (aceita ½)" : ""} · estoque {fmtQtd(l.p.estoque)}</div>
                        </td>
                        <td className="py-2 text-right">
                          <input className="campo w-20! text-right" inputMode="decimal" defaultValue={String(l.qtd).replace(".", ",")} key={`${l.p.id}-${l.qtd}`}
                            onBlur={(e) => ajustarQtd(l, e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} aria-label={`Quantidade de ${l.p.nome}`} />
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">{fmtMoeda(unit(l))}{l.desc > 0 && <div className="text-xs text-zinc-400 line-through">{fmtMoeda(l.p.preco)}</div>}</td>
                        <td className="py-2 text-right">
                          <input className={`campo w-16! text-right ${l.desc > descMax ? "border-amber-500 bg-amber-50 dark:bg-amber-500/10" : ""}`} inputMode="decimal" value={l.desc || ""} placeholder="0"
                            onChange={(e) => mudar(l.p.id, { desc: Math.min(100, Math.max(0, Number(e.target.value.replace(",", ".")) || 0)) })} aria-label={`Desconto de ${l.p.nome}`} />
                        </td>
                        <td className="py-2 text-right font-semibold whitespace-nowrap">{fmtMoeda(unit(l) * l.qtd)}</td>
                        <td className="py-2 pl-1 text-right"><Botao variante="fantasma" tamanho="p" onClick={() => setLinhas((x) => x.filter((y) => y.p.id !== l.p.id))} aria-label="Remover">✕</Botao></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="cartao p-4">
            <label className="rotulo" htmlFor="obs">Observação</label>
            <textarea id="obs" className="campo min-h-16" placeholder="Ex.: entregar depois das 14h" value={obs} onChange={(e) => setObs(e.target.value)} />
          </section>
        </div>

        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="cartao space-y-3 p-4">
            <h2 className="titulo text-lg">Resumo</h2>
            <div className="flex justify-between text-sm"><span className="text-zinc-500">Produtos</span><span>{validas.length}</span></div>
            <div className="flex justify-between text-sm"><span className="text-zinc-500">Itens</span><span>{fmtQtd(validas.reduce((s, l) => s + l.qtd, 0))}</span></div>
            <div className="flex justify-between text-sm"><span className="text-zinc-500">Peso</span><span>{fmtPeso(peso)}</span></div>
            <div className="flex items-baseline justify-between border-t border-zinc-200 pt-3 dark:border-zinc-800"><span className="font-semibold">Total</span><span className="font-display text-3xl font-bold">{fmtMoeda(total)}</span></div>
            {acima && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Desconto acima do seu limite ({fmtQtd(descMax)}%): o pedido vai aguardar aprovação.</p>}
            <Botao className="w-full" tamanho="g" onClick={() => salvar(false)} carregando={salvando}>Salvar pedido</Botao>
            <Botao className="w-full" variante="secundario" onClick={() => salvar(true)} disabled={salvando}>Salvar e imprimir</Botao>
          </div>
        </aside>
      </div>
    </>
  );
}
