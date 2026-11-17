"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg } from "@/lib/formato";
import {
  VISUAIS, aplicarVisual, ehVisual, guardarVisual, sairPrevia, visualPrevia, visualSalvo, type IdVisual,
} from "@/lib/visual";
import { avisar } from "./ui";

/** Busca o visual escolhido pelo administrador e deixa este aparelho igual. */
export function SincronizaVisual() {
  useEffect(() => {
    let vivo = true;
    supabaseNavegador().from("configuracoes").select("valor").eq("chave", "visual").maybeSingle()
      .then(({ data, error }) => {
        if (!vivo || error) return;               // sem internet ou banco antigo: fica como está
        const id = (data?.valor as { id?: string } | null)?.id;
        if (!ehVisual(id) || id === visualSalvo()) return;
        guardarVisual(id);
        if (!visualPrevia()) aplicarVisual(id);
      });
    return () => { vivo = false; };
  }, []);
  return null;
}

/** Grava o visual para todo mundo (só administrador). */
export async function usarParaTodos(id: IdVisual) {
  const { error } = await supabaseNavegador().from("configuracoes").upsert({ chave: "visual", valor: { id } });
  if (error) {
    avisar(/configuracoes|relation|42P01/i.test(error.message) ? "Rode a atualização 24 no Supabase para poder escolher o visual." : erroMsg(error), "erro");
    return false;
  }
  guardarVisual(id);
  sairPrevia();
  return true;
}

/** Barra que aparece enquanto o administrador está vendo um visual em prévia. */
export function BarraPrevia({ admin }: { admin: boolean }) {
  const [previa, setPrevia] = useState<IdVisual | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    const ler = () => setPrevia(visualPrevia());
    ler();
    window.addEventListener("visual-mudou", ler);
    return () => window.removeEventListener("visual-mudou", ler);
  }, []);
  if (!previa) return null;
  const v = VISUAIS.find((x) => x.id === previa)!;
  return (
    <div className="nao-imprimir fixed inset-x-0 bottom-0 z-40 flex justify-center p-3 pointer-events-none">
      <div className="pointer-events-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-2xl dark:bg-zinc-800">
        <span className="mr-auto"><b>Prévia: {v.nome}</b> · navegue pelo sistema para ver como fica.</span>
        <Link href="/aparencia" className="rounded-lg px-3 py-1.5 font-semibold text-zinc-300 hover:bg-white/10">Outros</Link>
        <button onClick={() => sairPrevia()} className="rounded-lg px-3 py-1.5 font-semibold text-zinc-300 hover:bg-white/10">Sair da prévia</button>
        {admin && (
          <button disabled={salvando} onClick={async () => { setSalvando(true); if (await usarParaTodos(previa)) avisar(`Visual “${v.nome}” ligado para todos`); setSalvando(false); }}
            className="rounded-lg bg-white px-3 py-1.5 font-bold text-zinc-900 disabled:opacity-60">Usar este para todos</button>
        )}
      </div>
    </div>
  );
}
