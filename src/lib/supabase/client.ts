import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { urlSupabase } from "@/lib/supabase/url";

let cliente: SupabaseClient | null = null;

/** Mesmo nome de cookie no navegador e no servidor */
export const COOKIE_SESSAO = "sb-distribuidora-auth";

export function supabaseNavegador(): SupabaseClient {
  // na renderização do servidor não guarda: o cliente certo é criado no navegador
  if (typeof window === "undefined") {
    return createBrowserClient(urlSupabase(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookieOptions: { name: COOKIE_SESSAO } });
  }
  if (!cliente) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_VIA_SITE === "1" && typeof window !== "undefined"
      ? `${window.location.origin}/sb`
      : urlSupabase();
    cliente = createBrowserClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookieOptions: { name: COOKIE_SESSAO },
    });
  }
  return cliente;
}
