import { redirect } from "next/navigation";
import { supabaseServidor } from "@/lib/supabase/server";
import type { Perfil, Permissao } from "@/lib/tipos";

export async function perfilAtual(): Promise<Perfil> {
  const sb = await supabaseServidor();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data } = await sb.from("perfis").select("*").eq("id", user.id).single();
  if (!data || !data.ativo) redirect("/login?inativo=1");
  return data as Perfil;
}

export function pode(p: Perfil, perm: Permissao) {
  return p.ativo && (p.admin || p.permissoes.includes(perm));
}

/** Para onde mandar o usuário quando ele entra */
export function inicioDoUsuario(p: Perfil) {
  const soVende = !p.admin && p.permissoes.length > 0 && p.permissoes.every((x) => x === "pedidos_criar");
  return soVende ? "/vender" : "/painel";
}
