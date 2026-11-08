"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseNavegador } from "@/lib/supabase/client";
import { emailDoUsuario } from "@/lib/formato";
import { Botao } from "@/components/ui";

export default function Login() {
  const router = useRouter();
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(false);

  // o servidor manda de volta para cá quando o login existe mas não tem perfil no sistema
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("inativo")) {
      setErro("Sua senha está certa, mas esse usuário não tem cadastro no sistema (tabela perfis) ou está desativado. Fale com o administrador.");
      supabaseNavegador().auth.signOut();
    }
  }, []);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setCarregando(true);
    const { error } = await supabaseNavegador().auth.signInWithPassword({ email: emailDoUsuario(usuario), password: senha });
    if (error) {
      setCarregando(false);
      const m = error.message.toLowerCase();
      setErro(
        m.includes("invalid login") ? "Usuário ou senha incorretos."
        : m.includes("not confirmed") ? "Esse usuário ainda não foi confirmado no Supabase (marque “Auto Confirm User” ao criar)."
        : m.includes("api key") || m.includes("apikey") ? "O site está com a chave do Supabase errada. Confira as variáveis no Vercel."
        : m.includes("fetch") || m.includes("network") ? "Não foi possível falar com o servidor. Verifique a internet ou o endereço do Supabase no Vercel."
        : `Não foi possível entrar: ${error.message}`,
      );
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="grid min-h-full place-items-center p-4">
      <form onSubmit={entrar} className="cartao w-full max-w-sm space-y-4 p-6 shadow-sm">
        <div>
          <div className="mb-3 grid size-12 place-items-center rounded-xl bg-marca-500 text-2xl text-white">🚚</div>
          <h1 className="titulo text-3xl">{process.env.NEXT_PUBLIC_EMPRESA_NOME || "Distribuidora"}</h1>
          <p className="text-sm text-zinc-500">Entre com o seu usuário e senha.</p>
        </div>
        <div>
          <label className="rotulo" htmlFor="u">Usuário</label>
          <input id="u" className="campo" autoComplete="username" autoCapitalize="none" value={usuario} onChange={(e) => setUsuario(e.target.value)} required />
        </div>
        <div>
          <label className="rotulo" htmlFor="s">Senha</label>
          <input id="s" type="password" className="campo" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </div>
        {erro && <p className="rounded-lg bg-red-50 p-2 text-sm font-medium text-red-700 dark:bg-red-500/10 dark:text-red-300">{erro}</p>}
        <Botao type="submit" tamanho="g" className="w-full" carregando={carregando}>Entrar</Botao>
      </form>
    </main>
  );
}
