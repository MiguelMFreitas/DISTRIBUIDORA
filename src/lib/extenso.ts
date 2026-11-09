/** Valor em reais por extenso: 1250.5 → "mil duzentos e cinquenta reais e cinquenta centavos" */
const UNI = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CEM = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function ate999(n: number): string {
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100, partes: string[] = [];
  if (c) partes.push(CEM[c]);
  if (r) partes.push(r < 20 ? UNI[r] : DEZ[Math.floor(r / 10)] + (r % 10 ? " e " + UNI[r % 10] : ""));
  return partes.join(" e ");
}

function inteiro(n: number): string {
  if (n === 0) return "zero";
  const grupos: { valor: number; texto: string }[] = [];
  const bi = Math.floor(n / 1e9), mi = Math.floor((n % 1e9) / 1e6), mil = Math.floor((n % 1e6) / 1e3), un = n % 1e3;
  if (bi) grupos.push({ valor: bi, texto: ate999(bi) + (bi === 1 ? " bilhão" : " bilhões") });
  if (mi) grupos.push({ valor: mi, texto: ate999(mi) + (mi === 1 ? " milhão" : " milhões") });
  if (mil) grupos.push({ valor: mil, texto: mil === 1 ? "mil" : ate999(mil) + " mil" });
  if (un) grupos.push({ valor: un, texto: ate999(un) });
  // "mil e duzentos", "dois mil e cinco", mas "mil duzentos e cinquenta"
  return grupos.reduce((txt, g, i) => {
    if (i === 0) return g.texto;
    const ultimo = i === grupos.length - 1;
    const usaE = ultimo && (g.valor < 100 || g.valor % 100 === 0);
    return txt + (usaE ? " e " : " ") + g.texto;
  }, "");
}

export function valorPorExtenso(valor: number): string {
  const centavosTotais = Math.round(Math.abs(valor) * 100);
  const reais = Math.floor(centavosTotais / 100), cent = centavosTotais % 100;
  const partes: string[] = [];
  if (reais) {
    const redondo = reais % 1e6 === 0; // "um milhão de reais"
    partes.push(`${inteiro(reais)}${redondo ? " de" : ""} ${reais === 1 ? "real" : "reais"}`);
  }
  if (cent) partes.push(`${inteiro(cent)} ${cent === 1 ? "centavo" : "centavos"}`);
  return partes.length ? partes.join(" e ") : "zero real";
}
