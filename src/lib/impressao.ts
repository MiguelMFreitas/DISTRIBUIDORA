/** Impressoras da distribuidora (o site não escolhe a impressora sozinho: só avisa qual usar) */
export const IMPRESSORA_CUPOM = "ELGIN i9";
export const IMPRESSORA_FOLHA = "EPSON L4150";

/** Abre a tela de impressão dos pedidos numa nova aba (a lista vai pelo localStorage para não estourar a URL) */
export function abrirImpressaoPedidos(ids: string[]) {
  try { localStorage.setItem("imprimir_pedidos", JSON.stringify(ids)); } catch {}
  window.open("/imprimir/pedidos?sel=1", "_blank");
}
