"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg, fmtData, fmtQtd, TURNOS } from "@/lib/formato";
import type { Produto } from "@/lib/tipos";
import { Botao, BotaoConfirmar, Selo, avisar } from "@/components/ui";
import { BuscaProduto } from "@/components/busca-produto";
import { Exige } from "@/components/perfil-contexto";

type Carga = { id: string; numero: number; data: string; turno: "manha" | "tarde"; status: string; veiculos: { nome: string; placa: string | null } | null; motoristas: { nome: string } | null };
type Esperado = { vasilhame_id: string; vasilhame: string; quantidade: number };
type Linha = { produto: Produto; qtd: number };
type Salvo = { tipo: string; quantidade: number; produtos: { nome: string; unidade: string } | null; vasilhames: { nome: string } | null };
const RASCUNHO = (id: string) => `conferencia_${id}`;

function Qtd({ valor, passo, aoMudar }: { valor: number; passo: number; aoMudar: (n: number) => void }) {
  return (
    <div className="flex items-center overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700">
      <button type="button" className="h-10 w-10 text-xl text-zinc-500" onClick={() => aoMudar(Math.max(0, valor - passo))} aria-label="Diminuir">−</button>
      <input type="number" inputMode="decimal" step={passo} className="h-10 w-16 border-x border-zinc-300 bg-white text-center text-lg font-semibold dark:border-zinc-700 dark:bg-zinc-900"
        value={valor} onChange={(e) => aoMudar(Math.max(0, Number(e.target.value) || 0))} onFocus={(e) => e.target.select()} />
      <button type="button" className="h-10 w-10 text-xl text-zinc-500" onClick={() => aoMudar(valor + passo)} aria-label="Aumentar">+</button>
    </div>
  );
}

function ListaProdutos({ titulo, lista, set, tipo, cor, produtos, aoAdicionar }: {
  titulo: React.ReactNode; lista: Linha[]; set: React.Dispatch<React.SetStateAction<Linha[]>>; tipo: "dev" | "troca"; cor?: string;
  produtos: Produto[]; aoAdicionar: (p: Produto) => void;
}) {
  return (
    <section className={`cartao space-y-3 p-4 ${cor ?? ""}`}>
      <h2 className="titulo text-lg">{titulo}</h2>
      <BuscaProduto produtos={produtos} aoEscolher={aoAdicionar} placeholder="Pesquisar produto… (ex.: skol lata)" />
      {lista.length === 0 && <p className="text-sm text-zinc-500">{tipo === "dev" ? "Nada voltou cheio? Pode deixar vazio." : "Nenhuma troca por avaria."}</p>}
      {lista.map((l) => (
        <div key={l.produto.id} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 font-medium">{l.produto.nome} <span className="text-sm text-zinc-500">{l.produto.unidade}</span></span>
          <Qtd valor={l.qtd} passo={l.produto.permite_meia ? 0.5 : 1} aoMudar={(n) => set((x) => x.map((y) => (y.produto.id === l.produto.id ? { ...y, qtd: n } : y)))} />
          <Botao variante="fantasma" tamanho="p" onClick={() => set((x) => x.filter((y) => y.produto.id !== l.produto.id))} aria-label="Remover">✕</Botao>
        </div>
      ))}
    </section>
  );
}

export default function Conferir() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const sb = supabaseNavegador();
  const [carga, setCarga] = useState<Carga | null>(null);
  const [esperados, setEsperados] = useState<Esperado[]>([]);
  const [vasilhames, setVasilhames] = useState<{ id: string; nome: string }[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [voltou, setVoltou] = useState<Record<string, number>>({}); // vasilhame_id -> qtd
  const [devolvidos, setDevolvidos] = useState<Linha[]>([]);
  const [trocas, setTrocas] = useState<Linha[]>([]);
  const [obs, setObs] = useState("");
  const [salvos, setSalvos] = useState<Salvo[]>([]);
  const [obsSalva, setObsSalva] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [pronto, setPronto] = useState(false);

  const carregar = useCallback(async () => {
    const { data: c } = await sb.from("cargas").select("id, numero, data, turno, status, veiculos(nome, placa), motoristas(nome)").eq("id", id).single();
    setCarga(c as unknown as Carga);
    const [{ data: e }, { data: v }, { data: p }] = await Promise.all([
      sb.rpc("vasilhames_esperados", { p_carga: id }),
      sb.from("vasilhames").select("id, nome").eq("ativo", true).order("nome"),
      sb.from("produtos").select("*").order("nome"),
    ]);
    setEsperados((e ?? []) as Esperado[]);
    setVasilhames(v ?? []);
    setProdutos((p ?? []) as Produto[]);
    if ((c as Carga | null)?.status === "conferida") {
      const [{ data: itens }, { data: conf }] = await Promise.all([
        sb.from("conferencia_itens").select("tipo, quantidade, produtos(nome, unidade), vasilhames(nome)").eq("carga_id", id),
        sb.from("conferencias").select("observacao").eq("carga_id", id).maybeSingle(),
      ]);
      setSalvos((itens ?? []) as unknown as Salvo[]);
      setObsSalva(conf?.observacao ?? "");
    } else {
      // rascunho salvo neste aparelho
      try {
        const r = JSON.parse(localStorage.getItem(RASCUNHO(id)) ?? "null");
        if (r) { setVoltou(r.voltou ?? {}); setObs(r.obs ?? ""); setDevolvidos(r.devolvidos ?? []); setTrocas(r.trocas ?? []); }
      } catch {}
    }
    setPronto(true);
  }, [sb, id]);
  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!pronto || carga?.status !== "saiu") return;
    try { localStorage.setItem(RASCUNHO(id), JSON.stringify({ voltou, obs, devolvidos, trocas })); } catch {}
  }, [pronto, carga, id, voltou, obs, devolvidos, trocas]);

  // vasilhames que aparecem: os esperados + os que a pessoa lançou
  const linhasVasilhame = useMemo(() => {
    const m = new Map<string, { id: string; nome: string; esperado: number }>();
    esperados.forEach((e) => m.set(e.vasilhame_id, { id: e.vasilhame_id, nome: e.vasilhame, esperado: Number(e.quantidade) }));
    Object.keys(voltou).forEach((k) => { if (!m.has(k)) { const v = vasilhames.find((x) => x.id === k); if (v) m.set(k, { id: k, nome: v.nome, esperado: 0 }); } });
    return [...m.values()];
  }, [esperados, voltou, vasilhames]);

  const faltaCasco = linhasVasilhame.reduce((s, v) => s + Math.max(0, v.esperado - (voltou[v.id] ?? 0)), 0);

  function adicionar(lista: "dev" | "troca", p: Produto) {
    const set = lista === "dev" ? setDevolvidos : setTrocas;
    set((l) => (l.some((x) => x.produto.id === p.id) ? l.map((x) => (x.produto.id === p.id ? { ...x, qtd: x.qtd + 1 } : x)) : [...l, { produto: p, qtd: 1 }]));
  }

  function mensagem() {
    const L: string[] = [];
    const linha = "━━━━━━━━━━━━━━";
    L.push("🚚 *CONFERÊNCIA DE ROTA*", linha);
    if (carga) {
      L.push(`📅 ${fmtData(carga.data)} · ${TURNOS[carga.turno]} · Carga ${carga.numero}`);
      L.push(`🚛 *Carro:* ${carga.veiculos ? carga.veiculos.nome + (carga.veiculos.placa ? " " + carga.veiculos.placa : "") : "não informado"}`);
      L.push(`👤 *Motorista:* ${carga.motoristas?.nome ?? "não informado"}`);
    }
    L.push(linha, "", "🍾 *VASILHAMES SECOS*");
    const vs = carga?.status === "conferida"
      ? salvos.filter((s) => s.tipo === "vasilhame").map((s) => `▸ *${fmtQtd(s.quantidade)}* · ${s.vasilhames?.nome}`)
      : linhasVasilhame.map((v) => `▸ *${fmtQtd(voltou[v.id] ?? 0)}*${v.esperado ? ` de ${fmtQtd(v.esperado)}` : ""} · ${v.nome}`);
    L.push(...(vs.length ? vs : ["_Nenhum vasilhame._"]));
    const bloco = (titulo: string, tipo: string, lista: Linha[]) => {
      L.push("", titulo);
      const it = carga?.status === "conferida"
        ? salvos.filter((s) => s.tipo === tipo).map((s) => `▸ *${fmtQtd(s.quantidade)} ${s.produtos?.unidade}* · ${s.produtos?.nome}`)
        : lista.filter((l) => l.qtd > 0).map((l) => `▸ *${fmtQtd(l.qtd)} ${l.produto.unidade}* · ${l.produto.nome}`);
      L.push(...(it.length ? it : ["_Nenhum._"]));
    };
    bloco("📦 *PRODUTOS DEVOLVIDOS (CHEIOS)*", "devolvido", devolvidos);
    bloco("⚠️ *TROCA (AVARIA)*", "troca", trocas);
    const o = carga?.status === "conferida" ? obsSalva : obs.trim();
    if (o) L.push("", "📝 *OBSERVAÇÕES*", o);
    if (carga?.status !== "conferida" && faltaCasco > 0) L.push("", `❗ Faltaram ${fmtQtd(faltaCasco)} casco(s)`);
    L.push("", linha);
    return L.join("\n");
  }

  async function finalizar() {
    const itens = [
      ...linhasVasilhame.filter((v) => (voltou[v.id] ?? 0) > 0).map((v) => ({ tipo: "vasilhame", vasilhame_id: v.id, quantidade: voltou[v.id] })),
      ...devolvidos.filter((l) => l.qtd > 0).map((l) => ({ tipo: "devolvido", produto_id: l.produto.id, quantidade: l.qtd })),
      ...trocas.filter((l) => l.qtd > 0).map((l) => ({ tipo: "troca", produto_id: l.produto.id, quantidade: l.qtd })),
    ];
    setOcupado(true);
    const { error } = await sb.rpc("finalizar_conferencia", { p_carga: id, p_itens: itens, p_observacao: obs || null });
    setOcupado(false);
    if (error) return avisar(erroMsg(error), "erro");
    try { localStorage.removeItem(RASCUNHO(id)); } catch {}
    avisar("Conferência finalizada. Devoluções voltaram para o estoque.");
    carregar();
  }

  if (!carga) return <div className="cartao p-8 text-center text-zinc-500">Carregando…</div>;
  const conferida = carga.status === "conferida";

  return (
    <Exige perm="conferencia">
      <div className="mx-auto max-w-3xl">
        <Link href="/conferencia" className="text-sm font-semibold text-marca-600">← Conferência</Link>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="titulo text-3xl">Carga {carga.numero}</h1>
            <p className="text-zinc-500">{fmtData(carga.data)} · {TURNOS[carga.turno]} · 🚚 {carga.veiculos?.nome ?? "—"} · 👤 {carga.motoristas?.nome ?? "—"}</p>
          </div>
          {conferida && <Selo cor="bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200">Conferida</Selo>}
        </div>

        {conferida ? (
          <div className="cartao space-y-4 p-4">
            {(["vasilhame", "devolvido", "troca"] as const).map((t) => {
              const it = salvos.filter((s) => s.tipo === t);
              return (
                <div key={t}>
                  <h2 className="titulo text-lg">{t === "vasilhame" ? "Vasilhames secos" : t === "devolvido" ? "Devolvidos (voltaram ao estoque)" : "Troca por avaria"}</h2>
                  {it.length === 0 ? <p className="text-sm text-zinc-500">Nenhum.</p> : it.map((s, i) => (
                    <div key={i} className="flex justify-between border-b border-zinc-100 py-1 dark:border-zinc-800"><span>{s.produtos?.nome ?? s.vasilhames?.nome}</span><b>{fmtQtd(s.quantidade)} {s.produtos?.unidade ?? ""}</b></div>
                  ))}
                </div>
              );
            })}
            {obsSalva && <p className="rounded-lg bg-zinc-100 p-3 dark:bg-zinc-800"><b>Obs.:</b> {obsSalva}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <section className="cartao space-y-3 p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="titulo text-lg">Vasilhames secos</h2>
                {faltaCasco > 0 ? <span className="text-sm font-bold text-red-600">Faltam {fmtQtd(faltaCasco)}</span> : linhasVasilhame.length > 0 && <span className="text-sm font-bold text-emerald-600">Tudo certo</span>}
              </div>
              {linhasVasilhame.length === 0 && <p className="text-sm text-zinc-500">Esta carga não tem produto retornável cadastrado com vasilhame.</p>}
              {linhasVasilhame.map((v) => {
                const q = voltou[v.id] ?? 0;
                const falta = v.esperado - q;
                return (
                  <div key={v.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{v.nome}</div>
                      <div className={`text-xs ${falta > 0 ? "text-red-600" : "text-zinc-500"}`}>Deviam voltar {fmtQtd(v.esperado)}{falta > 0 ? ` · faltam ${fmtQtd(falta)}` : falta < 0 ? ` · ${fmtQtd(-falta)} a mais` : ""}</div>
                    </div>
                    <Qtd valor={q} passo={1} aoMudar={(n) => setVoltou((x) => ({ ...x, [v.id]: n }))} />
                  </div>
                );
              })}
              <select className="campo" value="" onChange={(e) => e.target.value && setVoltou((x) => ({ ...x, [e.target.value]: x[e.target.value] ?? 1 }))}>
                <option value="">+ Outro vasilhame que voltou…</option>
                {vasilhames.filter((v) => !linhasVasilhame.some((l) => l.id === v.id)).map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
              </select>
            </section>

            <ListaProdutos titulo="Produtos devolvidos (cheios)" lista={devolvidos} set={setDevolvidos} tipo="dev" produtos={produtos} aoAdicionar={(p) => adicionar("dev", p)} />
            <ListaProdutos titulo={<>Troca <span className="ml-1 rounded bg-red-600 px-1.5 py-0.5 align-middle text-xs text-white">avaria</span></>} lista={trocas} set={setTrocas} tipo="troca" cor="border-red-300 dark:border-red-900" produtos={produtos} aoAdicionar={(p) => adicionar("troca", p)} />

            <section className="cartao p-4">
              <label className="rotulo">Observações</label>
              <textarea className="campo min-h-20" placeholder="Avaria, falta, troca, algo que precisa saber…" value={obs} onChange={(e) => setObs(e.target.value)} />
            </section>
          </div>
        )}

        <div className="sticky bottom-0 mt-4 flex gap-2 border-t border-zinc-200 bg-zinc-100/95 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
          <a className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-[#1f9d55] font-bold text-white" href={`https://api.whatsapp.com/send?text=${encodeURIComponent(mensagem())}`} target="_blank" rel="noopener">
            Enviar no WhatsApp
          </a>
          {!conferida && <BotaoConfirmar tamanho="g" className="flex-1" carregando={ocupado} aoConfirmar={finalizar} textoConfirmar="Confirmar e finalizar?">Finalizar conferência</BotaoConfirmar>}
          {conferida && <Botao tamanho="g" variante="secundario" onClick={() => router.push("/conferencia")}>Voltar</Botao>}
        </div>
      </div>
    </Exige>
  );
}
