"use client";

import { useEffect, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg } from "@/lib/formato";
import { Botao, Cabecalho, avisar } from "@/components/ui";
import { usePerfil } from "@/components/perfil-contexto";
import { EMPRESA_PADRAO, SOBRE_PADRAO, comPadrao, type Empresa } from "@/lib/empresa";

type Campo = { k: keyof Empresa; rotulo: string; dica?: string; largo?: boolean; tipo?: "texto" | "area"; max?: number; modo?: "numeric" | "tel" | "email" };

const GRUPOS: { titulo: string; sub: string; campos: Campo[] }[] = [
  {
    titulo: "Empresa", sub: "Igual ao cartão CNPJ e ao que você pôs na Meta.",
    campos: [
      { k: "nome", rotulo: "Nome fantasia (o que aparece no site)", largo: true, max: 60 },
      { k: "razao_social", rotulo: "Razão social", largo: true, max: 120 },
      { k: "cnpj", rotulo: "CNPJ", modo: "numeric", max: 18 },
    ],
  },
  {
    titulo: "Endereço", sub: "O endereço do CNPJ.",
    campos: [
      { k: "endereco", rotulo: "Rua e número", largo: true, max: 120 },
      { k: "bairro", rotulo: "Bairro", max: 60 },
      { k: "cep", rotulo: "CEP", modo: "numeric", max: 9 },
      { k: "cidade", rotulo: "Cidade", max: 60 },
      { k: "uf", rotulo: "Estado (UF)", max: 2 },
    ],
  },
  {
    titulo: "Contato", sub: "O WhatsApp aqui vira o botão “Pedir pelo WhatsApp” do site. Quando o robô estiver ligado, ponha o número dele.",
    campos: [
      { k: "whatsapp", rotulo: "WhatsApp de pedidos", modo: "tel", max: 20, dica: "Com DDD. Ex.: 85 99999-9999" },
      { k: "telefone", rotulo: "Telefone", modo: "tel", max: 20 },
      { k: "email", rotulo: "E-mail", modo: "email", max: 120, largo: true },
      { k: "horario", rotulo: "Horário de atendimento", largo: true, max: 100, dica: "Ex.: Segunda a sexta, 7h às 17h · Sábado, 7h às 12h" },
    ],
  },
  {
    titulo: "Texto do site", sub: "Frase que aparece embaixo do título da página.",
    campos: [{ k: "sobre", rotulo: "Sobre a empresa", largo: true, tipo: "area", max: 300 }],
  },
];

export default function DadosDaEmpresa() {
  const sb = supabaseNavegador();
  const eu = usePerfil();
  const [salvo, setSalvo] = useState<Empresa | null>(null);
  const [form, setForm] = useState<Empresa>(EMPRESA_PADRAO);
  const [salvando, setSalvando] = useState(false);
  const [origem, setOrigem] = useState("");

  useEffect(() => {
    setOrigem(window.location.origin);
    sb.from("configuracoes").select("valor").eq("chave", "empresa").maybeSingle().then(({ data, error }) => {
      if (error) avisar(erroMsg(error), "erro");
      const e = comPadrao(data?.valor as Partial<Empresa> | null);
      setSalvo(e); setForm(e);
    });
  }, [sb]);

  const mudou = salvo != null && JSON.stringify(salvo) !== JSON.stringify(form);

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    setSalvando(true);
    const valor = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, String(v ?? "").trim()])) as Empresa;
    valor.uf = valor.uf.toUpperCase();
    if (valor.sobre === SOBRE_PADRAO) valor.sobre = "";
    const { error } = await sb.from("configuracoes").upsert({ chave: "empresa", valor });
    setSalvando(false);
    if (error) return avisar(erroMsg(error), "erro");
    const e = comPadrao(valor);
    setSalvo(e); setForm(e);
    avisar("Dados salvos. O site já mostra assim.");
  }

  async function copiar(texto: string) {
    try { await navigator.clipboard.writeText(texto); avisar("Endereço copiado"); } catch { avisar("Não deu para copiar. Selecione e copie.", "erro"); }
  }

  const enderecos = [
    { nome: "Página da empresa (site)", caminho: "/" },
    { nome: "Política de privacidade", caminho: "/privacidade" },
    { nome: "Termos de uso", caminho: "/termos" },
    { nome: "Exclusão de dados", caminho: "/privacidade#exclusao" },
  ];

  return (
    <>
      <Cabecalho titulo="🏢 Dados da empresa" sub="Aparecem na página pública do site, na Política de privacidade e nos Termos de uso. A Meta confere esses dados para liberar o WhatsApp do robô." />

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <form onSubmit={salvar} className="space-y-4">
          {GRUPOS.map((g) => (
            <fieldset key={g.titulo} className="cartao p-4" disabled={!eu.admin || salvo == null}>
              <legend className="sr-only">{g.titulo}</legend>
              <h2 className="titulo text-lg">{g.titulo}</h2>
              <p className="mb-3 text-sm text-zinc-500">{g.sub}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {g.campos.map((c) => (
                  <div key={c.k} className={c.largo ? "sm:col-span-2" : ""}>
                    <label className="rotulo" htmlFor={`e-${c.k}`}>{c.rotulo}</label>
                    {c.tipo === "area" ? (
                      <textarea id={`e-${c.k}`} className="campo min-h-24" maxLength={c.max} value={form[c.k]}
                        onChange={(e) => setForm({ ...form, [c.k]: e.target.value })} />
                    ) : (
                      <input id={`e-${c.k}`} className="campo" maxLength={c.max} inputMode={c.modo === "email" ? "email" : c.modo}
                        type={c.modo === "email" ? "email" : "text"} value={form[c.k]}
                        onChange={(e) => setForm({ ...form, [c.k]: e.target.value })} />
                    )}
                    {c.dica && <p className="mt-1 text-xs text-zinc-500">{c.dica}</p>}
                  </div>
                ))}
              </div>
            </fieldset>
          ))}
          {eu.admin && (
            <div className="sticky bottom-[calc(var(--barra-baixo)+0.75rem)] flex justify-end">
              <Botao type="submit" carregando={salvando} disabled={!mudou} className="shadow-lg">Salvar dados</Botao>
            </div>
          )}
        </form>

        <aside className="space-y-4">
          <section className="cartao space-y-3 p-4">
            <h2 className="titulo text-lg">Endereços para a Meta</h2>
            <p className="text-sm text-zinc-500">Copie e cole nos campos que a Meta pedir (site, política de privacidade, termos e exclusão de dados).</p>
            {enderecos.map((x) => {
              const url = `${origem}${x.caminho}`;
              return (
                <div key={x.caminho}>
                  <div className="rotulo">{x.nome}</div>
                  <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-sm break-all select-all dark:border-zinc-800 dark:bg-zinc-950">{url}</div>
                  <div className="mt-1 flex gap-4 text-sm font-semibold">
                    <button type="button" onClick={() => copiar(url)} className="text-marca-600">Copiar</button>
                    <a href={x.caminho} target="_blank" className="text-zinc-600 dark:text-zinc-400">Abrir →</a>
                  </div>
                </div>
              );
            })}
          </section>
        </aside>
      </div>
    </>
  );
}
