/**
 * Dados da empresa que aparecem na página pública (endereço do site), na
 * Política de privacidade e nos Termos. Ficam em configuracoes ("empresa")
 * e o administrador muda em Sistema → Dados da empresa.
 */
export type Empresa = {
  nome: string;
  razao_social: string;
  cnpj: string;
  endereco: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  telefone: string;
  whatsapp: string;
  email: string;
  horario: string;
  sobre: string;
};

export const SOBRE_PADRAO =
  "Distribuidora de bebidas e alimentos para mercadinhos, bares, restaurantes e depósitos. Vendemos por fardo e por caixa e entregamos no seu comércio.";

export const EMPRESA_PADRAO: Empresa = {
  nome: process.env.NEXT_PUBLIC_EMPRESA_NOME || "Distribuidora Freitas",
  razao_social: "", cnpj: "", endereco: "", bairro: "", cidade: "", uf: "", cep: "",
  telefone: "", whatsapp: "", email: "", horario: "", sobre: SOBRE_PADRAO,
};

/** junta o que está gravado com o padrão (campo vazio ou faltando = padrão) */
export function comPadrao(v: Partial<Empresa> | null | undefined): Empresa {
  const e = { ...EMPRESA_PADRAO };
  for (const k of Object.keys(e) as (keyof Empresa)[]) {
    const x = v?.[k];
    if (typeof x === "string" && x.trim()) e[k] = x.trim();
  }
  return e;
}

const digitos = (s: string) => s.replace(/\D/g, "");

export function fmtCNPJ(s: string) {
  const d = digitos(s);
  return d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : s;
}
export function fmtCEP(s: string) {
  const d = digitos(s);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : s;
}
/** link wa.me (põe o 55 do Brasil se faltar) */
export function linkWhatsApp(s: string, texto?: string) {
  let d = digitos(s);
  if (!d) return null;
  if (d.length <= 11) d = "55" + d;
  return `https://wa.me/${d}${texto ? `?text=${encodeURIComponent(texto)}` : ""}`;
}
/** "Rua X, 10 · Bairro · Cidade/UF · CEP 00000-000" (só o que estiver preenchido) */
export function enderecoCompleto(e: Empresa) {
  const cidade = [e.cidade, e.uf].filter(Boolean).join("/");
  return [e.endereco, e.bairro, cidade, e.cep && `CEP ${fmtCEP(e.cep)}`].filter(Boolean).join(" · ");
}
