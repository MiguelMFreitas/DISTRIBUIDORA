/**
 * Modelos de visual do sistema. As cores e fontes de cada um estão em globals.css
 * (blocos [data-visual="..."]); aqui ficam o nome, a descrição e as cores da miniatura.
 *
 * Como funciona:
 *  - o administrador escolhe em Aparência e grava em configuracoes ("visual"): vale para todos
 *  - cada aparelho guarda uma cópia (localStorage) para abrir já com o visual certo, até sem internet
 *  - "Ver no sistema" é uma prévia só neste aparelho (sessionStorage) até tocar em "Usar este"
 */
export type IdVisual = "classico" | "azul" | "verde" | "vermelho" | "escuro";

export type Visual = {
  id: IdVisual;
  nome: string;
  descricao: string;
  /** cores da miniatura na tela Aparência */
  mini: { menu: string; menuTexto: string; marca: string; fundo: string; cartao: string; texto: string; borda: string; titulo: "condensado" | "normal" };
};

export const VISUAIS: Visual[] = [
  {
    id: "classico", nome: "Clássico", descricao: "O de hoje: menu preto, laranja e títulos em letra estreita maiúscula.",
    mini: { menu: "#18181b", menuTexto: "#d4d4d8", marca: "#d98a0b", fundo: "#f4f4f5", cartao: "#ffffff", texto: "#18181b", borda: "#e4e4e7", titulo: "condensado" },
  },
  {
    id: "azul", nome: "Azul moderno", descricao: "Claro e limpo: menu branco, azul, letra comum e cantos bem arredondados.",
    mini: { menu: "#ffffff", menuTexto: "#475569", marca: "#2563eb", fundo: "#f1f5f9", cartao: "#ffffff", texto: "#0f172a", borda: "#e2e8f0", titulo: "normal" },
  },
  {
    id: "verde", nome: "Verde bebidas", descricao: "Menu verde-escuro, detalhes em verde e títulos arredondados.",
    mini: { menu: "#0c3b2a", menuTexto: "#c6e3d3", marca: "#16a34a", fundo: "#eef3ef", cartao: "#ffffff", texto: "#14231b", borda: "#dfe7e1", titulo: "normal" },
  },
  {
    id: "vermelho", nome: "Vermelho forte", descricao: "Cara de distribuidora de cerveja: menu vermelho, cartões com faixa vermelha e títulos fortes.",
    mini: { menu: "#8f1515", menuTexto: "#fde2e2", marca: "#dc2626", fundo: "#f5f5f4", cartao: "#ffffff", texto: "#1c1917", borda: "#e7e5e4", titulo: "condensado" },
  },
  {
    id: "escuro", nome: "Escuro", descricao: "Fundo escuro com amarelo: cansa menos a vista à noite e no sol forte.",
    mini: { menu: "#09090b", menuTexto: "#a1a1aa", marca: "#f59e0b", fundo: "#18181b", cartao: "#27272a", texto: "#f4f4f5", borda: "#3f3f46", titulo: "normal" },
  },
];

export const VISUAL_PADRAO: IdVisual = "classico";
export const ehVisual = (x: unknown): x is IdVisual => VISUAIS.some((v) => v.id === x);

/* ---------------- layouts (arrumação das telas) ---------------- */
export type IdLayout = "lateral" | "grupos" | "topo" | "areas";
export type Layout = { id: IdLayout; nome: string; descricao: string; celular: string };
export const LAYOUTS: Layout[] = [
  { id: "lateral", nome: "Lateral", descricao: "O de hoje: todas as telas numa lista só, no menu da esquerda.", celular: "Botão “Menu” no alto abre a lista." },
  { id: "grupos", nome: "Menu por grupos", descricao: "Menu da esquerda separado em Vendas, Entregas, Clientes, Produtos, Gestão e Sistema, com busca de tela.", celular: "Barra de botões embaixo com as telas mais usadas e “Mais”." },
  { id: "topo", nome: "Menu no topo", descricao: "O menu vira uma barra em cima, com os grupos que abrem uma lista. A tela fica mais larga.", celular: "Barra de botões embaixo com as telas mais usadas e “Mais”." },
  { id: "areas", nome: "Áreas com abas", descricao: "Faixa fina com as áreas na esquerda; as telas de cada área ficam em abas no alto da página.", celular: "Áreas na barra de baixo e as telas em abas no alto." },
];
export const LAYOUT_PADRAO: IdLayout = "lateral";
export const ehLayout = (x: unknown): x is IdLayout => LAYOUTS.some((v) => v.id === x);

const LOCAL = "visual";
const PREVIA = "visual_previa";
const LOCAL_L = "layout";
const PREVIA_L = "layout_previa";

/** Roda antes de a página aparecer (no <head>): evita piscar com o visual ou o layout errado */
export const SCRIPT_VISUAL = `(function(){var h=document.documentElement;try{var v=sessionStorage.getItem("${PREVIA}")||localStorage.getItem("${LOCAL}")||"${VISUAL_PADRAO}";var l=sessionStorage.getItem("${PREVIA_L}")||localStorage.getItem("${LOCAL_L}")||"${LAYOUT_PADRAO}";h.setAttribute("data-visual",v);h.setAttribute("data-layout",l)}catch(e){h.setAttribute("data-visual","${VISUAL_PADRAO}");h.setAttribute("data-layout","${LAYOUT_PADRAO}")}})()`;

function avisarMudanca() { window.dispatchEvent(new CustomEvent("visual-mudou")); }
const ler = (st: () => Storage, k: string) => { try { return st().getItem(k); } catch { return null; } };
const gravar = (st: () => Storage, k: string, v: string | null) => { try { if (v == null) st().removeItem(k); else st().setItem(k, v); } catch {} };

export function aplicarVisual(id: IdVisual) {
  document.documentElement.setAttribute("data-visual", id);
  avisarMudanca();
}
export function aplicarLayout(id: IdLayout) {
  document.documentElement.setAttribute("data-layout", id);
  avisarMudanca();
}
export function visualSalvo(): IdVisual { const v = ler(() => localStorage, LOCAL); return ehVisual(v) ? v : VISUAL_PADRAO; }
export function layoutSalvo(): IdLayout { const v = ler(() => localStorage, LOCAL_L); return ehLayout(v) ? v : LAYOUT_PADRAO; }
export function guardarVisual(id: IdVisual) { gravar(() => localStorage, LOCAL, id); }
export function guardarLayout(id: IdLayout) { gravar(() => localStorage, LOCAL_L, id); }
export function visualPrevia(): IdVisual | null { const v = ler(() => sessionStorage, PREVIA); return ehVisual(v) ? v : null; }
export function layoutPrevia(): IdLayout | null { const v = ler(() => sessionStorage, PREVIA_L); return ehLayout(v) ? v : null; }
export function comecarPrevia(id: IdVisual) { gravar(() => sessionStorage, PREVIA, id); aplicarVisual(id); }
export function comecarPreviaLayout(id: IdLayout) { gravar(() => sessionStorage, PREVIA_L, id); aplicarLayout(id); }
/** sai da prévia de cores e de layout e volta ao que está em uso */
export function sairPrevia() {
  gravar(() => sessionStorage, PREVIA, null);
  gravar(() => sessionStorage, PREVIA_L, null);
  document.documentElement.setAttribute("data-visual", visualSalvo());
  document.documentElement.setAttribute("data-layout", layoutSalvo());
  avisarMudanca();
}
