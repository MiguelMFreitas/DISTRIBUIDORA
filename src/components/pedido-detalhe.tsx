"use client";

import { useEffect, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg, fmtDataHora, fmtMoeda, fmtPeso, fmtQtd } from "@/lib/formato";
import { STATUS_PEDIDO, type StatusPedido } from "@/lib/tipos";
import { Botao, BotaoConfirmar, Modal, Selo, avisar } from "./ui";
import { usePerfil, usePode } from "./perfil-contexto";

type Item = { id: string; quantidade: number; preco_tabela: number; desconto_pct: number; preco_unit: number; total: number; produtos: { nome: string; unidade: string } };
type Det = {
  id: string; numero: number; status: StatusPedido; total: number; peso_kg: number; observacao: string | null; feito_em: string; carga_id: string | null;
  clientes: { razao_social: string; nome_fantasia: string | null; endereco: string | null; numero: string | null; bairro: string | null; cidade: string | null; telefone: string | null };
  perfis: { nome: string; desconto_max: number } | null;
  pedido_itens: Item[];
};

export function PedidoDetalhe({ id, aoFechar, aoMudar }: { id: string | null; aoFechar: () => void; aoMudar: () => void }) {
  const sb = supabaseNavegador();
  const eu = usePerfil();
  const pode = usePode();
  const [p, setP] = useState<Det | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    setP(null);
    if (!id) return;
    sb.from("pedidos")
      .select("id, numero, status, total, peso_kg, observacao, feito_em, carga_id, clientes(razao_social, nome_fantasia, endereco, numero, bairro, cidade, telefone), perfis!pedidos_vendedor_id_fkey(nome, desconto_max), pedido_itens(id, quantidade, preco_tabela, desconto_pct, preco_unit, total, produtos(nome, unidade))")
      .eq("id", id).single()
      .then(({ data, error }) => { if (error) avisar(erroMsg(error), "erro"); setP(data as unknown as Det); });
  }, [id, sb]);

  async function acao(fn: string) {
    if (!p) return;
    setOcupado(true);
    const { error } = await sb.rpc(fn, { p_pedido: p.id });
    setOcupado(false);
    if (error) return avisar(erroMsg(error), "erro");
    avisar(fn === "aprovar_pedido" ? "Pedido aprovado" : fn === "recusar_pedido" ? "Pedido recusado, estoque devolvido" : "Pedido cancelado, estoque devolvido");
    aoMudar();
    aoFechar();
  }

  const podeCancelar = p && ["aguardando_aprovacao", "liberado"].includes(p.status) && pode("pedidos_ver_todos");

  return (
    <Modal aberto={!!id} aoFechar={aoFechar} titulo={p ? `Pedido nº ${p.numero}` : "Pedido"} largura="max-w-3xl"
      rodape={p && <>
        {podeCancelar && <BotaoConfirmar variante="secundario" className="mr-auto" aoConfirmar={() => acao("cancelar_pedido")} textoConfirmar="Cancelar o pedido?">Cancelar pedido</BotaoConfirmar>}
        <Botao variante="secundario" onClick={() => window.open(`/imprimir/pedidos?ids=${p.id}`, "_blank")}>Imprimir</Botao>
        {p.status === "aguardando_aprovacao" && eu.admin && <>
          <Botao variante="perigo" onClick={() => acao("recusar_pedido")} carregando={ocupado}>Recusar</Botao>
          <Botao onClick={() => acao("aprovar_pedido")} carregando={ocupado}>Aprovar desconto</Botao>
        </>}
      </>}>
      {!p ? <p className="text-zinc-500">Carregando…</p> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-lg font-bold">{p.clientes.razao_social}</div>
              {p.clientes.nome_fantasia && <div className="text-zinc-500">{p.clientes.nome_fantasia}</div>}
              <div className="text-sm text-zinc-500">{[p.clientes.endereco && `${p.clientes.endereco}${p.clientes.numero ? ", " + p.clientes.numero : ""}`, p.clientes.bairro, p.clientes.cidade, p.clientes.telefone].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="text-right text-sm">
              <Selo cor={STATUS_PEDIDO[p.status].cor}>{STATUS_PEDIDO[p.status].nome}</Selo>
              <div className="mt-1 text-zinc-500">{p.perfis?.nome ?? "—"} · {fmtDataHora(p.feito_em)}</div>
            </div>
          </div>
          {p.status === "aguardando_aprovacao" && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              O vendedor deu desconto acima do limite dele ({Number(p.perfis?.desconto_max ?? 0).toLocaleString("pt-BR")}%). Os itens em destaque estão acima do limite.
            </p>
          )}
          <table className="w-full text-[15px]">
            <thead className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
              <tr><th className="py-2">Produto</th><th className="py-2 text-right">Qtd</th><th className="py-2 text-right">Preço</th><th className="py-2 text-right">Desc.</th><th className="py-2 text-right">Total</th></tr>
            </thead>
            <tbody>
              {p.pedido_itens.map((i) => {
                const acima = i.desconto_pct > Number(p.perfis?.desconto_max ?? 0);
                return (
                  <tr key={i.id} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="py-2">{i.produtos.nome}</td>
                    <td className="py-2 text-right whitespace-nowrap">{fmtQtd(i.quantidade)} {i.produtos.unidade}</td>
                    <td className="py-2 text-right">{fmtMoeda(i.preco_unit)}{i.desconto_pct > 0 && <div className="text-xs text-zinc-400 line-through">{fmtMoeda(i.preco_tabela)}</div>}</td>
                    <td className={`py-2 text-right ${acima && p.status === "aguardando_aprovacao" ? "font-bold text-amber-600" : ""}`}>{i.desconto_pct > 0 ? `${Number(i.desconto_pct).toLocaleString("pt-BR")}%` : "—"}</td>
                    <td className="py-2 text-right font-semibold">{fmtMoeda(i.total)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td className="pt-3 text-zinc-500" colSpan={3}>Peso: {fmtPeso(p.peso_kg)}</td><td className="pt-3 text-right font-semibold">Total</td><td className="pt-3 text-right text-lg font-bold">{fmtMoeda(p.total)}</td></tr>
            </tfoot>
          </table>
          {p.observacao && <p className="rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-800"><b>Obs.:</b> {p.observacao}</p>}
        </div>
      )}
    </Modal>
  );
}
