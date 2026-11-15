"use client";

import { useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { Botao, Modal } from "@/components/ui";

/**
 * Pede a senha de quem está logado antes de vender abaixo do preço mínimo.
 * Confere a senha no servidor (precisa de internet).
 */
export function ConfirmarSenha({ aberto, aoFechar, aoConfirmar, children }: {
  aberto: boolean;
  aoFechar: () => void;
  aoConfirmar: () => void;
  children?: React.ReactNode;
}) {
  const sb = supabaseNavegador();
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [conferindo, setConferindo] = useState(false);

  function fechar() { setSenha(""); setErro(""); aoFechar(); }

  async function conferir(e: React.FormEvent) {
    e.preventDefault();
    if (!senha) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return setErro("Sem internet: não dá para conferir a senha agora.");
    setConferindo(true);
    setErro("");
    const { data } = await sb.auth.getUser();
    const email = data.user?.email;
    const { error } = email ? await sb.auth.signInWithPassword({ email, password: senha }) : { error: new Error("sem usuário") };
    setConferindo(false);
    if (error) return setErro(email ? "Senha errada." : "Entre de novo no sistema.");
    setSenha("");
    aoConfirmar();
  }

  return (
    <Modal aberto={aberto} aoFechar={fechar} titulo="Abaixo do preço mínimo" largura="max-w-md">
      <form onSubmit={conferir} className="space-y-3">
        {children}
        <label className="rotulo" htmlFor="senha-confirmar">Digite a sua senha para confirmar</label>
        <input id="senha-confirmar" className="campo" type="password" autoFocus autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
        {erro && <p className="text-sm font-semibold text-red-600">{erro}</p>}
        <div className="flex justify-end gap-2">
          <Botao type="button" variante="fantasma" onClick={fechar}>Cancelar</Botao>
          <Botao type="submit" carregando={conferindo}>Confirmar</Botao>
        </div>
      </form>
    </Modal>
  );
}
