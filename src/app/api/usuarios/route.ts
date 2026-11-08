import { NextResponse } from "next/server";
import { supabaseAdmin, supabaseServidor } from "@/lib/supabase/server";
import { emailDoUsuario } from "@/lib/formato";
import { PERMISSOES } from "@/lib/tipos";

const VALIDAS = new Set(PERMISSOES.map((p) => p.chave));

async function exigirAdmin() {
  const sb = await supabaseServidor();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from("perfis").select("id, admin, ativo").eq("id", user.id).single();
  return data?.admin && data.ativo ? data : null;
}

function limpar(body: Record<string, unknown>) {
  const permissoes = Array.isArray(body.permissoes) ? body.permissoes.filter((p): p is string => typeof p === "string" && VALIDAS.has(p as never)) : [];
  const desconto = Math.min(100, Math.max(0, Number(body.desconto_max) || 0));
  return {
    nome: String(body.nome ?? "").trim(),
    admin: !!body.admin,
    permissoes,
    desconto_max: desconto,
    telefone: body.telefone ? String(body.telefone).trim() : null,
    ativo: body.ativo === undefined ? true : !!body.ativo,
  };
}

const erro = (msg: string, status = 400) => NextResponse.json({ erro: msg }, { status });

/** Criar usuário */
export async function POST(req: Request) {
  if (!(await exigirAdmin())) return erro("Só administradores criam usuários.", 403);
  const body = await req.json();
  const usuario = String(body.usuario ?? "").trim().toLowerCase();
  const senha = String(body.senha ?? "");
  const dados = limpar(body);
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) return erro("Usuário deve ter de 3 a 30 letras, números, ponto, traço ou _ (sem espaço e sem acento).");
  if (senha.length < 6) return erro("A senha precisa ter pelo menos 6 caracteres.");
  if (!dados.nome) return erro("Informe o nome.");

  const adm = supabaseAdmin();
  const { data: criado, error } = await adm.auth.admin.createUser({ email: emailDoUsuario(usuario), password: senha, email_confirm: true });
  if (error || !criado.user) return erro(error?.message.includes("already") ? "Esse usuário já existe." : error?.message ?? "Erro ao criar");

  const { error: e2 } = await adm.from("perfis").insert({ id: criado.user.id, usuario, ...dados });
  if (e2) {
    await adm.auth.admin.deleteUser(criado.user.id);
    return erro(e2.message);
  }
  return NextResponse.json({ ok: true });
}

/** Editar usuário (e trocar senha, se vier) */
export async function PATCH(req: Request) {
  const eu = await exigirAdmin();
  if (!eu) return erro("Só administradores editam usuários.", 403);
  const body = await req.json();
  const id = String(body.id ?? "");
  const dados = limpar(body);
  if (id === eu.id && (!dados.admin || !dados.ativo)) return erro("Você não pode tirar o seu próprio acesso de administrador.");
  const adm = supabaseAdmin();
  const { error } = await adm.from("perfis").update(dados).eq("id", id);
  if (error) return erro(error.message);
  if (body.senha) {
    if (String(body.senha).length < 6) return erro("A senha precisa ter pelo menos 6 caracteres.");
    const { error: e2 } = await adm.auth.admin.updateUserById(id, { password: String(body.senha) });
    if (e2) return erro(e2.message);
  }
  return NextResponse.json({ ok: true });
}

/** Apagar usuário */
export async function DELETE(req: Request) {
  const eu = await exigirAdmin();
  if (!eu) return erro("Só administradores apagam usuários.", 403);
  const { id } = await req.json();
  if (id === eu.id) return erro("Você não pode apagar a sua própria conta.");
  const { error } = await supabaseAdmin().auth.admin.deleteUser(String(id));
  if (error) return erro(error.message);
  return NextResponse.json({ ok: true });
}
