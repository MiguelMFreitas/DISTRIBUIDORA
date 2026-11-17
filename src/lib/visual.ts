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

const LOCAL = "visual";
const PREVIA = "visual_previa";

/** Roda antes de a página aparecer (no <head>): evita piscar com o visual errado */
export const SCRIPT_VISUAL = `(function(){try{var v=localStorage.getItem("${LOCAL}")||"${VISUAL_PADRAO}";var p=sessionStorage.getItem("${PREVIA}");if(p)v=p;document.documentElement.setAttribute("data-visual",v)}catch(e){document.documentElement.setAttribute("data-visual","${VISUAL_PADRAO}")}})()`;

export function aplicarVisual(id: IdVisual) {
  document.documentElement.setAttribute("data-visual", id);
  window.dispatchEvent(new CustomEvent("visual-mudou"));
}
export function visualSalvo(): IdVisual {
  try { const v = localStorage.getItem(LOCAL); return ehVisual(v) ? v : VISUAL_PADRAO; } catch { return VISUAL_PADRAO; }
}
export function guardarVisual(id: IdVisual) {
  try { localStorage.setItem(LOCAL, id); } catch {}
}
export function visualPrevia(): IdVisual | null {
  try { const v = sessionStorage.getItem(PREVIA); return ehVisual(v) ? v : null; } catch { return null; }
}
export function comecarPrevia(id: IdVisual) {
  try { sessionStorage.setItem(PREVIA, id); } catch {}
  aplicarVisual(id);
}
export function sairPrevia() {
  try { sessionStorage.removeItem(PREVIA); } catch {}
  aplicarVisual(visualSalvo());
}
