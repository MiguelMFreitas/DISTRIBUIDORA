"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { alfa, erroMsg } from "@/lib/formato";
import { Botao, Cabecalho, Vazio, avisar } from "@/components/ui";
import { usePode } from "@/components/perfil-contexto";
import { DIAS_SEMANA } from "@/lib/agenda";

type Rota = { id: string; nome: string; vendedor_id: string | null; ativo: boolean };
type Vend = { id: string; nome: string };
type Item = { vendedor_id: string; dia_semana: number; turno: "manha" | "tarde"; rota_id: string };

const TURNOS = [{ k: "manha", nome: "☀️ Manhã" }, { k: "tarde", nome: "🌇 Tarde" }] as const;
const chave = (dia: number, turno: string) => `${dia}-${turno}`;

export default function Agenda() {
  const sb = supabaseNavegador();
  const pode = usePode();
  const podeEditar = pode("clientes") || pode("cadastros");
  const [rotas, setRotas] = useState<Rota[]>([]);
  const [vends, setVends] = useState<Vend[]>([]);
  const [agenda, setAgenda] = useState<Item[]>([]);
  const [contagem, setContagem] = useState<Record<string, number>>({});
  const [vendedor, setVendedor] = useState("");
  const [grade, setGrade] = useState<Record<string, string[]>>({}); // "1-manha" -> bairros (pode ter mais de um)
  const [domingo, setDomingo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const [{ data: r }, { data: v }, { data: a }, { data: c }] = await Promise.all([
      sb.from("rotas").select("id, nome, vendedor_id, ativo").eq("ativo", true),
      sb.from("perfis").select("id, nome, admin, permissoes, ativo").eq("ativo", true),
      sb.from("agenda_visitas").select("vendedor_id, dia_semana, turno, rota_id"),
      sb.from("clientes").select("rota_id").eq("ativo", true).not("ordem_visita", "is", null),
    ]);
    setRotas(((r ?? []) as Rota[]).sort((x, y) => alfa(x.nome, y.nome)));
    const vs = ((v ?? []) as (Vend & { admin: boolean; permissoes: string[] })[]).filter((x) => x.permissoes.includes("pedidos_criar")).sort((x, y) => alfa(x.nome, y.nome));
    setVends(vs);
    setAgenda((a ?? []) as Item[]);
    const cont: Record<string, number> = {};
    ((c ?? []) as { rota_id: string }[]).forEach((x) => { cont[x.rota_id] = (cont[x.rota_id] ?? 0) + 1; });
    setContagem(cont);
    setVendedor((atual) => atual || vs[0]?.id || "");
  }, [sb]);
  useEffect(() => { carregar(); }, [carregar]);

  // monta a grade do vendedor escolhido
  const salvo = useMemo(() => {
    const g: Record<string, string[]> = {};
    agenda.filter((a) => a.vendedor_id === vendedor).forEach((a) => { const k = chave(a.dia_semana, a.turno); g[k] = [...(g[k] ?? []), a.rota_id]; });
    return g;
  }, [agenda, vendedor]);
  useEffect(() => {
    setGrade(salvo);
    if (Object.keys(salvo).some((k) => k.startsWith("0-"))) setDomingo(true);
  }, [salvo]);
  const norm = (g: Record<string, string[]>) => JSON.stringify(Object.entries(g).filter(([, v]) => v.length).map(([k, v]) => [k, [...v].sort()]).sort());
  const mudou = norm(grade) !== norm(salvo);
  const nomeRota = (id: string) => rotas.find((r) => r.id === id)?.nome ?? "?";

  const nomeVend = (id: string | null) => vends.find((v) => v.id === id)?.nome;
  const minhas = rotas.filter((r) => r.vendedor_id === vendedor);
  const livres = rotas.filter((r) => !r.vendedor_id);
  const deOutros = rotas.filter((r) => r.vendedor_id && r.vendedor_id !== vendedor);
  const dias = DIAS_SEMANA.filter((d) => d.n !== 0 || domingo);

  // rotas que não aparecem em nenhum dia da agenda de ninguém
  const semDia = rotas.filter((r) => !agenda.some((a) => a.rota_id === r.id) && !Object.values(grade).some((l) => l.includes(r.id)));

  function copiarParaSemana(dia: number) {
    const m = grade[chave(dia, "manha")] ?? [], t = grade[chave(dia, "tarde")] ?? [];
    const g = { ...grade };
    [1, 2, 3, 4, 5, 6].forEach((d) => { g[chave(d, "manha")] = m; g[chave(d, "tarde")] = t; });
    setGrade(g);
  }

  async function salvar() {
    setSalvando(true);
    const itens = Object.entries(grade).flatMap(([k, ids]) => { const [dia, turno] = k.split("-"); return ids.map((rota_id) => ({ dia: Number(dia), turno, rota_id })); });
    const { error } = await sb.rpc("salvar_agenda", { p_vendedor: vendedor, p_itens: itens });
    setSalvando(false);
    if (error) return avisar(erroMsg(error), "erro");
    avisar(`Agenda de ${nomeVend(vendedor)} salva`);
    carregar();
  }

  return (
    <>
      <Cabecalho titulo="Agenda de visitas" sub="Escolha os bairros de cada vendedor em cada dia e período (pode ser mais de um bairro de manhã ou de tarde). No celular, o vendedor vê os clientes de cada bairro separados, na ordem do roteiro." />

      {vends.length === 0 ? <Vazio>Nenhum vendedor cadastrado (usuário com permissão “Fazer pedidos”).</Vazio> : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Vendedor">
            {vends.map((v) => {
              const qtd = agenda.filter((a) => a.vendedor_id === v.id).length;
              return (
                <button key={v.id} role="tab" aria-selected={v.id === vendedor}
                  onClick={() => { if (mudou) return avisar("Salve a agenda deste vendedor antes de trocar.", "erro"); setVendedor(v.id); }}
                  className={`rounded-full px-4 py-2 font-semibold ${v.id === vendedor ? "bg-marca-500 text-white" : "bg-white text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>
                  👤 {v.nome} <span className="text-xs opacity-75">({qtd})</span>
                </button>
              );
            })}
          </div>

          <div className="cartao overflow-x-auto">
            <table className="w-full min-w-[620px] text-[15px]">
              <thead className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                <tr><th className="px-3 py-2">Dia</th>{TURNOS.map((t) => <th key={t.k} className="px-3 py-2">{t.nome}</th>)}<th /></tr>
              </thead>
              <tbody>
                {dias.map((d) => (
                  <tr key={d.n} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800">
                    <td className="px-3 py-2 font-semibold">{d.nome}</td>
                    {TURNOS.map((t) => {
                      const k = chave(d.n, t.k), lista = grade[k] ?? [];
                      const tirar = (id: string) => setGrade({ ...grade, [k]: lista.filter((x) => x !== id) });
                      const opcoes = (l: Rota[]) => l.filter((r) => !lista.includes(r.id));
                      return (
                        <td key={t.k} className="px-3 py-2 align-top">
                          {lista.length > 0 && (
                            <div className="mb-1.5 flex flex-wrap gap-1.5">
                              {lista.map((id) => (
                                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-marca-100 py-1 pl-3 pr-1 text-sm font-semibold text-marca-900 dark:bg-marca-500/20 dark:text-marca-100">
                                  {nomeRota(id)}
                                  {podeEditar && <button type="button" onClick={() => tirar(id)} className="grid size-6 place-items-center rounded-full hover:bg-marca-200 dark:hover:bg-marca-500/30" aria-label={`Tirar ${nomeRota(id)} de ${d.nome} ${t.nome}`}>×</button>}
                                </span>
                              ))}
                            </div>
                          )}
                          {podeEditar ? (
                            <select className="campo" value="" onChange={(e) => e.target.value && setGrade({ ...grade, [k]: [...lista, e.target.value] })} aria-label={`${d.nome} ${t.nome}`}>
                              <option value="">{lista.length ? "+ outro bairro…" : "— folga / sem bairro —"}</option>
                              {opcoes(minhas).length > 0 && <optgroup label="Bairros dele">{opcoes(minhas).map((r) => <option key={r.id} value={r.id}>{r.nome} ({contagem[r.id] ?? 0} clientes)</option>)}</optgroup>}
                              {opcoes(livres).length > 0 && <optgroup label="Bairros sem vendedor (passam a ser dele)">{opcoes(livres).map((r) => <option key={r.id} value={r.id}>{r.nome} ({contagem[r.id] ?? 0} clientes)</option>)}</optgroup>}
                              {opcoes(deOutros).length > 0 && <optgroup label="Bairros de outros vendedores (ficam compartilhados)">{opcoes(deOutros).map((r) => <option key={r.id} value={r.id}>{r.nome} (também de {nomeVend(r.vendedor_id) ?? "outro"})</option>)}</optgroup>}
                            </select>
                          ) : lista.length === 0 && <span className="text-zinc-400">folga</span>}
                        </td>
                      );
                    })}
                    <td className="px-2 py-2 text-right">
                      {podeEditar && d.n === 1 && ((grade[chave(1, "manha")]?.length ?? 0) > 0 || (grade[chave(1, "tarde")]?.length ?? 0) > 0) && (
                        <Botao variante="fantasma" tamanho="p" onClick={() => copiarParaSemana(1)} title="Repetir segunda em todos os dias até sábado">Repetir na semana</Botao>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              <input type="checkbox" checked={domingo} onChange={(e) => setDomingo(e.target.checked)} /> Mostrar domingo
            </label>
            {podeEditar && <Botao onClick={salvar} disabled={!mudou} carregando={salvando}>Salvar agenda de {nomeVend(vendedor)}</Botao>}
          </div>
          {mudou && <p className="rounded-lg bg-marca-50 p-2 text-sm font-semibold text-marca-700 dark:bg-marca-500/10 dark:text-marca-100">Você mudou a agenda. Clique em “Salvar agenda” para valer.</p>}

          <div className="grid gap-3 text-sm text-zinc-600 md:grid-cols-2 dark:text-zinc-400">
            <div className="cartao p-3">
              <b className="text-zinc-800 dark:text-zinc-200">Bairro de outro vendedor fica compartilhado:</b> os dois veem todos os clientes dele no celular e os dois podem vender (a venda conta para quem fez). Bairro sem vendedor, ao ser escolhido, passa a ter este vendedor como responsável.
            </div>
            <div className="cartao p-3">
              {semDia.length ? <><b className="text-amber-700 dark:text-amber-400">Bairros fora da agenda:</b> {semDia.map((r) => r.nome).join(", ")}. Nenhum vendedor tem dia para elas.</> : <b className="text-emerald-700 dark:text-emerald-400">Todos os bairros têm pelo menos um dia na agenda.</b>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
