"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg, fmtDataHora, fmtMoeda, fmtPeso, fmtQtd } from "@/lib/formato";

type Ped = {
  id: string; numero: number; total: number; peso_kg: number; observacao: string | null; feito_em: string; status: string;
  clientes: { razao_social: string; nome_fantasia: string | null; cpf_cnpj: string | null; endereco: string | null; numero: string | null; bairro: string | null; cidade: string | null; referencia: string | null; telefone: string | null; rotas: { nome: string } | null };
  perfis: { nome: string } | null;
  cargas: { numero: number; nome: string | null; motoristas: { nome: string } | null } | null;
  pedido_itens: { id: string; quantidade: number; preco_unit: number; desconto_pct: number; total: number; produtos: { nome: string; codigo: string | null; unidade: string; categorias: { ordem: number } | null } }[];
};

const SELECT = "id, numero, total, peso_kg, observacao, feito_em, status, clientes(razao_social, nome_fantasia, cpf_cnpj, endereco, numero, bairro, cidade, referencia, telefone, rotas(nome)), perfis!pedidos_vendedor_id_fkey(nome), cargas(numero, nome, motoristas(nome)), pedido_itens(id, quantidade, preco_unit, desconto_pct, total, produtos(nome, codigo, unidade, categorias(ordem)))";

function Conteudo() {
  const params = useSearchParams();
  const sb = supabaseNavegador();
  const [pedidos, setPedidos] = useState<Ped[] | null>(null);
  const [erro, setErro] = useState("");
  const [umPorFolha, setUmPorFolha] = useState(false);
  // formato do papel: cupom da impressora térmica (padrão) ou folha A4
  const [formato, setFormato] = useState<"t80" | "t58" | "a4">("t80");

  useEffect(() => {
    try {
      setUmPorFolha(localStorage.getItem("imprimir_um_por_folha") === "1");
      const f = localStorage.getItem("imprimir_formato");
      if (f === "t80" || f === "t58" || f === "a4") setFormato(f);
    } catch {}
  }, []);

  const [ordem, setOrdem] = useState<"numero" | "rota">("numero");
  useEffect(() => {
    try { const o = localStorage.getItem("imprimir_ordem"); if (o === "rota" || o === "numero") setOrdem(o); } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      const carga = params.get("carga");
      let lista: Ped[] = [];
      if (carga) {
        const { data, error } = await sb.from("pedidos").select(SELECT).eq("carga_id", carga).in("status", ["liberado", "carregado", "entregue"]);
        if (error) return setErro(erroMsg(error));
        lista = (data ?? []) as unknown as Ped[];
        setOrdem("rota");
      } else {
        let ids = (params.get("ids") ?? "").split(",").filter(Boolean);
        if (params.get("sel")) { try { ids = JSON.parse(localStorage.getItem("imprimir_pedidos") ?? "[]"); } catch {} }
        if (!ids.length) return setPedidos([]);
        // busca em lotes de 80 para não estourar o tamanho do endereço
        for (let i = 0; i < ids.length; i += 80) {
          const { data, error } = await sb.from("pedidos").select(SELECT).in("id", ids.slice(i, i + 80));
          if (error) return setErro(erroMsg(error));
          lista.push(...((data ?? []) as unknown as Ped[]));
        }
      }
      // itens na ordem das categorias, igual ao caminhão
      lista.forEach((p) => p.pedido_itens.sort((x, y) => (x.produtos.categorias?.ordem ?? 9999) - (y.produtos.categorias?.ordem ?? 9999) || x.produtos.nome.localeCompare(y.produtos.nome)));
      setPedidos(lista);
      document.title = carga ? "Pedidos da carga" : `Pedidos (${lista.length})`;
      for (let i = 0; i < lista.length; i += 80) {
        await sb.rpc("marcar_pedidos_impressos", { p_pedidos: lista.slice(i, i + 80).map((p) => p.id) });
      }
    })();
  }, [sb, params]);

  const ordenados = useMemo(() => {
    if (!pedidos) return null;
    const chave = (p: Ped) => `${p.clientes.rotas?.nome ?? "~"}|${p.clientes.bairro ?? ""}|${p.clientes.razao_social}`;
    return [...pedidos].sort((a, b) => (ordem === "rota" ? chave(a).localeCompare(chave(b)) : a.numero - b.numero));
  }, [pedidos, ordem]);

  if (erro) return <p style={{ padding: 24 }}>Erro: {erro}</p>;
  if (!pedidos || !ordenados) return <p style={{ padding: 24 }}>Carregando…</p>;
  if (!pedidos.length) return <p style={{ padding: 24 }}>Nenhum pedido para imprimir.</p>;

  const empresa = process.env.NEXT_PUBLIC_EMPRESA_NOME || "Distribuidora";

  return (
    <>
      <div className="barra">
        <span>{pedidos.length} pedido(s) · {fmtMoeda(pedidos.reduce((s, p) => s + Number(p.total), 0))}</span>
        <label className="sec">
          Ordem:{" "}
          <select value={ordem} onChange={(e) => { const o = e.target.value as "numero" | "rota"; setOrdem(o); try { localStorage.setItem("imprimir_ordem", o); } catch {} }} style={{ color: "#111", borderRadius: 6, border: 0, padding: "2px 4px" }}>
            <option value="numero">Nº do pedido</option>
            <option value="rota">Rota e bairro</option>
          </select>
        </label>
        <label className="sec">
          Papel:{" "}
          <select value={formato} onChange={(e) => { const f = e.target.value as typeof formato; setFormato(f); try { localStorage.setItem("imprimir_formato", f); } catch {} }} style={{ color: "#111", borderRadius: 6, border: 0, padding: "2px 4px" }}>
            <option value="t80">Cupom 80 mm (térmica)</option>
            <option value="t58">Cupom 58 mm (térmica pequena)</option>
            <option value="a4">Folha A4</option>
          </select>
        </label>
        {formato === "a4" && <label className="sec">
          <input type="checkbox" checked={umPorFolha} onChange={(e) => { setUmPorFolha(e.target.checked); try { localStorage.setItem("imprimir_um_por_folha", e.target.checked ? "1" : "0"); } catch {} }} /> Um pedido por folha
        </label>}
        <button onClick={() => window.print()}>🖨 Imprimir / Salvar PDF</button>
        {formato !== "a4" && <span style={{ width: "100%", textAlign: "center", fontSize: 12, opacity: .8 }}>Na janela de impressão, escolha a impressora térmica e deixe a margem em “Nenhuma”. Cada pedido sai em um cupom.</span>}
      </div>
      {/* na térmica o tamanho do papel vem do driver da impressora (bobina); aqui só tiramos a margem */}
      <style>{formato === "a4" ? "@page { size: A4; margin: 10mm; }" : "@page { margin: 0; }"}</style>
      {formato !== "a4" ? (
        <div className={`cupons ${formato}`}>
          {ordenados.map((p) => <Cupom key={p.id} p={p} empresa={empresa} />)}
        </div>
      ) : (
      <div className={`folha ${umPorFolha ? "um-por-folha" : ""}`}>
        {ordenados.map((p) => {
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
      )}
    </>
  );
}

/** Pedido no formato de cupom (impressora térmica): só preto, letras grandes, uma coluna */
function Cupom({ p, empresa }: { p: Ped; empresa: string }) {
  const c = p.clientes;
  const itens = p.pedido_itens.reduce((s, i) => s + Number(i.quantidade), 0);
  return (
    <div className="cupom">
      <div className="c-emp">{empresa}</div>
      <div className="c-num">PEDIDO {p.numero}</div>
      <div className="c-meta">{fmtDataHora(p.feito_em)} · Vend.: {p.perfis?.nome ?? "—"}</div>
      {p.cargas && <div className="c-meta"><b>Carga {p.cargas.numero}{p.cargas.nome ? ` · ${p.cargas.nome}` : ""}</b>{p.cargas.motoristas ? ` · ${p.cargas.motoristas.nome}` : ""}</div>}
      <div className="c-sep" />
      <div className="c-cli">{c.razao_social}</div>
      {c.nome_fantasia && <div>{c.nome_fantasia}</div>}
      <div>{[c.endereco && `${c.endereco}${c.numero ? ", " + c.numero : ""}`, c.bairro, c.cidade].filter(Boolean).join(" - ")}</div>
      {c.referencia && <div>Ref.: {c.referencia}</div>}
      <div>{c.telefone ? `Tel.: ${c.telefone}` : ""}{c.rotas ? `${c.telefone ? " · " : ""}Rota: ${c.rotas.nome}` : ""}</div>
      <div className="c-sep" />
      {p.pedido_itens.map((i) => (
        <div key={i.id} className="c-it">
          <span className="c-q">{fmtQtd(i.quantidade)} {i.produtos.unidade}</span>
          <span className="c-n">{i.produtos.nome}</span>
          <span className="c-v">
            <span>{fmtMoeda(i.preco_unit)}{i.desconto_pct > 0 ? ` (-${Number(i.desconto_pct).toLocaleString("pt-BR")}%)` : ""}</span>
            <b>{fmtMoeda(i.total)}</b>
          </span>
        </div>
      ))}
      <div className="c-sep" />
      <div className="c-meta" style={{ textAlign: "left" }}>{p.pedido_itens.length} produtos · {fmtQtd(itens)} itens · {fmtPeso(p.peso_kg)}</div>
      <div className="c-tot"><span>TOTAL</span><span>{fmtMoeda(p.total)}</span></div>
      {p.observacao && <><div className="c-sep" /><div><b>OBS.:</b> {p.observacao}</div></>}
      <div className="c-ass">Recebi as mercadorias · Assinatura</div>
      <div className="c-ass" style={{ marginTop: "7mm" }}>Valor recebido R$</div>
    </div>
  );
}

export default function ImprimirPedidos() {
  return <Suspense fallback={<p style={{ padding: 24 }}>Carregando…</p>}><Conteudo /></Suspense>;
}
