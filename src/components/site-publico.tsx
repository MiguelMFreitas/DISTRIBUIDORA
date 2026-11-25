import Link from "next/link";
import { enderecoCompleto, fmtCNPJ, type Empresa } from "@/lib/empresa";
import { fmtTelefone } from "@/lib/contato";

/* Partes das páginas públicas (página da empresa, privacidade e termos): sem login. */

export function Marca({ nome }: { nome: string }) {
  return (
    <Link href="/" className="flex min-w-0 items-center gap-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-marca-500 text-lg" aria-hidden>🚚</span>
      <span className="truncate font-display text-lg font-bold uppercase tracking-wide text-white sm:text-xl">{nome}</span>
    </Link>
  );
}

export function BarraTopo({ nome }: { nome: string }) {
  return (
    <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
      <Marca nome={nome} />
      <Link href="/login" className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-semibold text-zinc-300 hover:bg-white/10 hover:text-white">
        <span className="sm:hidden">Entrar</span><span className="max-sm:hidden">Acesso da equipe</span>
      </Link>
    </nav>
  );
}

export function Rodape({ empresa }: { empresa: Empresa }) {
  const ano = new Date().getFullYear();
  const end = enderecoCompleto(empresa);
  return (
    <footer className="border-t border-zinc-200 bg-zinc-50 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="font-semibold text-zinc-800 dark:text-zinc-200">© {ano} {empresa.razao_social || empresa.nome}</div>
          {empresa.cnpj && <div>CNPJ {fmtCNPJ(empresa.cnpj)}</div>}
          {end && <div>{end}</div>}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 font-semibold">
          <Link href="/privacidade" className="hover:text-marca-600">Política de privacidade</Link>
          <Link href="/termos" className="hover:text-marca-600">Termos de uso</Link>
          <Link href="/login" className="hover:text-marca-600">Acesso da equipe</Link>
        </div>
      </div>
    </footer>
  );
}

/** Moldura das páginas de texto (privacidade e termos) */
export function PaginaTexto({ empresa, titulo, atualizado, children }: { empresa: Empresa; titulo: string; atualizado: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-white dark:bg-zinc-950">
      <header className="bg-zinc-900">
        <BarraTopo nome={empresa.nome} />
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <h1 className="font-display text-4xl font-bold uppercase tracking-wide">{titulo}</h1>
        <p className="mt-1 text-sm text-zinc-500">Última atualização: {atualizado}</p>
        <div className="texto-legal mt-8 space-y-4 leading-relaxed text-zinc-700 dark:text-zinc-300">{children}</div>
      </main>
      <Rodape empresa={empresa} />
    </div>
  );
}

/** Bloco "quem somos / como falar com a gente" usado nas páginas de texto */
export function QuemSomos({ empresa }: { empresa: Empresa }) {
  const end = enderecoCompleto(empresa);
  return (
    <ul className="list-none! space-y-1 pl-0!">
      <li><b>{empresa.razao_social || empresa.nome}</b>{empresa.razao_social && empresa.razao_social !== empresa.nome ? ` (${empresa.nome})` : ""}</li>
      {empresa.cnpj && <li>CNPJ: {fmtCNPJ(empresa.cnpj)}</li>}
      {end && <li>Endereço: {end}</li>}
      {empresa.email && <li>E-mail: <a href={`mailto:${empresa.email}`}>{empresa.email}</a></li>}
      {(empresa.whatsapp || empresa.telefone) && <li>WhatsApp / telefone: {fmtTelefone(empresa.whatsapp || empresa.telefone)}</li>}
    </ul>
  );
}
