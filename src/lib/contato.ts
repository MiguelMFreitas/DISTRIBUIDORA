import { fmtMoeda } from "./formato";

/** Campos dos pedidos feitos pelo link (o cliente não é cadastrado: os dados ficam no pedido) */
export const CAMPOS_CONTATO = "origem, contato_nome, contato_telefone, contato_endereco, contato_bairro, contato_referencia, pagamento, troco_para";

export type Contato = {
  origem?: "sistema" | "link";
  contato_nome?: string | null;
  contato_telefone?: string | null;
  contato_endereco?: string | null;
  contato_bairro?: string | null;
  contato_referencia?: string | null;
  pagamento?: "dinheiro" | "pix" | null;
  troco_para?: number | null;
};

export const fmtTelefone = (t: string | null | undefined) => {
  const d = (t ?? "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t ?? "";
};

/** Pedido pelo link: mostra o nome, endereço e telefone que o cliente digitou no lugar do cliente genérico */
export function comContato<P extends Contato & { clientes: object }>(p: P): P {
  if (p.origem !== "link" || !p.contato_nome) return p;
  return {
    ...p,
    clientes: {
      ...p.clientes,
      razao_social: p.contato_nome, nome_fantasia: null, endereco: p.contato_endereco ?? null, numero: null,
      bairro: p.contato_bairro ?? null, cidade: null, referencia: p.contato_referencia ?? null, telefone: fmtTelefone(p.contato_telefone),
    },
  };
}

/** "Pix", "Dinheiro · sem troco" ou "Dinheiro · troco para R$ 100,00 (levar R$ 20,00)" */
export function textoPagamento(p: Contato & { total?: number }): string | null {
  if (p.pagamento === "pix") return "Pix";
  if (p.pagamento !== "dinheiro") return null;
  if (!p.troco_para) return "Dinheiro · sem troco";
  const troco = Number(p.troco_para) - Number(p.total ?? 0);
  return `Dinheiro · troco para ${fmtMoeda(p.troco_para)}${troco > 0 ? ` (levar ${fmtMoeda(troco)} de troco)` : ""}`;
}
