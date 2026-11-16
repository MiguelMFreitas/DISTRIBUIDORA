"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg, fmtData, fmtMoeda } from "@/lib/formato";
import { Botao, BotaoConfirmar, Cabecalho, Modal, Vazio, avisar } from "@/components/ui";
import { usePerfil, usePode } from "@/components/perfil-contexto";

type Linha = {
  id: string; veiculo_id: string; veiculo: string; placa: string | null; data: string; km: number | null; km_anterior: number | null; km_rodados: number | null;
  valor: number; preco_litro: number; litros: number; km_litro: number | null; custo_km: number | null; foto_painel: string; foto_km: string | null; observacao: string | null; usuario: string | null;
};
type PorVeiculo = { veiculo_id: string; veiculo: string; placa: string | null; abastecimentos: number; valor: number; litros: number; km_rodados: number | null; km_litro: number | null; custo_km: number | null };
type Rel = { total_valor: number; total_litros: number; quantidade: number; lista: Linha[]; por_veiculo: PorVeiculo[] };

const n = (x: unknown) => Number(x ?? 0);
const fmtKm = (x: number | null) => (x == null ? "—" : `${n(x).toLocaleString("pt-BR")} km`);
const fmtL = (x: number) => `${n(x).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} L`;
const isoLocal = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
const segunda = (d: Date) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

type Periodo = "semana" | "mes";

export default function Abastecimentos() {
  const sb = supabaseNavegador();
  const eu = usePerfil();
  const pode = usePode();
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [base, setBase] = useState(() => new Date());
  const [rel, setRel] = useState<Rel | null>(null);
  const [carro, setCarro] = useState("");
  const [fotos, setFotos] = useState<{ titulo: string; urls: { nome: string; url: string }[] } | null>(null);
  const [recarregar, setRecarregar] = useState(0);

  const [ini, fim] = useMemo(() => {
    if (periodo === "semana") { const i = segunda(base); const f = new Date(i); f.setDate(f.getDate() + 6); return [i, f]; }
    return [new Date(base.getFullYear(), base.getMonth(), 1), new Date(base.getFullYear(), base.getMonth() + 1, 0)];
  }, [periodo, base]);
  const atual = isoLocal(new Date()) <= isoLocal(fim);

  useEffect(() => {
    setRel(null);
    sb.rpc("relatorio_abastecimentos", { p_inicio: isoLocal(ini), p_fim: isoLocal(fim) }).then(({ data, error }) => {
      if (error) return avisar(erroMsg(error), "erro");
      setRel(data as Rel);
    });
  }, [sb, ini, fim, recarregar]);

  function mudar(passo: number) {
    setBase((b) => { const x = new Date(b); if (periodo === "semana") x.setDate(x.getDate() + 7 * passo); else x.setMonth(x.getMonth() + passo, 1); return x; });
  }
  async function verFotos(l: Linha) {
    const caminhos = [{ nome: "Painel", c: l.foto_painel }, ...(l.foto_km ? [{ nome: "Quilometragem", c: l.foto_km }] : [])];
    const urls = await Promise.all(caminhos.map(async (x) => {
      const { data } = await sb.storage.from("abastecimentos").createSignedUrl(x.c, 3600);
      return { nome: x.nome, url: data?.signedUrl ?? "" };
    }));
    if (urls.some((u) => !u.url)) avisar("Não deu para abrir alguma foto.", "erro");
    setFotos({ titulo: `${l.veiculo} · ${fmtData(l.data)}`, urls: urls.filter((u) => u.url) });
  }
  async function apagar(l: Linha) {
    const { data, error } = await sb.rpc("apagar_abastecimento", { p_id: l.id });
    if (error) return avisar(erroMsg(error), "erro");
    const lista = String(data ?? "").split(",").filter(Boolean);
    if (lista.length) await sb.storage.from("abastecimentos").remove(lista);
    avisar("Abastecimento apagado");
    setRecarregar((x) => x + 1);
  }

  const lista = (rel?.lista ?? []).filter((l) => !carro || l.veiculo_id === carro);
  const totValor = lista.reduce((s, l) => s + n(l.valor), 0), totL = lista.reduce((s, l) => s + n(l.litros), 0);
  const totKm = lista.reduce((s, l) => s + n(l.km_rodados), 0);
  const titulo = periodo === "semana" ? `${fmtData(isoLocal(ini))} a ${fmtData(isoLocal(fim))}` : ini.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const th = "px-3 py-2";

  if (!pode("abastecimento") && !pode("financeiro")) return <Vazio>Sem acesso.</Vazio>;

  return (
    <>
      <Cabecalho titulo="Relatório de combustível" sub={titulo}>
        <span className="nao-imprimir flex flex-wrap gap-2">
          <select className="campo w-auto!" value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)} aria-label="Período">
            <option value="semana">Semana</option><option value="mes">Mês</option>
          </select>
          <Botao variante="secundario" onClick={() => mudar(-1)}>←</Botao>
          <Botao variante="secundario" onClick={() => mudar(1)} disabled={atual}>→</Botao>
          <Botao variante="secundario" onClick={() => window.print()}>🖨 Imprimir</Botao>
        </span>
      </Cabecalho>

      {!rel ? <div className="cartao p-8 text-center text-zinc-500">Carregando…</div> : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="cartao p-4"><div className="text-xs font-semibold uppercase text-zinc-500">Gasto com combustível</div><div className="font-display text-3xl font-bold">{fmtMoeda(totValor)}</div><div className="text-sm text-zinc-500">{lista.length} abastecimento(s)</div></div>
            <div className="cartao p-4"><div className="text-xs font-semibold uppercase text-zinc-500">Litros</div><div className="font-display text-3xl font-bold">{fmtL(totL)}</div><div className="text-sm text-zinc-500">média {totL ? fmtMoeda(totValor / totL) : "—"} o litro</div></div>
            <div className="cartao p-4"><div className="text-xs font-semibold uppercase text-zinc-500">Km rodados</div><div className="font-display text-3xl font-bold">{fmtKm(totKm || null)}</div><div className="text-sm text-zinc-500">dos carros que marcam km</div></div>
            <div className="cartao p-4"><div className="text-xs font-semibold uppercase text-zinc-500">Custo por km</div><div className="font-display text-3xl font-bold">{(() => { const c = lista.filter((l) => l.km_rodados); const v = c.reduce((s, l) => s + n(l.valor), 0), k = c.reduce((s, l) => s + n(l.km_rodados), 0); return k ? fmtMoeda(v / k) : "—"; })()}</div><div className="text-sm text-zinc-500">gasto ÷ km rodados</div></div>
          </div>

          <section>
            <h2 className="titulo mb-2 text-lg">Por carro</h2>
            {rel.por_veiculo.length === 0 ? <Vazio>Nenhum abastecimento neste período.</Vazio> : (
              <div className="cartao overflow-x-auto">
                <table className="w-full text-[15px]">
                  <thead className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                    <tr><th className={th}>Carro</th><th className={`${th} text-right`}>Vezes</th><th className={`${th} text-right`}>Gasto</th><th className={`${th} text-right`}>Litros</th><th className={`${th} text-right`}>Km rodados</th><th className={`${th} text-right`}>Km/litro</th><th className={`${th} text-right`}>R$/km</th></tr>
                  </thead>
                  <tbody>
                    {rel.por_veiculo.map((v) => (
                      <tr key={v.veiculo_id} onClick={() => setCarro(carro === v.veiculo_id ? "" : v.veiculo_id)} className={`cursor-pointer border-b border-zinc-100 last:border-0 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50 ${carro === v.veiculo_id ? "bg-marca-50 dark:bg-marca-500/10" : ""}`}>
                        <td className={th}><b>{v.veiculo}</b>{v.placa && <span className="text-zinc-500"> · {v.placa}</span>}</td>
                        <td className={`${th} text-right`}>{v.abastecimentos}</td>
                        <td className={`${th} text-right font-semibold`}>{fmtMoeda(v.valor)}</td>
                        <td className={`${th} text-right`}>{fmtL(v.litros)}</td>
                        <td className={`${th} text-right`}>{fmtKm(v.km_rodados)}</td>
                        <td className={`${th} text-right`}>{v.km_litro ? n(v.km_litro).toLocaleString("pt-BR") : "—"}</td>
                        <td className={`${th} text-right`}>{v.custo_km ? fmtMoeda(v.custo_km) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-1 text-xs text-zinc-500">Km rodados e km/litro contam a partir do segundo abastecimento de cada carro (precisa da km anterior). Toque num carro para ver só os abastecimentos dele.</p>
          </section>

          <section>
            <h2 className="titulo mb-2 text-lg">Abastecimentos {carro && <button className="ml-2 text-sm font-semibold text-marca-600" onClick={() => setCarro("")}>(ver todos)</button>}</h2>
            {lista.length === 0 ? <Vazio>Nenhum abastecimento.</Vazio> : (
              <div className="cartao overflow-x-auto">
                <table className="w-full text-[15px]">
                  <thead className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                    <tr><th className={th}>Data</th><th className={th}>Carro</th><th className={`${th} text-right`}>Km</th><th className={`${th} text-right`}>Rodou</th><th className={`${th} text-right`}>Valor</th><th className={`${th} text-right`}>R$/litro</th><th className={`${th} text-right`}>Litros</th><th className={`${th} text-right`}>Km/l</th><th className={th}>Fotos</th><th /></tr>
                  </thead>
                  <tbody>
                    {lista.map((l) => (
                      <tr key={l.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                        <td className={`${th} whitespace-nowrap`}>{fmtData(l.data)}</td>
                        <td className={th}><b>{l.veiculo}</b>{l.observacao && <div className="text-xs text-zinc-500">{l.observacao}</div>}{l.usuario && <div className="text-xs text-zinc-400">por {l.usuario}</div>}</td>
                        <td className={`${th} text-right whitespace-nowrap`}>{l.km == null ? <span className="text-xs text-zinc-400">não marca</span> : fmtKm(l.km)}</td>
                        <td className={`${th} text-right whitespace-nowrap`}>{fmtKm(l.km_rodados)}</td>
                        <td className={`${th} text-right font-semibold whitespace-nowrap`}>{fmtMoeda(l.valor)}</td>
                        <td className={`${th} text-right whitespace-nowrap`}>{fmtMoeda(l.preco_litro)}</td>
                        <td className={`${th} text-right whitespace-nowrap`}>{fmtL(l.litros)}</td>
                        <td className={`${th} text-right`}>{l.km_litro ? n(l.km_litro).toLocaleString("pt-BR") : "—"}</td>
                        <td className={th}><Botao tamanho="p" variante="secundario" onClick={() => verFotos(l)}>📷 Ver</Botao></td>
                        <td className="px-2 text-right">{eu.admin && <BotaoConfirmar tamanho="p" variante="fantasma" aoConfirmar={() => apagar(l)} textoConfirmar="Apagar?">✕</BotaoConfirmar>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      <Modal aberto={!!fotos} aoFechar={() => setFotos(null)} titulo={fotos?.titulo ?? ""} largura="max-w-4xl">
        <div className="grid gap-3 md:grid-cols-2">
          {fotos?.urls.map((f) => (
            <a key={f.nome} href={f.url} target="_blank" rel="noreferrer" className="block">
              <div className="mb-1 text-sm font-semibold">{f.nome}</div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt={f.nome} className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800" />
            </a>
          ))}
        </div>
      </Modal>
    </>
  );
}
