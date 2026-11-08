"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { PERMISSOES, type Perfil, type Permissao } from "@/lib/tipos";
import { Botao, BotaoConfirmar, Cabecalho, Modal, Selo, avisar } from "@/components/ui";
import { Exige, usePerfil } from "@/components/perfil-contexto";

type Form = Partial<Perfil> & { senha?: string };

const MODELOS: { nome: string; permissoes: Permissao[]; desconto: number }[] = [
  { nome: "Vendedor", permissoes: ["pedidos_criar"], desconto: 5 },
  { nome: "Escritório", permissoes: ["pedidos_ver_todos", "clientes", "cargas"], desconto: 0 },
  { nome: "Conferente", permissoes: ["conferencia"], desconto: 0 },
];

export default function Usuarios() {
  const eu = usePerfil();
  const sb = supabaseNavegador();
  const [lista, setLista] = useState<Perfil[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const { data } = await sb.from("perfis").select("*").order("admin", { ascending: false }).order("nome");
    setLista((data ?? []) as Perfil[]);
  }, [sb]);
  useEffect(() => { carregar(); }, [carregar]);

  async function enviar(metodo: "POST" | "PATCH" | "DELETE", corpo: object) {
    const r = await fetch("/api/usuarios", { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.erro || "Erro");
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSalvando(true);
    try {
      await enviar(form.id ? "PATCH" : "POST", form);
      avisar(form.id ? "Usuário atualizado" : "Usuário criado");
      setForm(null);
      carregar();
    } catch (err) {
      avisar((err as Error).message, "erro");
    } finally {
      setSalvando(false);
    }
  }

  async function apagar(id: string) {
    try {
      await enviar("DELETE", { id });
      avisar("Usuário apagado");
      setForm(null);
      carregar();
    } catch (err) {
      avisar((err as Error).message, "erro");
    }
  }

  const alternar = (p: Permissao) =>
    setForm((f) => f && { ...f, permissoes: f.permissoes?.includes(p) ? f.permissoes.filter((x) => x !== p) : [...(f.permissoes ?? []), p] });

  return (
    <Exige admin>
      <Cabecalho titulo="Usuários" sub="Só administradores criam, editam e apagam contas.">
        <Botao onClick={() => setForm({ nome: "", usuario: "", senha: "", admin: false, permissoes: ["pedidos_criar"], desconto_max: 5, ativo: true })}>+ Novo usuário</Botao>
      </Cabecalho>

      <div className="cartao overflow-x-auto">
        <table className="w-full text-[15px]">
          <thead className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
            <tr><th className="px-3 py-2">Nome</th><th className="px-3 py-2">Usuário</th><th className="px-3 py-2">Acesso</th><th className="px-3 py-2 text-right">Desconto máx.</th><th /></tr>
          </thead>
          <tbody>
            {lista.map((u) => (
              <tr key={u.id} className={`border-b border-zinc-100 last:border-0 dark:border-zinc-800 ${u.ativo ? "" : "opacity-50"}`}>
                <td className="px-3 py-2 font-semibold">{u.nome}{!u.ativo && " (inativo)"}</td>
                <td className="px-3 py-2 text-zinc-500">{u.usuario}</td>
                <td className="px-3 py-2">
                  {u.admin ? <Selo cor="bg-marca-500 text-white">Administrador</Selo> : (
                    <div className="flex flex-wrap gap-1">
                      {u.permissoes.map((p) => <Selo key={p} cor="bg-zinc-100 dark:bg-zinc-800">{PERMISSOES.find((x) => x.chave === p)?.nome ?? p}</Selo>)}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{u.admin ? "livre" : `${Number(u.desconto_max).toLocaleString("pt-BR")}%`}</td>
                <td className="px-2 text-right"><Botao variante="fantasma" tamanho="p" onClick={() => setForm({ ...u, senha: "" })}>Editar</Botao></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal aberto={!!form} aoFechar={() => setForm(null)} titulo={form?.id ? "Editar usuário" : "Novo usuário"}
        rodape={<>
          {form?.id && form.id !== eu.id && <BotaoConfirmar variante="secundario" className="mr-auto" aoConfirmar={() => apagar(form.id!)} textoConfirmar="Apagar mesmo?">Apagar conta</BotaoConfirmar>}
          <Botao variante="secundario" onClick={() => setForm(null)}>Cancelar</Botao>
          <Botao type="submit" form="form-usuario" carregando={salvando}>Salvar</Botao>
        </>}>
        {form && (
          <form id="form-usuario" onSubmit={salvar} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label className="rotulo">Nome</label><input className="campo" required value={form.nome ?? ""} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
              <div><label className="rotulo">Telefone</label><input className="campo" value={form.telefone ?? ""} onChange={(e) => setForm({ ...form, telefone: e.target.value })} /></div>
              <div>
                <label className="rotulo">Usuário (para entrar)</label>
                <input className="campo lowercase" required disabled={!!form.id} autoCapitalize="none" placeholder="ex.: joao" value={form.usuario ?? ""} onChange={(e) => setForm({ ...form, usuario: e.target.value })} />
              </div>
              <div>
                <label className="rotulo">{form.id ? "Nova senha (deixe vazio para manter)" : "Senha"}</label>
                <input className="campo" type="text" autoComplete="new-password" required={!form.id} minLength={6} value={form.senha ?? ""} onChange={(e) => setForm({ ...form, senha: e.target.value })} />
              </div>
            </div>

            <label className="flex items-center gap-2 rounded-lg border border-marca-500/40 bg-marca-50 p-3 font-semibold dark:bg-marca-500/10">
              <input type="checkbox" className="size-5 accent-marca-500" checked={!!form.admin} onChange={(e) => setForm({ ...form, admin: e.target.checked })} disabled={form.id === eu.id} />
              Administrador (acesso a tudo, cria e apaga contas, aprova descontos)
            </label>

            {!form.admin && (
              <>
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rotulo mb-0">Permissões</span>
                    <span className="text-xs text-zinc-500">Modelos:</span>
                    {MODELOS.map((m) => (
                      <button key={m.nome} type="button" onClick={() => setForm({ ...form, permissoes: m.permissoes, desconto_max: m.desconto })}
                        className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-semibold dark:border-zinc-700">{m.nome}</button>
                    ))}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {PERMISSOES.map((p) => (
                      <label key={p.chave} className={`flex cursor-pointer gap-2 rounded-lg border p-2.5 ${form.permissoes?.includes(p.chave) ? "border-marca-500 bg-marca-50 dark:bg-marca-500/10" : "border-zinc-200 dark:border-zinc-700"}`}>
                        <input type="checkbox" className="mt-0.5 size-4 accent-marca-500" checked={!!form.permissoes?.includes(p.chave)} onChange={() => alternar(p.chave)} />
                        <span><span className="block text-sm font-semibold">{p.nome}</span><span className="block text-xs text-zinc-500">{p.descricao}</span></span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="max-w-xs">
                  <label className="rotulo">Desconto máximo que pode dar (%)</label>
                  <input className="campo" type="number" min={0} max={100} step={0.5} value={form.desconto_max ?? 0} onChange={(e) => setForm({ ...form, desconto_max: Number(e.target.value) })} />
                  <p className="mt-1 text-xs text-zinc-500">Acima disso, o pedido chega como “aguardando aprovação”.</p>
                </div>
              </>
            )}

            {form.id && form.id !== eu.id && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" checked={!!form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
                Conta ativa (desmarque para bloquear o acesso sem apagar o histórico de vendas)
              </label>
            )}
          </form>
        )}
      </Modal>
    </Exige>
  );
}
