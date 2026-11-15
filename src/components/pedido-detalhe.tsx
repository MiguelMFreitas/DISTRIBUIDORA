"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg, fmtDataHora, fmtMoeda, fmtPeso, fmtQtd } from "@/lib/formato";
import { ENTREGAS, STATUS_PEDIDO, type StatusPedido, type TipoEntrega } from "@/lib/tipos";
import { Botao, BotaoConfirmar, Modal, Selo, avisar } from "./ui";
import { usePerfil, usePode } from "./perfil-contexto";
import { CampoPreco } from "./campo-preco";
import { ConfirmarSenha } from "./confirmar-senha";

type Item = { id: string; quantidade: number; preco_tabela: number; desconto_pct: number; preco_unit: number; total: number; precisa_aprovacao: boolean; motivo_aprovacao: string | null; produtos: { nome: string; unidade: string; permite_meia: boolean; preco_minimo: number | null } };

/** abaixo do preço mínimo do cadastro do produto */
const abaixoCad = (i: Item, preco = Number(i.preco_unit)) => i.produtos.preco_minimo != null && preco < Number(i.produtos.preco_minimo) - 0.001;
type Det = {
  id: string; numero: number; status: StatusPedido; total: number; peso_kg: number; observacao: string | null; feito_em: string; carga_id: string | null; entrega: TipoEntrega;
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
  const [editando, setEditando] = useState<{ id: string; qtd: string; preco: number } | null>(null);
  // ação que espera a senha do administrador (preço abaixo do mínimo do produto)
  const [comSenha, setComSenha] = useState<{ texto: string; fazer: () => void } | null>(null);

  const ler = useCallback(async () => {
    if (!id) return;
    const { data, error } = await sb.from("pedidos")
      .select("id, numero, status, total, peso_kg, observacao, feito_em, carga_id, entrega, clientes(razao_social, nome_fantasia, endereco, numero, bairro, cidade, telefone), perfis!pedidos_vendedor_id_fkey(nome, desconto_max), pedido_itens(id, quantidade, preco_tabela, desconto_pct, preco_unit, total, precisa_aprovacao, motivo_aprovacao, produtos(nome, unidade, permite_meia, preco_minimo))")
      .eq("id", id).single();
    if (error) avisar(erroMsg(error), "erro");
    setP(data as unknown as Det);
  }, [id, sb]);

  useEffect(() => { setP(null); setEditando(null); ler(); }, [ler]);

  async function acaoItem(fn: "aprovar_item" | "recusar_item" | "editar_item", i: Item, extra: Record<string, number> = {}) {
    setOcupado(true);
    const { data, error } = await sb.rpc(fn, { p_item: i.id, ...extra });
    setOcupado(false);
    if (error) return avisar(erroMsg(error), "erro");
    const status = data as string;
    avisar(fn === "recusar_item" ? `${i.produtos.nome} tirado do pedido, estoque devolvido` : fn === "editar_item" ? `${i.produtos.nome} alterado` : `${i.produtos.nome} aprovado`);
    if (status === "liberado") avisar("Nada mais para aprovar: pedido liberado");
    if (status === "recusado") avisar("Pedido ficou sem produtos e foi recusado");
    setEditando(null);
    aoMudar();
    if (status === "recusado") return aoFechar();
    ler();
  }

  function aprovarItem(i: Item) {
    if (abaixoCad(i)) return setComSenha({ texto: `${i.produtos.nome} a ${fmtMoeda(i.preco_unit)} está abaixo do preço mínimo (${fmtMoeda(i.produtos.preco_minimo!)}).`, fazer: () => acaoItem("aprovar_item", i) });
    acaoItem("aprovar_item", i);
  }
  function salvarEdicao(i: Item) {
    if (!editando) return;
    const qtd = Number(editando.qtd.replace(",", "."));
    if (!(qtd > 0) || (!i.produtos.permite_meia && !Number.isInteger(qtd)) || !Number.isInteger(qtd * 2)) return avisar("Quantidade inválida.", "erro");
    if (!(editando.preco > 0)) return avisar("Preço inválido.", "erro");
    const fazer = () => acaoItem("editar_item", i, { p_quantidade: qtd, p_preco_unit: editando.preco });
    if (abaixoCad(i, editando.preco)) return setComSenha({ texto: `${i.produtos.nome} a ${fmtMoeda(editando.preco)} fica abaixo do preço mínimo (${fmtMoeda(i.produtos.preco_minimo!)}).`, fazer });
    fazer();
  }

  async function acao(fn: string, senhaConferida = false) {
    if (!p) return;
    const baixos = p.pedido_itens.filter((i) => abaixoCad(i));
    if (fn === "aprovar_pedido" && baixos.length && !senhaConferida)
      return setComSenha({ texto: `Abaixo do preço mínimo: ${baixos.map((i) => `${i.produtos.nome} a ${fmtMoeda(i.preco_unit)} (mín. ${fmtMoeda(i.produtos.preco_minimo!)})`).join("; ")}.`, fazer: () => acao(fn, true) });
    setOcupado(true);
    const { error } = await sb.rpc(fn, { p_pedido: p.id });
    setOcupado(false);
    if (error) return avisar(erroMsg(error), "erro");
    avisar(fn === "aprovar_pedido" ? "Pedido aprovado" : fn === "recusar_pedido" ? "Pedido recusado, estoque devolvido" : "Pedido cancelado, estoque devolvido");
    aoMudar();
    aoFechar();
  }

  async function mudarEntrega(e: TipoEntrega) {
    if (!p) return;
    setOcupado(true);
    const { data, error } = await sb.rpc("mudar_entrega", { p_pedido: p.id, p_entrega: e });
    setOcupado(false);
    if (error) return avisar(erroMsg(error), "erro");
    avisar(data === "entregue" ? "Balcão: pedido marcado como entregue" : `Entrega: ${ENTREGAS[e].nome}`);
    aoMudar();
    ler();
  }
  const podeMudarEntrega = p && !p.carga_id && ["aguardando_aprovacao", "liberado"].includes(p.status) && (pode("pedidos_ver_todos") || pode("cargas"));

  const podeCancelar = p && ["aguardando_aprovacao", "liberado"].includes(p.status) && pode("pedidos_ver_todos");

  return (
    <Modal aberto={!!id} aoFechar={aoFechar} titulo={p ? `Pedido nº ${p.numero}` : "Pedido"} largura="max-w-3xl"
      rodape={p && <>
        {podeCancelar && <BotaoConfirmar variante="secundario" className="mr-auto" aoConfirmar={() => acao("cancelar_pedido")} textoConfirmar="Cancelar o pedido?">Cancelar pedido</BotaoConfirmar>}
        <Botao variante="secundario" onClick={() => window.open(`/imprimir/pedidos?ids=${p.id}`, "_blank")}>Imprimir</Botao>
        {p.status === "aguardando_aprovacao" && eu.admin && <>
          <BotaoConfirmar variante="perigo" aoConfirmar={() => acao("recusar_pedido")} textoConfirmar="Recusar o pedido todo?">Recusar pedido todo</BotaoConfirmar>
          <Botao onClick={() => acao("aprovar_pedido")} carregando={ocupado}>Aprovar tudo</Botao>
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
              <div className="mt-1 font-semibold">{ENTREGAS[p.entrega ?? "caminhao"].icone} {ENTREGAS[p.entrega ?? "caminhao"].nome}</div>
            </div>
          </div>
          {podeMudarEntrega && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-zinc-500">Mudar entrega:</span>
              {(Object.keys(ENTREGAS) as TipoEntrega[]).filter((k) => k !== (p.entrega ?? "caminhao")).map((k) => (
                <Botao key={k} tamanho="p" variante="secundario" disabled={ocupado} onClick={() => mudarEntrega(k)}>{ENTREGAS[k].icone} {ENTREGAS[k].nome}</Botao>
              ))}
            </div>
          )}
          {p.status === "aguardando_aprovacao" && (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              O vendedor mudou o preço ou vendeu sem estoque. Em cada produto destacado você pode <b>aprovar</b>, <b>editar</b> (quantidade e preço) ou <b>recusar</b> — recusar tira só aquele produto e o resto do pedido segue normal.
            </p>
          )}
          <table className="w-full text-[15px]">
            <thead className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
              <tr><th className="py-2">Produto</th><th className="py-2 text-right">Qtd</th><th className="py-2 text-right">Preço</th><th className="py-2 text-right">Desc.</th><th className="py-2 text-right">Total</th>{p.status === "aguardando_aprovacao" && eu.admin && <th />}</tr>
            </thead>
            <tbody>
              {p.pedido_itens.map((i) => {
                const pendente = i.precisa_aprovacao && p.status === "aguardando_aprovacao";
                const ed = editando?.id === i.id ? editando : null;
                return (
                  <tr key={i.id} className={`border-b border-zinc-100 align-top dark:border-zinc-800 ${pendente ? "bg-amber-50 dark:bg-amber-500/10" : ""}`}>
                    <td className="py-2 pl-1">
                      {i.produtos.nome}
                      {pendente && <div className="text-xs font-bold text-amber-700 dark:text-amber-300">aguardando aprovação{i.motivo_aprovacao ? `: ${i.motivo_aprovacao}` : ""}</div>}
                      {abaixoCad(i) && <div className="text-xs font-bold text-red-600">abaixo do mínimo ({fmtMoeda(i.produtos.preco_minimo!)})</div>}
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {ed ? <input className="campo w-20! text-right" inputMode="decimal" value={ed.qtd} onChange={(e) => setEditando({ ...ed, qtd: e.target.value })} aria-label={`Quantidade de ${i.produtos.nome}`} />
                        : <>{fmtQtd(i.quantidade)} {i.produtos.unidade}</>}
                    </td>
                    <td className="py-2 text-right">
                      {ed ? <CampoPreco className="campo w-24! text-right" valor={ed.preco} aoMudar={(n) => setEditando({ ...ed, preco: n })} aria-label={`Preço de ${i.produtos.nome}`} />
                        : fmtMoeda(i.preco_unit)}
                      {Number(i.preco_unit) < Number(i.preco_tabela) && <div className="text-xs text-zinc-400 line-through">{fmtMoeda(i.preco_tabela)}</div>}
                    </td>
                    <td className={`py-2 text-right ${pendente ? "font-bold text-amber-600" : ""}`}>{i.desconto_pct > 0 ? `${Number(i.desconto_pct).toLocaleString("pt-BR")}%` : "—"}</td>
                    <td className="py-2 text-right font-semibold">{fmtMoeda(i.total)}</td>
                    {p.status === "aguardando_aprovacao" && eu.admin && (
                      <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                        {ed ? <>
                          <Botao tamanho="p" onClick={() => salvarEdicao(i)} carregando={ocupado}>Salvar</Botao>
                          <Botao tamanho="p" variante="fantasma" onClick={() => setEditando(null)}>Voltar</Botao>
                        </> : pendente && <>
                          <Botao tamanho="p" onClick={() => aprovarItem(i)} disabled={ocupado}>Aprovar</Botao>
                          <Botao tamanho="p" variante="secundario" onClick={() => setEditando({ id: i.id, qtd: String(i.quantidade).replace(".", ","), preco: Number(i.preco_unit) })}>Editar</Botao>
                          <BotaoConfirmar tamanho="p" variante="perigo" aoConfirmar={() => acaoItem("recusar_item", i)} textoConfirmar="Tirar?">Recusar</BotaoConfirmar>
                        </>}
                      </td>
                    )}
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
      <ConfirmarSenha aberto={!!comSenha} aoFechar={() => setComSenha(null)} aoConfirmar={() => { const f = comSenha?.fazer; setComSenha(null); f?.(); }}>
        <p className="text-sm">{comSenha?.texto}</p>
      </ConfirmarSenha>
    </Modal>
  );
}
