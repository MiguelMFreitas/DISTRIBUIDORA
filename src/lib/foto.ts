/**
 * Diminui a foto antes de enviar (celular tira fotos de 3–8 MB).
 * Fica com no máximo 1600 px no lado maior, em JPEG: normalmente 150–400 KB, ainda dá para ler a km.
 */
export async function comprimirFoto(arquivo: File, maxLado = 1600, qualidade = 0.72): Promise<Blob> {
  const img = await carregar(arquivo);
  const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
  const w = Math.round(img.width * escala), h = Math.round(img.height * escala);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
  return new Promise((ok, erro) => canvas.toBlob((b) => (b ? ok(b) : erro(new Error("Não deu para ler a foto."))), "image/jpeg", qualidade));
}

function carregar(arquivo: File): Promise<HTMLImageElement | ImageBitmap> {
  if ("createImageBitmap" in window) {
    // respeita a orientação da foto (celular em pé)
    return createImageBitmap(arquivo, { imageOrientation: "from-image" }).catch(() => viaImg(arquivo));
  }
  return viaImg(arquivo);
}

function viaImg(arquivo: File): Promise<HTMLImageElement> {
  return new Promise((ok, erro) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); ok(img); };
    img.onerror = () => { URL.revokeObjectURL(url); erro(new Error("Não deu para abrir a foto.")); };
    img.src = url;
  });
}
