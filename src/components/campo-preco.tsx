"use client";

import { useEffect, useState } from "react";

const mostrar = (n: number) => n.toFixed(2).replace(".", ",");

/** Campo de preço em reais que aceita vírgula e deixa digitar à vontade (ex.: "4," enquanto digita). */
export function CampoPreco({ valor, aoMudar, className, ...resto }: {
  valor: number;
  aoMudar: (n: number) => void;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [texto, setTexto] = useState(mostrar(valor));
  const [focado, setFocado] = useState(false);
  useEffect(() => { if (!focado) setTexto(mostrar(valor)); }, [valor, focado]);
  return (
    <input
      {...resto}
      className={className}
      inputMode="decimal"
      value={texto}
      onFocus={(e) => { setFocado(true); e.target.select(); }}
      onBlur={() => { setFocado(false); setTexto(mostrar(valor)); }}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d.,]/g, "");
        setTexto(t);
        const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
        if (t !== "" && Number.isFinite(n) && n >= 0) aoMudar(Math.round(n * 100) / 100);
      }}
    />
  );
}
