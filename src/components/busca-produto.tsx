"use client";

import { useMemo, useState } from "react";
import { combina, fmtQtd } from "@/lib/formato";
import type { Produto } from "@/lib/tipos";

/** Campo de pesquisa de produto com lista suspensa */
export function BuscaProduto({ produtos, aoEscolher, placeholder = "Pesquisar produto…" }: {
  produtos: Produto[]; aoEscolher: (p: Produto) => void; placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [aberto, setAberto] = useState(false);
  const [i, setI] = useState(0);
  const res = useMemo(() => (q.trim() ? produtos.filter((p) => combina(`${p.nome} ${p.codigo ?? ""}`, q)).slice(0, 12) : []), [q, produtos]);
  function escolher(p: Produto) { aoEscolher(p); setQ(""); setI(0); }
  return (
    <div className="relative">
      <input
        className="campo" placeholder={placeholder} value={q}
        onChange={(e) => { setQ(e.target.value); setAberto(true); setI(0); }}
        onFocus={() => setAberto(true)} onBlur={() => setTimeout(() => setAberto(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setI(Math.min(i + 1, res.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setI(Math.max(i - 1, 0)); }
          if (e.key === "Enter" && res[i]) { e.preventDefault(); escolher(res[i]); }
        }}
      />
      {aberto && res.length > 0 && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          {res.map((p, k) => (
            <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => escolher(p)}
              className={`flex w-full justify-between gap-2 border-b border-zinc-100 px-3 py-2 text-left last:border-0 dark:border-zinc-800 ${k === i ? "bg-marca-100 dark:bg-marca-500/20" : ""}`}>
              <span className="font-medium">{p.nome}</span>
              <span className="whitespace-nowrap text-sm text-zinc-500">{p.unidade} · estoque {fmtQtd(p.estoque)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
