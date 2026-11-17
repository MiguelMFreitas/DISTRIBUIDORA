"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg } from "@/lib/formato";
import {
  LAYOUTS, LAYOUT_PADRAO, VERSAO_ESCOLHA, VISUAIS, VISUAL_PADRAO, aplicarLayout, aplicarVisual, ehLayout, ehVisual,
  esquecerEscolhaLocal, guardarLayout, guardarVisual, layoutPrevia, layoutSalvo, sairPrevia, temEscolhaLocal, visualPrevia, visualSalvo,
  type IdLayout, type IdVisual,
} from "@/lib/visual";
import { avisar } from "./ui";

/** Busca as cores e o layout escolhidos pelo administrador e deixa este aparelho igual. */
export function SincronizaVisual() {
  useEffect(() => {
    let vivo = true;
    supabaseNavegador().from("configuracoes").select("valor").eq("chave", "visual").maybeSingle()
      .then(({ data, error }) => {
        if (!vivo || error) return;               // sem internet ou banco antigo: fica como está
        const valor = (data?.valor ?? null) as { id?: string; layout?: string; v?: number } | null;
        // nada gravado (ou gravado antes da escolha atual): vale o padrão do sistema
        if (!valor || (valor.v ?? 0) < VERSAO_ESCOLHA) {
          if (temEscolhaLocal()) {
            esquecerEscolhaLocal();
            if (!visualPrevia()) aplicarVisual(VISUAL_PADRAO);
            if (!layoutPrevia()) aplicarLayout(LAYOUT_PADRAO);
          }
          return;
        }
        if (ehVisual(valor?.id) && valor.id !== visualSalvo()) {
          guardarVisual(valor.id);
          if (!visualPrevia()) aplicarVisual(valor.id);
        }
        if (ehLayout(valor?.layout) && valor.layout !== layoutSalvo()) {
          guardarLayout(valor.layout);
          if (!layoutPrevia()) aplicarLayout(valor.layout);
        }
      });
    return () => { vivo = false; };
  }, []);
  return null;
}

/** Grava as cores e/ou o layout para todo mundo (só administrador). */
export async function usarParaTodos(novo: { visual?: IdVisual; layout?: IdLayout }) {
  const valor = { id: novo.visual ?? visualSalvo(), layout: novo.layout ?? layoutSalvo(), v: VERSAO_ESCOLHA };
  const { error } = await supabaseNavegador().from("configuracoes").upsert({ chave: "visual", valor });
  if (error) {
    avisar(/configuracoes|relation|42P01/i.test(error.message) ? "Rode a atualização 24 no Supabase para poder escolher o visual." : erroMsg(error), "erro");
    return false;
  }
  guardarVisual(valor.id);
  guardarLayout(valor.layout);
  sairPrevia();
  return true;
}

/** Barra que aparece enquanto o administrador está vendo cores ou layout em prévia. */
export function BarraPrevia({ admin }: { admin: boolean }) {
  const [previa, setPrevia] = useState<{ visual: IdVisual | null; layout: IdLayout | null }>({ visual: null, layout: null });
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    const ler = () => setPrevia({ visual: visualPrevia(), layout: layoutPrevia() });
    ler();
    window.addEventListener("visual-mudou", ler);
    return () => window.removeEventListener("visual-mudou", ler);
  }, []);
  if (!previa.visual && !previa.layout) return null;
  const nomes = [
    previa.visual && `cores ${VISUAIS.find((x) => x.id === previa.visual)?.nome}`,
    previa.layout && `layout ${LAYOUTS.find((x) => x.id === previa.layout)?.nome}`,
  ].filter(Boolean).join(" + ");
  return (
    <div className="nao-imprimir pointer-events-none fixed inset-x-0 bottom-[var(--barra-baixo)] z-40 flex justify-center p-3">
      <div className="pointer-events-auto flex max-w-xl flex-wrap items-center gap-2 rounded-2xl bg-zinc-900 px-4 py-3 text-sm text-white shadow-2xl dark:bg-zinc-800">
        <span className="mr-auto"><b>Prévia: {nomes}</b> · navegue pelo sistema para ver como fica.</span>
        <Link href="/aparencia" className="rounded-lg px-3 py-1.5 font-semibold text-zinc-300 hover:bg-white/10">Outros</Link>
        <button onClick={() => sairPrevia()} className="rounded-lg px-3 py-1.5 font-semibold text-zinc-300 hover:bg-white/10">Sair da prévia</button>
        {admin && (
          <button disabled={salvando}
            onClick={async () => {
              setSalvando(true);
              if (await usarParaTodos({ visual: previa.visual ?? undefined, layout: previa.layout ?? undefined })) avisar(`Ligado para todos: ${nomes}`);
              setSalvando(false);
            }}
            className="rounded-lg bg-white px-3 py-1.5 font-bold text-zinc-900 disabled:opacity-60">Usar para todos</button>
        )}
      </div>
    </div>
  );
}
