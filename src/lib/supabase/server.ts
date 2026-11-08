import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { urlSupabase } from "@/lib/supabase/url";

export async function supabaseServidor() {
  const store = await cookies();
  return createServerClient(
    urlSupabase(),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: { name: "sb-distribuidora-auth" },
      cookies: {
        getAll: () => store.getAll(),
        setAll: (lista) => {
          try {
            lista.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            // chamado de um Server Component: o middleware renova a sessão
          }
        },
      },
    },
  );
}

/** Cliente com a chave secreta. Só para rotas do servidor que já checaram se é admin. */
export function supabaseAdmin() {
  return createClient(urlSupabase(), process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
