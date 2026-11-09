import { fmtDataHora, fmtMoeda, fmtPeso, fmtQtd } from "@/lib/formato";

export type Ped = {
  id: string; numero: number; total: number; peso_kg: number; observacao: string | null; feito_em: string; status: string;
  clientes: { razao_social: string; nome_fantasia: string | null; cpf_cnpj: string | null; endereco: string | null; numero: string | null; bairro: string | null; cidade: string | null; referencia: string | null; telefone: string | null; rotas: { nome: string } | null };
  perfis: { nome: string } | null;
  cargas: { numero: number; nome: string | null; motoristas: { nome: string } | null } | null;
  pedido_itens: { id: string; quantidade: number; preco_unit: number; desconto_pct: number; total: number; produtos: { nome: string; codigo: string | null; unidade: string; categorias: { ordem: number } | null } }[];
};

export const SELECT_PEDIDO_IMPRESSAO = "id, numero, total, peso_kg, observacao, feito_em, status, clientes(razao_social, nome_fantasia, cpf_cnpj, endereco, numero, bairro, cidade, referencia, telefone, rotas(nome)), perfis!pedidos_vendedor_id_fkey(nome), cargas(numero:numero_dia, nome, motoristas(nome)), pedido_itens(id, quantidade, preco_unit, desconto_pct, total, produtos(nome, codigo, unidade, categorias(ordem)))";


/** Pedido no formato de cupom (impressora térmica): só preto, letras grandes, uma coluna */
export function Cupom({ p, empresa }: { p: Ped; empresa: string }) {
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


/** Itens na ordem das categorias, igual ao caminhão */
export function ordenarItens(lista: Ped[]) {
  lista.forEach((p) => p.pedido_itens.sort((x, y) => (x.produtos.categorias?.ordem ?? 9999) - (y.produtos.categorias?.ordem ?? 9999) || x.produtos.nome.localeCompare(y.produtos.nome, "pt-BR", { sensitivity: "base", numeric: true })));
  return lista;
}
