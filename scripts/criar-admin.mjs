// Cria o primeiro administrador do sistema.
// Uso:  node --env-file=.env.local scripts/criar-admin.mjs <usuario> <senha> "<Nome>"
// Ex.:  node --env-file=.env.local scripts/criar-admin.mjs miguel minhasenha123 "Miguel"
import { createClient } from "@supabase/supabase-js";

const [usuario, senha, nome] = process.argv.slice(2);
if (!usuario || !senha || !nome) {
  console.error('Uso: node --env-file=.env.local scripts/criar-admin.mjs <usuario> <senha> "<Nome>"');
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !chave) { console.error("Faltam NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local"); process.exit(1); }

const sb = createClient(url, chave, { auth: { persistSession: false } });
const u = usuario.trim().toLowerCase();
const { data, error } = await sb.auth.admin.createUser({ email: `${u}@usuarios.distribuidora.app`, password: senha, email_confirm: true });
if (error) { console.error("Erro ao criar login:", error.message); process.exit(1); }
const { error: e2 } = await sb.from("perfis").insert({ id: data.user.id, nome, usuario: u, admin: true, permissoes: [] });
if (e2) { await sb.auth.admin.deleteUser(data.user.id); console.error("Erro ao criar perfil:", e2.message); process.exit(1); }
console.log(`Administrador "${nome}" criado. Entre com o usuário "${u}".`);
