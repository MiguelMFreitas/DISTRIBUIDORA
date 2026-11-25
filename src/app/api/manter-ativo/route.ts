import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * Chamado todo dia pelo Vercel (vercel.json → crons).
 * O plano gratuito do Supabase pausa o banco depois de uns 7 dias sem uso;
 * uma consulta pequena por dia mantém o banco ligado.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const { error, count } = await supabaseAdmin().from("perfis").select("id", { count: "exact", head: true });
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, usuarios: count, quando: new Date().toISOString() });
}
