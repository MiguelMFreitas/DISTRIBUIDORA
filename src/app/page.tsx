import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServidor } from "@/lib/supabase/server";
import { perfilAtual, inicioDoUsuario } from "@/lib/perfil";
import { lerEmpresa } from "@/lib/empresa-servidor";
import { enderecoCompleto, fmtCEP, fmtCNPJ, linkWhatsApp } from "@/lib/empresa";
import { fmtTelefone } from "@/lib/contato";
import { BarraTopo, Rodape } from "@/components/site-publico";

/*
 * Endereço principal do site.
 *  - quem é da equipe e já entrou vai direto para o sistema
 *  - quem não entrou (cliente, Meta, Google) vê a página da distribuidora
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { empresa } = await lerEmpresa();
  return { title: `${empresa.nome} · bebidas e alimentos`, description: empresa.sobre };
}

const VANTAGENS = [
  { icone: "📦", titulo: "Por fardo e por caixa", texto: "Refrigerantes, águas, sucos, cervejas e alimentos. Cerveja retornável também em meia caixa." },
  { icone: "🚚", titulo: "Entrega no seu comércio", texto: "Caminhão na rota do seu bairro toda semana e moto para os pedidos de última hora." },
  { icone: "💬", titulo: "Pedido pelo WhatsApp", texto: "Mande a lista por mensagem, áudio ou foto. Você recebe o valor de cada item antes de confirmar." },
];

const PASSOS = [
  { titulo: "Mande o pedido", texto: "Escreva, grave um áudio ou mande a foto da lista no nosso WhatsApp." },
  { titulo: "Confira o resumo", texto: "Respondemos com cada produto, a quantidade, o preço do fardo e o total. Você confirma com um SIM." },
  { titulo: "Receba no comércio", texto: "Entregamos no seu comércio no dia da rota do seu bairro." },
];

export default async function Inicio() {
  const sb = await supabaseServidor();
  const { data: { user } } = await sb.auth.getUser();
  if (user) redirect(inicioDoUsuario(await perfilAtual()));

  const { empresa: e, linkLigado } = await lerEmpresa();
  const wa = linkWhatsApp(e.whatsapp, `Olá! Quero fazer um pedido na ${e.nome}.`);
  const end = enderecoCompleto(e);
  const mapa = end ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([e.endereco, e.bairro, e.cidade, e.uf, fmtCEP(e.cep)].filter(Boolean).join(", "))}` : null;
  const temContato = !!(e.whatsapp || e.telefone || e.email || e.horario || end);
  const temDados = !!(e.razao_social || e.cnpj);

  return (
    <div className="flex min-h-full flex-col bg-white dark:bg-zinc-950">
      <header className="relative overflow-hidden bg-zinc-900 text-white">
        {/* faixas diagonais discretas no fundo */}
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background:repeating-linear-gradient(-45deg,#fff_0_2px,transparent_2px_22px)]" />
        <div className="relative">
          <BarraTopo nome={e.nome} />
          <div className="mx-auto max-w-5xl px-4 pt-10 pb-16 sm:pt-16 sm:pb-24">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-marca-500">Bebidas e alimentos no atacado</p>
            <h1 className="mt-3 max-w-3xl font-display text-5xl leading-[0.95] font-bold uppercase sm:text-7xl">
              Abasteça o seu comércio sem sair do balcão.
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-zinc-300">{e.sobre}</p>
            {(wa || linkLigado) && (
              <div className="mt-8 flex flex-wrap gap-3">
                {wa && (
                  <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-marca-500 px-6 py-3.5 text-lg font-bold text-white shadow-lg shadow-black/20 hover:bg-marca-600">
                    💬 Pedir pelo WhatsApp
                  </a>
                )}
                {linkLigado && (
                  <Link href="/pedir" className="inline-flex items-center gap-2 rounded-xl border border-white/25 px-6 py-3.5 text-lg font-bold text-white hover:bg-white/10">
                    🛒 Fazer pedido pelo site
                  </Link>
                )}
              </div>
            )}
          </div>
        </div>
        <div aria-hidden className="h-1.5 bg-marca-500" />
      </header>

      <main className="flex-1">
        <section className="mx-auto grid max-w-5xl gap-4 px-4 py-14 sm:grid-cols-3">
          {VANTAGENS.map((v) => (
            <div key={v.titulo} className="cartao p-5">
              <div className="text-3xl" aria-hidden>{v.icone}</div>
              <h2 className="mt-3 font-display text-2xl font-bold uppercase tracking-wide">{v.titulo}</h2>
              <p className="mt-1 text-zinc-600 dark:text-zinc-400">{v.texto}</p>
            </div>
          ))}
        </section>

        <section className="bg-zinc-100 dark:bg-zinc-900/60">
          <div className="mx-auto max-w-5xl px-4 py-14">
            <h2 className="font-display text-4xl font-bold uppercase tracking-wide">Como pedir</h2>
            <ol className="mt-6 grid gap-6 sm:grid-cols-3">
              {PASSOS.map((p, i) => (
                <li key={p.titulo} className="flex gap-4">
                  <span className="grid size-11 shrink-0 place-items-center rounded-full bg-zinc-900 font-display text-2xl font-bold text-marca-500 dark:bg-zinc-800">{i + 1}</span>
                  <div>
                    <h3 className="font-display text-xl font-bold uppercase tracking-wide">{p.titulo}</h3>
                    <p className="mt-0.5 text-zinc-600 dark:text-zinc-400">{p.texto}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {(temContato || temDados) && (
          <section id="contato" className="mx-auto grid max-w-5xl gap-4 px-4 py-14 md:grid-cols-2">
            {temContato && (
              <div className="cartao p-6">
                <h2 className="font-display text-3xl font-bold uppercase tracking-wide">Fale com a gente</h2>
                <dl className="mt-4 space-y-3">
                  {e.whatsapp && <Linha rotulo="WhatsApp">{wa ? <a href={wa} target="_blank" rel="noreferrer" className="font-semibold text-marca-600">{fmtTelefone(e.whatsapp)}</a> : fmtTelefone(e.whatsapp)}</Linha>}
                  {e.telefone && <Linha rotulo="Telefone"><a href={`tel:${e.telefone.replace(/\D/g, "")}`} className="font-semibold">{fmtTelefone(e.telefone)}</a></Linha>}
                  {e.email && <Linha rotulo="E-mail"><a href={`mailto:${e.email}`} className="font-semibold">{e.email}</a></Linha>}
                  {e.horario && <Linha rotulo="Horário">{e.horario}</Linha>}
                  {end && <Linha rotulo="Endereço">{end}{mapa && <> · <a href={mapa} target="_blank" rel="noreferrer" className="font-semibold text-marca-600">ver no mapa</a></>}</Linha>}
                </dl>
              </div>
            )}
            {temDados && (
              <div className="cartao p-6">
                <h2 className="font-display text-3xl font-bold uppercase tracking-wide">Dados da empresa</h2>
                <dl className="mt-4 space-y-3">
                  {e.razao_social && <Linha rotulo="Razão social">{e.razao_social}</Linha>}
                  <Linha rotulo="Nome fantasia">{e.nome}</Linha>
                  {e.cnpj && <Linha rotulo="CNPJ">{fmtCNPJ(e.cnpj)}</Linha>}
                  {end && <Linha rotulo="Sede">{end}</Linha>}
                </dl>
              </div>
            )}
          </section>
        )}
      </main>

      <Rodape empresa={e} />
    </div>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-zinc-500">{rotulo}</dt>
      <dd className="text-zinc-800 dark:text-zinc-200">{children}</dd>
    </div>
  );
}
