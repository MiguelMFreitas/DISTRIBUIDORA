"use client";

import { BarraPrevia, SincronizaVisual } from "./visual";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import type { Perfil, Permissao } from "@/lib/tipos";
import { ProvedorPerfil } from "./perfil-contexto";
import { Avisos } from "./ui";
import { VerificaBanco } from "./verifica-banco";

type Item = { href: string; nome: string; icone: string; perm?: Permissao | Permissao[]; admin?: boolean };

const MENU: Item[] = [
  { href: "/painel", nome: "Início", icone: "🏠" },
  { href: "/pedidos/novo", nome: "Novo pedido", icone: "➕", perm: ["pedidos_criar", "pedidos_ver_todos"] },
  { href: "/pedidos/novo?entrega=balcao", nome: "Venda no balcão", icone: "🏪", perm: "pedidos_ver_todos" },
  { href: "/moto", nome: "Entregas de moto", icone: "🏍️", perm: ["moto", "pedidos_ver_todos"] },
  { href: "/link", nome: "Link de pedidos", icone: "🔗", perm: "pedidos_ver_todos" },
  { href: "/pedidos", nome: "Pedidos", icone: "📋", perm: "pedidos_ver_todos" },
  { href: "/imprimir/automatica", nome: "Impressão automática", icone: "🖨️", perm: ["pedidos_ver_todos", "cargas"] },
  { href: "/cargas", nome: "Cargas e romaneio", icone: "🚚", perm: "cargas" },
  { href: "/conferencia", nome: "Conferência", icone: "✅", perm: "conferencia" },
  { href: "/clientes", nome: "Clientes", icone: "🏪", perm: "clientes" },
  { href: "/bairros", nome: "Bairros", icone: "🏘️", perm: ["clientes", "cadastros"] },
  { href: "/roteiros", nome: "Roteiro de visitas", icone: "🗺️", perm: ["clientes", "cadastros"] },
  { href: "/agenda", nome: "Agenda de visitas", icone: "🗓️", perm: ["clientes", "cadastros"] },
  { href: "/visitas", nome: "Visitas do dia", icone: "📍", perm: "pedidos_ver_todos" },
  { href: "/produtos", nome: "Produtos", icone: "📦", perm: "produtos" },
  { href: "/categorias", nome: "Categorias (ordem)", icone: "↕️", perm: "produtos" },
  { href: "/estoque", nome: "Estoque", icone: "🏬", perm: "estoque" },
  { href: "/cadastros", nome: "Motoristas, veículos…", icone: "🗂️", perm: ["cadastros", "produtos"] },
  { href: "/recibos", nome: "Recibos", icone: "🧾", perm: ["pedidos_ver_todos", "financeiro"] },
  { href: "/financeiro", nome: "Financeiro", icone: "💰", perm: "financeiro" },
  { href: "/abastecer", nome: "Abastecer carro", icone: "⛽", perm: "abastecimento" },
  { href: "/abastecimentos", nome: "Relatório de combustível", icone: "📈", perm: ["abastecimento", "financeiro"] },
  { href: "/vendedores", nome: "Vendedores", icone: "📊", admin: true },
  { href: "/ranking", nome: "Ranking", icone: "🏆", admin: true },
  { href: "/usuarios", nome: "Usuários", icone: "👥", admin: true },
  { href: "/aparencia", nome: "Aparência", icone: "🎨", admin: true },
  { href: "/vender", nome: "App do vendedor", icone: "📱", perm: "pedidos_criar" },
];

function visivel(p: Perfil, i: Item) {
  if (p.admin) return true;
  if (i.admin) return false;
  if (!i.perm) return true;
  const lista = Array.isArray(i.perm) ? i.perm : [i.perm];
  return lista.some((x) => p.permissoes.includes(x));
}

export function PainelShell({ perfil, children }: { perfil: Perfil; children: React.ReactNode }) {
  const caminho = usePathname();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const itens = MENU.filter((i) => visivel(perfil, i));

  async function sair() {
    await supabaseNavegador().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const nav = (
    <nav className="flex flex-col gap-0.5">
      {itens.map((i) => {
        // o item mais específico ganha (/pedidos/novo não acende "Pedidos")
        const ativo = (caminho === i.href || caminho.startsWith(i.href + "/")) && !itens.some((o) => o.href !== i.href && o.href.startsWith(i.href + "/") && caminho.startsWith(o.href));
        return (
          <Link
            key={i.href}
            href={i.href}
            onClick={() => setAberto(false)}
            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] font-medium ${
              ativo ? "bg-[var(--menu-ativo-fundo)] font-semibold text-[var(--menu-ativo-texto)]" : "text-[var(--menu-texto)] hover:bg-[var(--menu-hover-fundo)] hover:text-[var(--menu-hover-texto)]"
            }`}
          >
            <span className="w-5 text-center" aria-hidden>{i.icone}</span>
            {i.nome}
          </Link>
        );
      })}
    </nav>
  );

  const rodape = (
    <div className="border-t border-[var(--menu-divisor)] pt-3">
      <div className="px-3 text-sm font-semibold text-[var(--menu-texto-forte)]">{perfil.nome}</div>
      <div className="px-3 text-xs text-[var(--menu-texto-fraco)]">{perfil.admin ? "Administrador" : "@" + perfil.usuario}</div>
      <button onClick={sair} className="mt-2 w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--menu-texto)] hover:bg-[var(--menu-hover-fundo)] hover:text-[var(--menu-hover-texto)]">Sair</button>
    </div>
  );

  return (
    <ProvedorPerfil perfil={perfil}>
      <div className="min-h-full lg:pl-64 print:pl-0">
        {/* menu lateral (computador) */}
        <aside className="nao-imprimir fixed inset-y-0 left-0 hidden w-64 flex-col gap-4 border-r border-[var(--menu-borda)] bg-[var(--menu-fundo)] p-3 lg:flex">
          <div className="px-3 pt-2 font-display text-xl font-bold uppercase leading-tight tracking-wide text-[var(--menu-marca)]">
            {process.env.NEXT_PUBLIC_EMPRESA_NOME || "Distribuidora"}
          </div>
          <div className="flex-1 overflow-y-auto">{nav}</div>
          {rodape}
        </aside>

        {/* barra do topo (celular) */}
        <header className="nao-imprimir sticky top-0 z-30 flex items-center justify-between border-b border-[var(--topo-borda)] bg-[var(--topo-fundo)] px-4 py-3 text-[var(--topo-texto)] lg:hidden">
          <span className="font-display text-lg font-bold uppercase tracking-wide">{process.env.NEXT_PUBLIC_EMPRESA_NOME || "Distribuidora"}</span>
          <button onClick={() => setAberto(true)} className="rounded-lg border border-current/30 px-3 py-1 text-sm font-semibold">Menu</button>
        </header>
        {aberto && (
          <div className="nao-imprimir fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setAberto(false)}>
            <aside className="flex h-full w-72 flex-col gap-4 bg-[var(--menu-fundo)] p-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex-1 overflow-y-auto pt-2">{nav}</div>
              {rodape}
            </aside>
          </div>
        )}

        <main className="mx-auto max-w-7xl p-4 sm:p-6 print:max-w-none print:p-0">{perfil.admin && <VerificaBanco />}{children}</main>
      </div>
      <Avisos />
      <SincronizaVisual />
      <BarraPrevia admin={perfil.admin} />
    </ProvedorPerfil>
  );
}
