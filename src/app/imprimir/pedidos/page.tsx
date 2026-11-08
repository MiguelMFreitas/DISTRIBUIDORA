"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg, fmtDataHora, fmtMoeda, fmtPeso, fmtQtd } from "@/lib/formato";

type Ped = {
  id: string; numero: number; total: number; peso_kg: number; observacao: string | null; feito_em: string; status: string;
  clientes: { razao_social: string; nome_fantasia: string | null; cpf_cnpj: string | null; endereco: string | null; numero: string | null; bairro: string | null; cidade: string | null; referencia: string | null; telefone: string | null; rotas: { nome: string } | null };
  perfis: { nome: string } | null;
  cargas: { numero: number; motoristas: { nome: string } | null } | null;
  pedido_itens: { id: string; quantidade: number; preco_unit: number; desconto_pct: number; total: number; produtos: { nome: string; codigo: string | null; unidade: string; categorias: { ordem: number } | null } }[];
};

const SELECT = "id, numero, total, peso_kg, observacao, feito_em, status, clientes(razao_social, nome_fantasia, cpf_cnpj, endereco, numero, bairro, cidade, referencia, telefone, rotas(nome)), perfis!pedidos_vendedor_id_fkey(nome), cargas(numero, motoristas(nome)), pedido_itens(id, quantidade, preco_unit, desconto_pct, total, produtos(nome, codigo, unidade, categorias(ordem)))";

function Conteudo() {
  const params = useSearchParams();
  const sb = supabaseNavegador();
  const [pedidos, setPedidos] = useState<Ped[] | null>(null);
  const [erro, setErro] = useState("");
  const [umPorFolha, setUmPorFolha] = useState(false);

  useEffect(() => {
    try { setUmPorFolha(localStorage.getItem("imprimir_um_por_folha") === "1"); } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      let q = sb.from("pedidos").select(SELECT);
      const carga = params.get("carga");
      if (carga) q = q.eq("carga_id", carga).in("status", ["liberado", "carregado", "entregue"]);
      else {
        let ids = (params.get("ids") ?? "").split(",").filter(Boolean);
        if (params.get("sel")) { try { ids = JSON.parse(localStorage.getItem("imprimir_pedidos") ?? "[]"); } catch {} }
        if (!ids.length) return setPedidos([]);
        q = q.in("id", ids);
      }
      const { data, error } = await q;
      if (error) return setErro(erroMsg(error));
      const lista = (data ?? []) as unknown as Ped[];
      // pela carga: agrupa por rota e bairro (ordem de entrega); senão, pelo número
      lista.sort((a, b) => carga
        ? `${a.clientes.rotas?.nome ?? "~"}|${a.clientes.bairro ?? ""}|${a.clientes.razao_social}`.localeCompare(`${b.clientes.rotas?.nome ?? "~"}|${b.clientes.bairro ?? ""}|${b.clientes.razao_social}`)
        : a.numero - b.numero);
      // itens na ordem das categorias, igual ao caminhão
      lista.forEach((p) => p.pedido_itens.sort((x, y) => (x.produtos.categorias?.ordem ?? 9999) - (y.produtos.categorias?.ordem ?? 9999) || x.produtos.nome.localeCompare(y.produtos.nome)));
      setPedidos(lista);
      document.title = carga ? `Pedidos da carga` : `Pedidos`;
      if (lista.length) await sb.rpc("marcar_pedidos_impressos", { p_pedidos: lista.map((p) => p.id) });
    })();
  }, [sb, params]);

  if (erro) return <p style={{ padding: 24 }}>Erro: {erro}</p>;
  if (!pedidos) return <p style={{ padding: 24 }}>Carregando…</p>;
  if (!pedidos.length) return <p style={{ padding: 24 }}>Nenhum pedido para imprimir.</p>;

  const empresa = process.env.NEXT_PUBLIC_EMPRESA_NOME || "Distribuidora";

  return (
    <>
      <div className="barra">
        <span>{pedidos.length} pedido(s)</span>
        <label className="sec">
          <input type="checkbox" checked={umPorFolha} onChange={(e) => { setUmPorFolha(e.target.checked); try { localStorage.setItem("imprimir_um_por_folha", e.target.checked ? "1" : "0"); } catch {} }} /> Um pedido por folha
        </label>
        <button onClick={() => window.print()}>🖨 Imprimir / Salvar PDF</button>
      </div>
      <div className={`folha ${umPorFolha ? "um-por-folha" : ""}`}>
        {pedidos.map((p) => {
          const c = p.clientes;
          return (
            <div key={p.id} className="ped">
              <div className="ped-topo">
                <div>
                  <div className="emp cond">{empresa}</div>
                  <div style={{ fontSize: 11, color: "#555" }}>Vendedor: {p.perfis?.nome ?? "—"}{p.cargas ? ` · Carga ${p.cargas.numero}${p.cargas.motoristas ? " · " + p.cargas.motoristas.nome : ""}` : ""}</div>
                </div>
                <div><div className="num cond">Pedido {p.numero}</div><small>{fmtDataHora(p.feito_em)}</small></div>
              </div>
              <div className="ped-cli">
                <div><div className="nome">{c.razao_social}</div>{c.nome_fantasia && <div>{c.nome_fantasia}</div>}</div>
                <div style={{ textAlign: "right" }}>{c.rotas && <div><b>Rota</b>{c.rotas.nome}</div>}{c.cpf_cnpj && <div><b>CPF/CNPJ</b>{c.cpf_cnpj}</div>}</div>
                <div><b>Endereço</b>{[c.endereco && `${c.endereco}${c.numero ? ", " + c.numero : ""}`, c.bairro, c.cidade].filter(Boolean).join(" · ") || "—"}{c.referencia && <> · <i>{c.referencia}</i></>}</div>
                <div style={{ textAlign: "right" }}><b>Tel.</b>{c.telefone ?? "—"}</div>
              </div>
              <table className="ped-tab">
                <thead><tr><th className="r">Qtd</th><th>Un</th><th>Produto</th><th className="r">Preço</th><th className="r">Desc.</th><th className="r">Total</th></tr></thead>
                <tbody>
                  {p.pedido_itens.map((i) => (
                    <tr key={i.id}>
                      <td className="r q">{fmtQtd(i.quantidade)}</td>
                      <td>{i.produtos.unidade}</td>
                      <td>{i.produtos.nome}</td>
                      <td className="r">{fmtMoeda(i.preco_unit)}</td>
                      <td className="r">{i.desconto_pct > 0 ? `${Number(i.desconto_pct).toLocaleString("pt-BR")}%` : ""}</td>
                      <td className="r">{fmtMoeda(i.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ped-tot">
                <div style={{ fontSize: 12, color: "#444" }}>{p.pedido_itens.length} produtos · {fmtQtd(p.pedido_itens.reduce((s, i) => s + Number(i.quantidade), 0))} itens · {fmtPeso(p.peso_kg)}</div>
                <div><span style={{ fontSize: 11, color: "#555", marginRight: 8 }}>TOTAL</span><span className="valor">{fmtMoeda(p.total)}</span></div>
              </div>
              {p.observacao && <div className="ped-obs"><b>Obs.:</b> {p.observacao}</div>}
              <div className="ped-ass"><div>Recebi as mercadorias acima · Nome / assinatura</div><div>Valor recebido R$</div></div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function ImprimirPedidos() {
  return <Suspense fallback={<p style={{ padding: 24 }}>Carregando…</p>}><Conteudo /></Suspense>;
}
