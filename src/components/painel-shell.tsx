"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { combina } from "@/lib/formato";
import type { Perfil, Permissao } from "@/lib/tipos";
import { ProvedorPerfil } from "./perfil-contexto";
import { Avisos } from "./ui";
import { VerificaBanco } from "./verifica-banco";
import { BarraPrevia, SincronizaVisual } from "./visual";

/* =====================================================================
   Moldura do sistema (menu e barras). Os 4 layouts ficam desenhados e o
   CSS mostra só o escolhido (html[data-layout]), assim a página já abre
   no layout certo, sem piscar. Ver Aparência.
   ===================================================================== */

type AreaId = "inicio" | "vendas" | "entregas" | "clientes" | "produtos" | "gestao" | "sistema";
type Item = { href: string; nome: string; curto?: string; icone: string; area: AreaId; perm?: Permissao | Permissao[]; admin?: boolean };

const AREAS: { id: AreaId; nome: string; icone: string }[] = [
  { id: "inicio", nome: "Início", icone: "🏠" },
  { id: "vendas", nome: "Vendas", icone: "🛒" },
  { id: "entregas", nome: "Entregas", icone: "🚚" },
  { id: "clientes", nome: "Clientes", icone: "🏪" },
  { id: "produtos", nome: "Produtos", icone: "📦" },
  { id: "gestao", nome: "Gestão", icone: "📊" },
  { id: "sistema", nome: "Sistema", icone: "⚙️" },
];

// a ordem desta lista é a do menu "Lateral"; nos outros layouts as telas vão para a área de cada uma
const MENU: Item[] = [
  { href: "/painel", nome: "Início", icone: "🏠", area: "inicio" },
  { href: "/pedidos/novo", nome: "Novo pedido", curto: "Novo", icone: "➕", area: "vendas", perm: ["pedidos_criar", "pedidos_ver_todos"] },
  { href: "/pedidos/novo?entrega=balcao", nome: "Venda no balcão", curto: "Balcão", icone: "🏪", area: "vendas", perm: "pedidos_ver_todos" },
  { href: "/moto", nome: "Entregas de moto", curto: "Moto", icone: "🏍️", area: "entregas", perm: ["moto", "pedidos_ver_todos"] },
  { href: "/link", nome: "Link de pedidos", curto: "Link", icone: "🔗", area: "vendas", perm: "pedidos_ver_todos" },
  { href: "/pedidos", nome: "Pedidos", icone: "📋", area: "vendas", perm: "pedidos_ver_todos" },
  { href: "/imprimir/automatica", nome: "Impressão automática", curto: "Impressão", icone: "🖨️", area: "vendas", perm: ["pedidos_ver_todos", "cargas"] },
  { href: "/cargas", nome: "Cargas e romaneio", curto: "Cargas", icone: "🚚", area: "entregas", perm: "cargas" },
  { href: "/conferencia", nome: "Conferência", icone: "✅", area: "entregas", perm: "conferencia" },
  { href: "/clientes", nome: "Clientes", icone: "🏪", area: "clientes", perm: "clientes" },
  { href: "/bairros", nome: "Bairros", icone: "🏘️", area: "clientes", perm: ["clientes", "cadastros"] },
  { href: "/roteiros", nome: "Roteiro de visitas", curto: "Roteiro", icone: "🗺️", area: "clientes", perm: ["clientes", "cadastros"] },
  { href: "/agenda", nome: "Agenda de visitas", curto: "Agenda", icone: "🗓️", area: "clientes", perm: ["clientes", "cadastros"] },
  { href: "/visitas", nome: "Visitas do dia", curto: "Visitas", icone: "📍", area: "clientes", perm: "pedidos_ver_todos" },
  { href: "/produtos", nome: "Produtos", icone: "📦", area: "produtos", perm: "produtos" },
  { href: "/categorias", nome: "Categorias (ordem)", curto: "Categorias", icone: "↕️", area: "produtos", perm: "produtos" },
  { href: "/estoque", nome: "Estoque", icone: "🏬", area: "produtos", perm: "estoque" },
  { href: "/cadastros", nome: "Motoristas, veículos…", curto: "Veículos", icone: "🗂️", area: "produtos", perm: ["cadastros", "produtos"] },
  { href: "/recebimentos", nome: "Recebimentos", curto: "Receber", icone: "💵", area: "gestao", perm: ["financeiro", "pedidos_ver_todos"] },
  { href: "/clube", nome: "Clube de pontos", curto: "Clube", icone: "🎁", area: "gestao", perm: ["pedidos_ver_todos", "clientes", "financeiro"] },
  { href: "/recibos", nome: "Recibos", icone: "🧾", area: "gestao", perm: ["pedidos_ver_todos", "financeiro"] },
  { href: "/financeiro", nome: "Financeiro", icone: "💰", area: "gestao", perm: "financeiro" },
  { href: "/abastecer", nome: "Abastecer carro", curto: "Abastecer", icone: "⛽", area: "entregas", perm: "abastecimento" },
  { href: "/abastecimentos", nome: "Relatório de combustível", curto: "Combustível", icone: "📈", area: "entregas", perm: ["abastecimento", "financeiro"] },
  { href: "/vendedores", nome: "Vendedores", icone: "📊", area: "gestao", admin: true },
  { href: "/ranking", nome: "Ranking", icone: "🏆", area: "gestao", admin: true },
  { href: "/usuarios", nome: "Usuários", icone: "👥", area: "sistema", admin: true },
  { href: "/aparencia", nome: "Aparência", icone: "🎨", area: "sistema", admin: true },
  { href: "/empresa", nome: "Dados da empresa", curto: "Empresa", icone: "🏢", area: "sistema", admin: true },
  { href: "/vender", nome: "App do vendedor", curto: "App", icone: "📱", area: "sistema", perm: "pedidos_criar" },
];

/** telas da barra de baixo do celular (as 4 primeiras que a pessoa pode ver) */
const PREFERIDAS = ["/painel", "/pedidos/novo", "/pedidos", "/cargas", "/moto", "/abastecer", "/clientes", "/abastecimentos", "/estoque", "/produtos", "/financeiro", "/conferencia", "/vender"];

const EMPRESA = process.env.NEXT_PUBLIC_EMPRESA_NOME || "Distribuidora";
const INICIAIS = EMPRESA.split(/\s+/).filter((p) => p.length > 2).slice(0, 2).map((p) => p[0]).join("").toUpperCase() || "D";

function visivel(p: Perfil, i: Item) {
  if (p.admin) return true;
  if (i.admin) return false;
  if (!i.perm) return true;
  const lista = Array.isArray(i.perm) ? i.perm : [i.perm];
  return lista.some((x) => p.permissoes.includes(x));
}

/** a tela mais específica ganha (/pedidos/novo não acende "Pedidos") */
function itemAtivo(caminho: string, itens: Item[]) {
  return itens
    .filter((i) => !i.href.includes("?") && (caminho === i.href || caminho.startsWith(i.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/* ---------- pedaços usados pelos layouts ---------- */
const corItemMenu = (ativo: boolean) => ativo
  ? "bg-[var(--menu-ativo-fundo)] font-semibold text-[var(--menu-ativo-texto)]"
  : "text-[var(--menu-texto)] hover:bg-[var(--menu-hover-fundo)] hover:text-[var(--menu-hover-texto)]";

function LinkMenu({ i, ativo, compacto, aoClicar }: { i: Item; ativo: boolean; compacto?: boolean; aoClicar?: () => void }) {
  return (
    <Link href={i.href} onClick={aoClicar} aria-current={ativo ? "page" : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 font-medium ${compacto ? "py-1.5 text-sm" : "py-2 text-[15px]"} ${corItemMenu(ativo)}`}>
      <span className="w-5 text-center" aria-hidden>{i.icone}</span>
      {i.nome}
    </Link>
  );
}

function Rodape({ perfil, sair }: { perfil: Perfil; sair: () => void }) {
  return (
    <div className="border-t border-[var(--menu-divisor)] pt-3">
      <div className="px-3 text-sm font-semibold text-[var(--menu-texto-forte)]">{perfil.nome}</div>
      <div className="px-3 text-xs text-[var(--menu-texto-fraco)]">{perfil.admin ? "Administrador" : "@" + perfil.usuario}</div>
      <button onClick={sair} className="mt-2 w-full rounded-lg px-3 py-2 text-left text-sm text-[var(--menu-texto)] hover:bg-[var(--menu-hover-fundo)] hover:text-[var(--menu-hover-texto)]">Sair</button>
    </div>
  );
}

/** Folha "Mais" do celular: todas as telas por área */
function FolhaMais({ grupos, ativo, perfil, sair, fechar }: {
  grupos: { area: (typeof AREAS)[number]; itens: Item[] }[]; ativo?: Item; perfil: Perfil; sair: () => void; fechar: () => void;
}) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => e.key === "Escape" && fechar();
    document.addEventListener("keydown", f);
    return () => document.removeEventListener("keydown", f);
  }, [fechar]);
  return (
    <div className="nao-imprimir fixed inset-0 z-50 bg-black/50 lg:hidden" onClick={fechar}>
      <div role="dialog" aria-modal="true" aria-label="Todas as telas" onClick={(e) => e.stopPropagation()}
        className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-2xl bg-white px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] dark:bg-zinc-900">
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-zinc-300 dark:bg-zinc-700" />
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold uppercase tracking-wide">Todas as telas</h2>
          <button onClick={fechar} aria-label="Fechar" className="grid size-9 place-items-center rounded-full text-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">×</button>
        </div>
        {grupos.map(({ area, itens }) => (
          <section key={area.id} className="mt-3">
            {area.id !== "inicio" && <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-zinc-500">{area.icone} {area.nome}</h3>}
            <div className="grid grid-cols-2 gap-2">
              {itens.map((i) => (
                <Link key={i.href} href={i.href} onClick={fechar}
                  className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${ativo?.href === i.href ? "border-marca-500 bg-marca-50 text-marca-700 dark:bg-marca-500/15 dark:text-marca-200" : "border-zinc-200 text-zinc-800 dark:border-zinc-700 dark:text-zinc-100"}`}>
                  <span aria-hidden>{i.icone}</span><span className="min-w-0 leading-tight">{i.nome}</span>
                </Link>
              ))}
            </div>
          </section>
        ))}
        <div className="mt-4 flex items-center justify-between border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
          <span><b>{perfil.nome}</b> <span className="text-zinc-500">{perfil.admin ? "· Administrador" : "@" + perfil.usuario}</span></span>
          <button onClick={sair} className="rounded-lg border border-zinc-300 px-3 py-1.5 font-semibold dark:border-zinc-700">Sair</button>
        </div>
      </div>
    </div>
  );
}

/** Barra de baixo do celular */
function BarraBaixo({ botoes, abrirMais }: { botoes: { href: string; rotulo: string; icone: string; ativo: boolean }[]; abrirMais: () => void }) {
  return (
    <nav aria-label="Atalhos" className="nao-imprimir fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom,0px)] dark:border-zinc-800 dark:bg-zinc-900 lg:hidden">
      <div className="grid h-[62px] grid-cols-5">
        {botoes.map((b) => (
          <Link key={b.href} href={b.href} aria-current={b.ativo ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${b.ativo ? "text-marca-600 dark:text-marca-500" : "text-zinc-500 dark:text-zinc-400"}`}>
            <span className={`grid h-7 w-12 place-items-center rounded-full text-lg ${b.ativo ? "bg-marca-100 dark:bg-marca-500/20" : ""}`} aria-hidden>{b.icone}</span>
            <span className="max-w-full truncate px-1">{b.rotulo}</span>
          </Link>
        ))}
        <button onClick={abrirMais} className="flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
          <span className="grid h-7 w-12 place-items-center text-lg" aria-hidden>☰</span>Mais
        </button>
      </div>
    </nav>
  );
}

export function PainelShell({ perfil, children }: { perfil: Perfil; children: React.ReactNode }) {
  const caminho = usePathname();
  const router = useRouter();
  const [gaveta, setGaveta] = useState(false);       // layout Lateral, celular
  const [mais, setMais] = useState(false);           // folha "Mais", celular
  const [aberto, setAberto] = useState<AreaId | null>(null); // lista aberta no menu do topo
  const [busca, setBusca] = useState("");
  const topoRef = useRef<HTMLDivElement>(null);

  const itens = useMemo(() => MENU.filter((i) => visivel(perfil, i)), [perfil]);
  const ativo = itemAtivo(caminho, itens);
  const grupos = useMemo(() => AREAS.map((area) => ({ area, itens: itens.filter((i) => i.area === area.id) })).filter((g) => g.itens.length), [itens]);
  const areaAtiva = ativo?.area;
  const abas = grupos.find((g) => g.area.id === areaAtiva)?.itens ?? [];

  // fecha menus ao trocar de tela; a aba da tela atual fica à vista (celular)
  useEffect(() => {
    setGaveta(false); setMais(false); setAberto(null);
    document.querySelector<HTMLElement>("[data-aba-ativa]")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [caminho]);
  // fecha a lista do topo ao clicar fora
  useEffect(() => {
    if (!aberto) return;
    const f = (e: MouseEvent) => { if (!topoRef.current?.contains(e.target as Node)) setAberto(null); };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setAberto(null);
    document.addEventListener("mousedown", f);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", f); document.removeEventListener("keydown", k); };
  }, [aberto]);

  async function sair() {
    await supabaseNavegador().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  // barra de baixo: telas preferidas (Menu por grupos e Menu no topo) ou áreas (Áreas com abas)
  const botoesTelas = PREFERIDAS.map((h) => itens.find((i) => i.href === h)).filter((i): i is Item => !!i).slice(0, 4)
    .map((i) => ({ href: i.href, rotulo: i.curto ?? i.nome, icone: i.icone, ativo: ativo?.href === i.href }));
  const botoesAreas = grupos.slice(0, 4).map((g) => ({ href: g.itens[0].href, rotulo: g.area.nome, icone: g.area.icone, ativo: areaAtiva === g.area.id }));
  const filtrados = busca.trim() ? grupos.map((g) => ({ ...g, itens: g.itens.filter((i) => combina(i.nome, busca)) })).filter((g) => g.itens.length) : grupos;

  return (
    <ProvedorPerfil perfil={perfil}>
      {/* ================= 1. LATERAL (o de sempre) ================= */}
      <div className="lay-lateral">
        <aside className="nao-imprimir fixed inset-y-0 left-0 hidden w-64 flex-col gap-4 border-r border-[var(--menu-borda)] bg-[var(--menu-fundo)] p-3 lg:flex">
          <div className="px-3 pt-2 font-display text-xl font-bold uppercase leading-tight tracking-wide text-[var(--menu-marca)]">{EMPRESA}</div>
          <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">{itens.map((i) => <LinkMenu key={i.href} i={i} ativo={ativo?.href === i.href} />)}</nav>
          <Rodape perfil={perfil} sair={sair} />
        </aside>
        {gaveta && (
          <div className="nao-imprimir fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setGaveta(false)}>
            <aside className="flex h-full w-72 flex-col gap-4 bg-[var(--menu-fundo)] p-3" onClick={(e) => e.stopPropagation()}>
              <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto pt-2">{itens.map((i) => <LinkMenu key={i.href} i={i} ativo={ativo?.href === i.href} aoClicar={() => setGaveta(false)} />)}</nav>
              <Rodape perfil={perfil} sair={sair} />
            </aside>
          </div>
        )}
      </div>

      {/* ================= 2. MENU POR GRUPOS ================= */}
      <div className="lay-grupos">
        <aside className="nao-imprimir fixed inset-y-0 left-0 hidden w-60 flex-col gap-3 border-r border-[var(--menu-borda)] bg-[var(--menu-fundo)] p-3 lg:flex">
          <div className="px-2 pt-1 font-display text-lg font-bold uppercase leading-tight tracking-wide text-[var(--menu-marca)]">{EMPRESA}</div>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="🔍 Buscar tela…" aria-label="Buscar tela"
            className="w-full rounded-lg border border-[var(--menu-divisor)] bg-[var(--menu-hover-fundo)] px-3 py-1.5 text-sm text-[var(--menu-texto-forte)] outline-none placeholder:text-[var(--menu-texto-fraco)] focus:border-marca-500" />
          <nav className="flex-1 overflow-y-auto">
            {filtrados.map(({ area, itens: lista }) => (
              <div key={area.id} className="mb-2">
                {area.id !== "inicio" && <div className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-[var(--menu-texto-fraco)]">{area.nome}</div>}
                <div className="flex flex-col gap-0.5">{lista.map((i) => <LinkMenu key={i.href} i={i} ativo={ativo?.href === i.href} compacto />)}</div>
              </div>
            ))}
            {filtrados.length === 0 && <p className="px-3 text-sm text-[var(--menu-texto-fraco)]">Nenhuma tela com esse nome.</p>}
          </nav>
          <Rodape perfil={perfil} sair={sair} />
        </aside>
      </div>

      {/* ================= 3. MENU NO TOPO ================= */}
      <div className="lay-topo">
        <div ref={topoRef} className="nao-imprimir fixed inset-x-0 top-0 z-30 hidden h-14 items-center gap-1 border-b border-[var(--topo-borda)] bg-[var(--topo-fundo)] px-4 text-[var(--topo-texto)] lg:flex">
          <Link href="/painel" className="mr-3 font-display text-lg font-bold uppercase tracking-wide whitespace-nowrap">{EMPRESA}</Link>
          {grupos.map(({ area, itens: lista }) => area.id === "inicio" ? (
            <Link key={area.id} href="/painel" className={`rounded-lg px-3 py-1.5 text-[15px] font-semibold ${areaAtiva === "inicio" ? "bg-white/20" : "hover:bg-white/10"}`}>Início</Link>
          ) : (
            <div key={area.id} className="relative">
              <button onClick={() => setAberto(aberto === area.id ? null : area.id)} aria-expanded={aberto === area.id}
                className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-[15px] font-semibold ${areaAtiva === area.id || aberto === area.id ? "bg-white/20" : "hover:bg-white/10"}`}>
                {area.nome}<span className="text-[10px] opacity-70" aria-hidden>▼</span>
              </button>
              {aberto === area.id && (
                <div className="absolute left-0 top-full mt-2 w-64 rounded-xl border border-zinc-200 bg-white p-1.5 text-zinc-800 shadow-xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
                  {lista.map((i) => (
                    <Link key={i.href} href={i.href} onClick={() => setAberto(null)}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] ${ativo?.href === i.href ? "bg-marca-50 font-semibold text-marca-700 dark:bg-marca-500/15 dark:text-marca-200" : "hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}>
                      <span className="w-5 text-center" aria-hidden>{i.icone}</span>{i.nome}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="whitespace-nowrap opacity-90">{perfil.nome}</span>
            <button onClick={sair} className="rounded-lg border border-current/30 px-3 py-1 font-semibold">Sair</button>
          </div>
        </div>
      </div>

      {/* ================= 4. ÁREAS COM ABAS ================= */}
      <div className="lay-areas">
        <aside className="nao-imprimir fixed inset-y-0 left-0 z-30 hidden w-[84px] flex-col items-center gap-1 border-r border-[var(--menu-borda)] bg-[var(--menu-fundo)] py-3 lg:flex">
          <Link href="/painel" title={EMPRESA} className="mb-2 grid size-11 place-items-center rounded-xl bg-marca-500 font-display text-lg font-bold text-white">{INICIAIS}</Link>
          {grupos.map(({ area, itens: lista }) => (
            <Link key={area.id} href={lista[0].href} title={area.nome} aria-current={areaAtiva === area.id ? "page" : undefined}
              className={`flex w-[72px] flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] font-semibold ${corItemMenu(areaAtiva === area.id)}`}>
              <span className="text-2xl leading-none" aria-hidden>{area.icone}</span>{area.nome}
            </Link>
          ))}
          <div className="mt-auto flex flex-col items-center gap-1">
            <div title={perfil.nome} className="grid size-9 place-items-center rounded-full bg-[var(--menu-hover-fundo)] text-sm font-bold text-[var(--menu-texto-forte)]">{perfil.nome.slice(0, 1).toUpperCase()}</div>
            <button onClick={sair} className="rounded-lg px-2 py-1 text-[11px] font-semibold text-[var(--menu-texto)] hover:bg-[var(--menu-hover-fundo)]">Sair</button>
          </div>
        </aside>
      </div>

      {/* ================= celular ================= */}
      <header className="nao-imprimir sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[var(--topo-borda)] bg-[var(--topo-fundo)] px-4 py-3 text-[var(--topo-texto)] lg:hidden">
        <span className="truncate font-display text-lg font-bold uppercase tracking-wide">{EMPRESA}</span>
        <span className="lay-lateral"><button onClick={() => setGaveta(true)} className="rounded-lg border border-current/30 px-3 py-1 text-sm font-semibold">Menu</button></span>
        <span className="lay-grupos lay-topo lay-areas"><span className="truncate text-sm opacity-80">{perfil.nome.split(" ")[0]}</span></span>
      </header>
      <div className="lay-grupos lay-topo"><BarraBaixo botoes={botoesTelas} abrirMais={() => setMais(true)} /></div>
      <div className="lay-areas"><BarraBaixo botoes={botoesAreas} abrirMais={() => setMais(true)} /></div>
      {mais && <FolhaMais grupos={grupos} ativo={ativo} perfil={perfil} sair={sair} fechar={() => setMais(false)} />}

      <div className="casca">
        {/* Áreas com abas: as telas da área ficam em abas no alto */}
        {abas.length > 1 && (
          <div className="lay-areas">
            <nav aria-label="Telas da área" className="nao-imprimir z-20 border-b border-zinc-200 bg-white lg:sticky lg:top-0 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-2 sm:px-4">
                {abas.map((i) => (
                  <Link key={i.href} href={i.href} aria-current={ativo?.href === i.href ? "page" : undefined} data-aba-ativa={ativo?.href === i.href ? "" : undefined}
                    className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-semibold whitespace-nowrap ${ativo?.href === i.href ? "border-marca-500 text-marca-700 dark:text-marca-500" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"}`}>
                    <span aria-hidden>{i.icone}</span>{i.nome}
                  </Link>
                ))}
              </div>
            </nav>
          </div>
        )}
        <main className="mx-auto max-w-7xl p-4 sm:p-6 print:max-w-none print:p-0">
          {perfil.admin && <VerificaBanco />}
          {children}
        </main>
      </div>
      <Avisos />
      <SincronizaVisual />
      <BarraPrevia admin={perfil.admin} />
    </ProvedorPerfil>
  );
}
