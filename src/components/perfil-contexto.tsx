"use client";

import { createContext, useContext } from "react";
import type { Perfil, Permissao } from "@/lib/tipos";

const Ctx = createContext<Perfil | null>(null);

export function ProvedorPerfil({ perfil, children }: { perfil: Perfil; children: React.ReactNode }) {
  return <Ctx.Provider value={perfil}>{children}</Ctx.Provider>;
}

export function usePerfil() {
  const p = useContext(Ctx);
  if (!p) throw new Error("usePerfil fora do ProvedorPerfil");
  return p;
}

export function usePode() {
  const p = usePerfil();
  return (perm: Permissao) => p.ativo && (p.admin || p.permissoes.includes(perm));
}

/** Mostra o conteúdo só para quem tem a permissão */
export function Exige({ perm, admin, children }: { perm?: Permissao; admin?: boolean; children: React.ReactNode }) {
  const p = usePerfil();
  const ok = admin ? p.admin : perm ? p.admin || p.permissoes.includes(perm) : true;
  if (!ok) {
    return (
      <div className="cartao p-8 text-center">
        <p className="titulo">Sem acesso</p>
        <p className="text-zinc-500">Você não tem permissão para ver esta página. Fale com um administrador.</p>
      </div>
    );
  }
  return <>{children}</>;
}
