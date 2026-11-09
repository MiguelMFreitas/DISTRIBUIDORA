const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const peso = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 0 });

export const fmtMoeda = (v: number | null | undefined) => moeda.format(Number(v ?? 0));
export const fmtQtd = (v: number | null | undefined) => numero.format(Number(v ?? 0));
export const fmtPeso = (v: number | null | undefined) => `${peso.format(Number(v ?? 0))} kg`;

export const UNIDADES = {
  CX: { sigla: "CX", nome: "Caixa", meia: "Meia caixa" },
  FD: { sigla: "FD", nome: "Fardo", meia: "Meio fardo" },
  LT: { sigla: "LT", nome: "Litro", meia: "Meio litro" },
  UN: { sigla: "UN", nome: "Unidade", meia: "Meia unidade" },
} as const;

export function fmtData(d: string | Date) {
  const x = typeof d === "string" ? new Date(d.length === 10 ? d + "T12:00:00" : d) : d;
  return x.toLocaleDateString("pt-BR");
}
export function fmtDataHora(d: string | Date) {
  const x = typeof d === "string" ? new Date(d) : d;
  return x.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
export const TURNOS = { manha: "Manhã", tarde: "Tarde" } as const;

/** Data de hoje no fuso local, no formato AAAA-MM-DD */
export function hojeISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Login por nome de usuário: o Supabase precisa de um e-mail, então montamos um interno. */
export const DOMINIO_LOGIN = "usuarios.distribuidora.app";
export const emailDoUsuario = (u: string) => `${u.trim().toLowerCase()}@${DOMINIO_LOGIN}`;

export function normalizar(s: string | null | undefined) {
  return (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Busca por palavras: "skol lata" acha "CERVEJA SKOL LATA 350ML" */
export function combina(texto: string, busca: string) {
  const t = normalizar(texto);
  return normalizar(busca)
    .split(/\s+/)
    .filter(Boolean)
    .every((p) => t.includes(p));
}

export function erroMsg(e: unknown): string {
  if (!e) return "Erro desconhecido";
  if (typeof e === "string") return e;
  const x = e as { message?: string; details?: string };
  return x.message || "Erro desconhecido";
}

/**
 * Ordem alfabética do português: "ÁGUA" fica junto do "A", maiúscula = minúscula,
 * e números em ordem natural ("REFRI 2L" antes de "REFRI 10L").
 */
const colador = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
export const alfa = (a: string | null | undefined, b: string | null | undefined) => colador.compare(a ?? "", b ?? "");
export function ordenarPor<T>(lista: T[], campo: (x: T) => string | null | undefined) {
  return [...lista].sort((x, y) => alfa(campo(x), campo(y)));
}
