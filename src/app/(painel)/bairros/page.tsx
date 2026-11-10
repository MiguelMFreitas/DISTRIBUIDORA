"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { alfa, combina, erroMsg } from "@/lib/formato";
import { Botao, BotaoConfirmar, Cabecalho, Vazio, avisar } from "@/components/ui";
import { usePode } from "@/components/perfil-contexto";
import { DIAS_SEMANA, NOME_TURNO, type ItemAgenda } from "@/lib/agenda";

type Bairro = { id: string; nome: string; vendedor_id: string | null; ativo: boolean };
type Cli = { rota_id: string | null; ordem_visita: number | null; ativo: boolean };

const DIA_CURTO: Record<number, string> = { 0: "Dom", 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb" };

export default function Bairros() {
  const sb = supabaseNavegador();
  const pode = usePode();
  const podeEditar = pode("clientes") || pode("cadastros");
  const [bairros, setBairros] = useState<Bairro[]>([]);
  const [clientes, setClientes] = useState<Cli[]>([]);
  const [agenda, setAgenda] = useState<ItemAgenda[]>([]);
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [novo, setNovo] = useState("");
  const [busca, setBusca] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [nomeEdit, setNomeEdit] = useState("");
  const [inativos, setInativos] = useState(false);

  const carregar = useCallback(async () => {
    const [b, c, a, p] = await Promise.all([
      sb.from("rotas").select("id, nome, vendedor_id, ativo"),
      sb.from("clientes").select("rota_id, ordem_visita, ativo"),
      sb.from("agenda_visitas").select("vendedor_id, dia_semana, turno, rota_id"),
      sb.from("perfis").select("id, nome"),
    ]);
    if (b.error) avisar(erroMsg(b.error), "erro");
    setBairros(((b.data ?? []) as Bairro[]).sort((x, y) => alfa(x.nome, y.nome)));
    setClientes((c.data ?? []) as Cli[]);
    setAgenda((a.data ?? []) as ItemAgenda[]);
    setNomes(Object.fromEntries(((p.data ?? []) as { id: string; nome: string }[]).map((x) => [x.id, x.nome])));
  }, [sb]);
  useEffect(() => { carregar(); }, [carregar]);

  const lista = useMemo(() => bairros.filter((b) => (inativos || b.ativo) && (!busca.trim() || combina(b.nome, busca))), [bairros, inativos, busca]);
  const semBairro = clientes.filter((c) => c.ativo && !c.rota_id).length;

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    const nome = novo.trim().toLocaleUpperCase("pt-BR");
    if (!nome) return;
    const { error } = await sb.from("rotas").insert({ nome });
    if (error) return avisar(error.code === "23505" ? "Esse bairro já existe." : erroMsg(error), "erro");
    avisar(`Bairro ${nome} criado`);
    setNovo("");
    carregar();
  }
  async function renomear(id: string) {
    const nome = nomeEdit.trim().toLocaleUpperCase("pt-BR");
    if (!nome) return;
    const { error } = await sb.from("rotas").update({ nome }).eq("id", id);
    if (error) return avisar(error.code === "23505" ? "Já existe um bairro com esse nome." : erroMsg(error), "erro");
    avisar("Bairro renomeado. Os clientes dele já mostram o nome novo.");
    setEditando(null);
    carregar();
  }
  async function ativar(b: Bairro) {
    const { error } = await sb.from("rotas").update({ ativo: !b.ativo }).eq("id", b.id);
    if (error) return avisar(erroMsg(error), "erro");
    carregar();
  }
  async function apagar(b: Bairro) {
    const { error } = await sb.from("rotas").delete().eq("id", b.id);
    if (error) return avisar(erroMsg(error), "erro");
    avisar(`Bairro ${b.nome} apagado`);
    carregar();
  }

  return (
    <>
      <Cabecalho titulo="Bairros" sub="Cada cliente fica em um bairro. O bairro liga o cliente ao roteiro de visitas, à agenda dos vendedores, às visitas do dia, às cargas e aos relatórios." />

      {podeEditar && (
        <form onSubmit={criar} className="mb-4 flex max-w-xl gap-2">
          <input className="campo uppercase" placeholder="Novo bairro (ex.: SERRINHA)" value={novo} onChange={(e) => setNovo(e.target.value)} aria-label="Nome do novo bairro" />
          <Botao type="submit">+ Criar bairro</Botao>
        </form>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input className="campo max-w-xs" placeholder="Pesquisar bairro…" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Pesquisar bairro" />
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar inativos</label>
        {semBairro > 0 && <Link href="/clientes" className="text-sm font-semibold text-red-600">⚠️ {semBairro} cliente(s) sem bairro → abrir Clientes</Link>}
      </div>

      {lista.length === 0 ? <Vazio>Nenhum bairro ainda. Crie o primeiro acima, por exemplo “SERRINHA”.</Vazio> : (
        <div className="cartao overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
              <tr><th className="px-3 py-2">Bairro</th><th className="px-3 py-2 text-right">Clientes</th><th className="px-3 py-2">Vendedores e dias</th><th /></tr>
            </thead>
            <tbody>
              {lista.map((b) => {
                const cs = clientes.filter((c) => c.rota_id === b.id && c.ativo);
                const noRoteiro = cs.filter((c) => c.ordem_visita != null).length;
                const ag = agenda.filter((a) => a.rota_id === b.id);
                const porVend = [...new Set([...(b.vendedor_id ? [b.vendedor_id] : []), ...ag.map((a) => a.vendedor_id)])];
                return (
                  <tr key={b.id} className={`border-b border-zinc-100 align-top last:border-0 dark:border-zinc-800 ${b.ativo ? "" : "opacity-50"}`}>
                    <td className="px-3 py-2.5">
                      {editando === b.id ? (
                        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); renomear(b.id); }}>
                          <input className="campo uppercase" autoFocus value={nomeEdit} onChange={(e) => setNomeEdit(e.target.value)} aria-label="Novo nome do bairro" />
                          <Botao type="submit" tamanho="p">OK</Botao>
                        </form>
                      ) : <span className="text-lg font-bold">{b.nome}</span>}
                      {!b.ativo && <span className="ml-2 text-xs">(inativo)</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <b>{cs.length}</b>
                      {cs.length > noRoteiro && <div className="text-xs text-amber-600">{cs.length - noRoteiro} fora do roteiro</div>}
                    </td>
                    <td className="px-3 py-2.5 text-sm">
                      {porVend.length === 0 ? <span className="text-amber-600">nenhum vendedor</span> : porVend.map((v) => {
                        const dias = ag.filter((a) => a.vendedor_id === v)
                          .sort((x, y) => ((x.dia_semana + 6) % 7) - ((y.dia_semana + 6) % 7) || x.turno.localeCompare(y.turno))
                          .map((a) => `${DIA_CURTO[a.dia_semana]} ${NOME_TURNO[a.turno].toLowerCase()}`);
                        return <div key={v}><b>👤 {nomes[v] ?? "—"}</b>{v === b.vendedor_id ? <span className="text-zinc-500"> (responsável)</span> : ""}{dias.length ? <span className="text-zinc-500"> · {dias.join(", ")}</span> : <span className="text-zinc-400"> · sem dia na agenda</span>}</div>;
                      })}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      <Link href={`/roteiros?bairro=${b.id}`}><Botao variante="fantasma" tamanho="p">🗺️ Roteiro</Botao></Link>
                      {podeEditar && <>
                        <Botao variante="fantasma" tamanho="p" onClick={() => { setEditando(b.id); setNomeEdit(b.nome); }}>Renomear</Botao>
                        <Botao variante="fantasma" tamanho="p" onClick={() => ativar(b)}>{b.ativo ? "Desativar" : "Ativar"}</Botao>
                        {cs.length === 0 && <BotaoConfirmar variante="fantasma" tamanho="p" aoConfirmar={() => apagar(b)} textoConfirmar="Apagar?">✕</BotaoConfirmar>}
                      </>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-zinc-500">Para escolher os dias de cada vendedor, use “Agenda de visitas” ({DIAS_SEMANA.length - 1} dias, manhã e tarde). Para a ordem dos clientes, use “Roteiro”. Só dá para apagar bairro sem clientes; com clientes, desative.</p>
    </>
  );
}
