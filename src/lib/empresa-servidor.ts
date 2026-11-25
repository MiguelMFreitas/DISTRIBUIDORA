import { supabaseAdmin } from "@/lib/supabase/server";
import { comPadrao, type Empresa } from "@/lib/empresa";

/** Lê os dados da empresa e se o link de pedidos está ligado (para a página pública, sem login). */
export async function lerEmpresa(): Promise<{ empresa: Empresa; linkLigado: boolean }> {
  try {
    const { data } = await supabaseAdmin().from("configuracoes").select("chave, valor").in("chave", ["empresa", "link_pedidos"]);
    const de = (k: string) => (data ?? []).find((r) => r.chave === k)?.valor as Record<string, unknown> | undefined;
    return { empresa: comPadrao(de("empresa") as Partial<Empresa>), linkLigado: de("link_pedidos")?.ligado === true };
  } catch {
    // banco fora do ar ou sem a chave secreta: mostra o padrão
    return { empresa: comPadrao(null), linkLigado: false };
  }
}
