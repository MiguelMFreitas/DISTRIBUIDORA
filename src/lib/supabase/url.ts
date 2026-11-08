/** Aceita o endereço do Supabase colado com "/" ou "/rest/v1" no fim e deixa só o principal */
export function urlSupabase() {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/(rest|auth)\/v1$/, "");
}
