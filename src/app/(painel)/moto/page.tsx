"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg, fmtDataHora, fmtMoeda, fmtQtd, hojeISO } from "@/lib/formato";
import { Botao, BotaoConfirmar, Cabecalho, Vazio, avisar } from "@/components/ui";
import { abrirImpressaoPedidos } from "@/lib/impressao";

type Entrega = {
  id: string; numero: number; total: number; status: string; observacao: string | null; feito_em: string; entregue_em: string | null;
  clientes: { razao_social: string; nome_fantasia: string | null; endereco: string | null; numero: string | null; bairro: string | null; cidade: string | null; referencia: string | null; telefone: string | null };
  pedido_itens: { quantidade: number; produtos: { nome: string; unidade: string } }[];
};

const endereco = (c: Entrega["clientes"]) =>
  [c.endereco && `${c.endereco}${c.numero ? ", " + c.numero : ""}`, c.bairro, c.cidade].filter(Boolean).join(" - ");
const soNumeros = (t: string) => t.replace(/\D/g, "");

/** Tela simples para levar na moto: abre no celular, mostra o endereço, liga, abre o mapa e marca entregue. */
export default function Moto() {
  const sb = supabaseNavegador();
  const [lista, setLista] = useState<Entrega[]>([]);
  const [carregado, setCarregado] = useState(false);

  const carregar = useCallback(async () => {
    const inicio = new Date(hojeISO() + "T00:00:00").toISOString();
    const { data, error } = await sb.from("pedidos")
      .select("id, numero, total, status, observacao, feito_em, entregue_em, clientes(razao_social, nome_fantasia, endereco, numero, bairro, cidade, referencia, telefone), pedido_itens(quantidade, produtos(nome, unidade))")
      .eq("entrega", "moto")
      .or(`status.in.(liberado,aguardando_aprovacao),and(status.eq.entregue,entregue_em.gte.${inicio})`)
      .order("numero");
    if (error) avisar(erroMsg(error), "erro");
    setLista((data ?? []) as unknown as Entrega[]);
    setCarregado(true);
  }, [sb]);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 30000);
    return () => clearInterval(t);
  }, [carregar]);

  async function entregar(p: Entrega, entregue: boolean) {
    const { error } = await sb.rpc("entregar_moto", { p_pedido: p.id, p_entregue: entregue });
    if (error) return avisar(erroMsg(error), "erro");
    avisar(entregue ? `✅ Nº ${p.numero} entregue` : `Nº ${p.numero} voltou para "a entregar"`);
    carregar();
  }

  const aEntregar = lista.filter((p) => p.status === "liberado");
  const esperando = lista.filter((p) => p.status === "aguardando_aprovacao");
  const entregues = lista.filter((p) => p.status === "entregue").sort((a, b) => (b.entregue_em ?? "").localeCompare(a.entregue_em ?? ""));

  return (
    <div className="mx-auto max-w-xl">
      <Cabecalho titulo="🏍️ Entregas de moto" sub={`${aEntregar.length} para entregar · ${fmtMoeda(aEntregar.reduce((s, p) => s + Number(p.total), 0))}`}>
        {aEntregar.length > 0 && <Botao variante="secundario" onClick={() => abrirImpressaoPedidos(aEntregar.map((p) => p.id))}>🖨️ Imprimir todos</Botao>}
      </Cabecalho>

      {carregado && aEntregar.length === 0 && <Vazio>Nenhuma entrega de moto agora. Para mandar um pedido pela moto, escolha “🏍️ Moto” no Novo pedido ou abra o pedido e toque em “Moto”.</Vazio>}

      <div className="space-y-3">
        {aEntregar.map((p) => {
          const end = endereco(p.clientes);
          const tel = p.clientes.telefone ? soNumeros(p.clientes.telefone) : "";
          return (
            <div key={p.id} className="cartao p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-zinc-500">Nº {p.numero}</div>
                  <div className="text-xl font-bold leading-tight">{p.clientes.nome_fantasia || p.clientes.razao_social}</div>
                </div>
                <div className="text-right font-display text-2xl font-bold">{fmtMoeda(p.total)}</div>
              </div>
              <div className="mt-1 text-[15px]">{end || <span className="text-amber-600">sem endereço no cadastro</span>}</div>
              {p.clientes.referencia && <div className="text-sm text-zinc-500">Ref.: {p.clientes.referencia}</div>}
              <ul className="mt-2 rounded-lg bg-zinc-50 p-2 text-sm dark:bg-zinc-800/60">
                {p.pedido_itens.map((i, k) => <li key={k}><b>{fmtQtd(i.quantidade)} {i.produtos.unidade}</b> {i.produtos.nome}</li>)}
              </ul>
              {p.observacao && <div className="mt-2 text-sm"><b>Obs.:</b> {p.observacao}</div>}
              <div className="mt-3 grid grid-cols-3 gap-2">
                <a className={`grid h-12 place-items-center rounded-xl border border-zinc-300 font-semibold dark:border-zinc-700 ${end ? "" : "pointer-events-none opacity-40"}`}
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(end)}`} target="_blank" rel="noreferrer">📍 Mapa</a>
                <a className={`grid h-12 place-items-center rounded-xl border border-zinc-300 font-semibold dark:border-zinc-700 ${tel ? "" : "pointer-events-none opacity-40"}`} href={`tel:${tel}`}>📞 Ligar</a>
                <button className="h-12 rounded-xl border border-zinc-300 font-semibold dark:border-zinc-700" onClick={() => abrirImpressaoPedidos([p.id])}>🖨️ Cupom</button>
              </div>
              <BotaoConfirmar className="mt-2 h-14! w-full text-lg!" aoConfirmar={() => entregar(p, true)} textoConfirmar="Toque de novo para confirmar">✅ Entregue</BotaoConfirmar>
            </div>
          );
        })}
      </div>

      {esperando.length > 0 && (
        <section className="mt-6">
          <h2 className="titulo mb-2 text-lg">Esperando aprovação</h2>
          <div className="cartao divide-y divide-zinc-100 opacity-70 dark:divide-zinc-800">
            {esperando.map((p) => <div key={p.id} className="flex justify-between gap-2 p-3 text-sm"><span>Nº {p.numero} · {p.clientes.razao_social}</span><span>{fmtMoeda(p.total)}</span></div>)}
          </div>
        </section>
      )}

      {entregues.length > 0 && (
        <section className="mt-6">
          <h2 className="titulo mb-2 text-lg">Entregues hoje ({entregues.length}) · {fmtMoeda(entregues.reduce((s, p) => s + Number(p.total), 0))}</h2>
          <div className="cartao divide-y divide-zinc-100 dark:divide-zinc-800">
            {entregues.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                <div><b>Nº {p.numero}</b> · {p.clientes.nome_fantasia || p.clientes.razao_social}<div className="text-xs text-zinc-500">{p.entregue_em ? fmtDataHora(p.entregue_em) : ""}</div></div>
                <div className="flex items-center gap-2"><span className="font-semibold">{fmtMoeda(p.total)}</span><Botao tamanho="p" variante="fantasma" onClick={() => entregar(p, false)}>Desfazer</Botao></div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
