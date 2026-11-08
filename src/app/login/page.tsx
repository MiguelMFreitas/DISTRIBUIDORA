"use client";

import { useState } from "react";
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

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setCarregando(true);
    const { error } = await supabaseNavegador().auth.signInWithPassword({ email: emailDoUsuario(usuario), password: senha });
    if (error) {
      setCarregando(false);
      setErro(error.message.includes("Invalid") ? "Usuário ou senha incorretos." : "Não foi possível entrar. Verifique a internet.");
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
