"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg, fmtDataHora, fmtMoeda, hojeISO } from "@/lib/formato";
import { Botao, Cabecalho, Selo, Vazio, avisar } from "@/components/ui";
import { usePerfil } from "@/components/perfil-contexto";
import { PedidoDetalhe } from "@/components/pedido-detalhe";
import { STATUS_PEDIDO, type StatusPedido } from "@/lib/tipos";

type Config = { ligado: boolean; aviso: string };
type Ped = { id: string; numero: number; total: number; status: StatusPedido; feito_em: string; visto_em: string | null; entrega: string; contato_nome: string; contato_bairro: string | null; pagamento: string | null };

const EMPRESA = process.env.NEXT_PUBLIC_EMPRESA_NOME || "Distribuidora";

export default function LinkDePedidos() {
  const sb = supabaseNavegador();
  const eu = usePerfil();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [aviso, setAviso] = useState("");
  const [peds, setPeds] = useState<Ped[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState("");

  const carregar = useCallback(async () => {
    const inicio = new Date(hojeISO() + "T00:00:00").toISOString();
    const [{ data: c }, { data: p, error }] = await Promise.all([
      sb.from("configuracoes").select("valor").eq("chave", "link_pedidos").maybeSingle(),
      sb.from("pedidos").select("id, numero, total, status, feito_em, visto_em, entrega, contato_nome, contato_bairro, pagamento")
        .eq("origem", "link").or(`feito_em.gte.${inicio},visto_em.is.null`).order("numero", { ascending: false }),
    ]);
    if (error) avisar(erroMsg(error), "erro");
    const v = (c?.valor ?? { ligado: false, aviso: "" }) as Config;
    setCfg(v); setAviso(v.aviso ?? "");
    setPeds((p ?? []) as Ped[]);
  }, [sb]);
  useEffect(() => { carregar(); const t = setInterval(carregar, 30000); return () => clearInterval(t); }, [carregar]);
  useEffect(() => {
    const u = `${window.location.origin}/pedir`;
    setUrl(u);
    setMsg(`Olá! Agora você pode fazer seu pedido na ${EMPRESA} pelo celular, a qualquer hora: ${u}\nÉ só escolher os produtos, colocar o endereço e finalizar. Pagamento na entrega (dinheiro ou Pix).`);
  }, []);

  async function salvar(novo: Config) {
    const { error } = await sb.from("configuracoes").upsert({ chave: "link_pedidos", valor: novo });
    if (error) return avisar(erroMsg(error), "erro");
    avisar(novo.ligado ? "Link salvo e ligado" : "Link desligado: ninguém consegue pedir por ele agora");
    carregar();
  }
  async function copiar(texto: string, oque: string) {
    try { await navigator.clipboard.writeText(texto); avisar(`${oque} copiado`); } catch { avisar("Não deu para copiar. Selecione o texto e copie.", "erro"); }
  }

  const naoVistos = peds.filter((p) => !p.visto_em).length;
  const hoje = peds.filter((p) => p.feito_em >= new Date(hojeISO() + "T00:00:00").toISOString() && !["cancelado", "recusado"].includes(p.status));

  return (
    <>
      <Cabecalho titulo="🔗 Link de pedidos" sub="Mande o link para os clientes. Eles escolhem os produtos, põem nome, telefone e endereço e finalizam. O pedido chega liberado, para moto, e conta para o vendedor “🔗 Pedidos pelo link”." />

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="cartao space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="titulo text-lg">O link</h2>
            {cfg && <Selo cor={cfg.ligado ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"}>{cfg.ligado ? "● Ligado" : "Desligado"}</Selo>}
          </div>
          <div className="flex gap-2">
            <input className="campo font-mono" readOnly value={url} aria-label="Endereço do link" onFocus={(e) => e.target.select()} />
            <Botao variante="secundario" onClick={() => copiar(url, "Link")}>Copiar</Botao>
          </div>
          <a href="/pedir" target="_blank" className="inline-block text-sm font-semibold text-marca-600">Abrir o link como o cliente vê →</a>
          {eu.admin && cfg && (
            <div className="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <label className="rotulo" htmlFor="aviso">Frase no topo da página</label>
              <input id="aviso" className="campo" value={aviso} maxLength={150} onChange={(e) => setAviso(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Botao onClick={() => salvar({ ...cfg, aviso })} disabled={aviso === (cfg.aviso ?? "")}>Salvar frase</Botao>
                <Botao variante={cfg.ligado ? "perigo" : "primario"} onClick={() => salvar({ ...cfg, aviso, ligado: !cfg.ligado })}>{cfg.ligado ? "Desligar o link" : "Ligar o link"}</Botao>
              </div>
            </div>
          )}
        </section>

        <section className="cartao space-y-3 p-4">
          <h2 className="titulo text-lg">Mensagem para mandar</h2>
          <textarea className="campo min-h-32" value={msg} onChange={(e) => setMsg(e.target.value)} aria-label="Mensagem" />
          <div className="flex flex-wrap gap-2">
            <Botao variante="secundario" onClick={() => copiar(msg, "Mensagem")}>Copiar mensagem</Botao>
            <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer"><Botao>Mandar pelo WhatsApp</Botao></a>
          </div>
          <p className="text-xs text-zinc-500">Dica: no WhatsApp Business, cole essa mensagem em “Mensagem de saudação” ou “Mensagem de ausência” para ela ir sozinha para quem chamar.</p>
        </section>
      </div>

      <section className="mt-6">
        <h2 className="titulo mb-2 text-lg">Pedidos pelo link {naoVistos > 0 && <span className="ml-1 rounded-full bg-sky-600 px-2 py-0.5 text-sm text-white">{naoVistos} novo(s)</span>} <span className="text-base font-normal text-zinc-500">· hoje {hoje.length} · {fmtMoeda(hoje.reduce((s, p) => s + Number(p.total), 0))}</span></h2>
        {peds.length === 0 ? <Vazio>Nenhum pedido pelo link hoje.</Vazio> : (
          <div className="cartao divide-y divide-zinc-100 dark:divide-zinc-800">
            {peds.map((p) => (
              <button key={p.id} onClick={() => setAberto(p.id)} className={`flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 ${p.visto_em ? "" : "bg-sky-50 dark:bg-sky-500/10"}`}>
                <div>
                  <div className="font-semibold">{!p.visto_em && "🆕 "}Nº {p.numero} · {p.contato_nome}</div>
                  <div className="text-sm text-zinc-500">{p.contato_bairro} · {fmtDataHora(p.feito_em)} · {p.pagamento === "pix" ? "Pix" : "Dinheiro"} · {p.entrega === "moto" ? "🏍️ moto" : p.entrega === "caminhao" ? "🚚 caminhão" : "🏪 balcão"}</div>
                </div>
                <div className="text-right"><div className="font-semibold">{fmtMoeda(p.total)}</div><Selo cor={STATUS_PEDIDO[p.status].cor}>{STATUS_PEDIDO[p.status].nome}</Selo></div>
              </button>
            ))}
          </div>
        )}
      </section>

      <PedidoDetalhe id={aberto} aoFechar={() => setAberto(null)} aoMudar={carregar} />
    </>
  );
}
