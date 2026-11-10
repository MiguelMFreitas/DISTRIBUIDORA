"use client";

import { openDB, type IDBPDatabase } from "idb";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cliente, Perfil, Produto } from "./tipos";
import type { ItemAgenda } from "./agenda";

/* ------------------------------------------------------------------
 * Tudo que o app do vendedor precisa para funcionar sem internet:
 *  - catálogo (produtos, clientes, categorias, perfil) guardado no aparelho
 *  - fila de pedidos feitos sem internet, enviados sozinhos depois
 * ------------------------------------------------------------------ */

export type ItemPedido = {
  produto_id: string;
  nome: string;
  unidade: string;
  permite_meia: boolean;
  preco: number;
  quantidade: number;
  desconto_pct: number;
};

export type PedidoFila = {
  client_id: string;
  cliente_id: string;
  cliente_nome: string;
  itens: ItemPedido[];
  observacao: string;
  feito_em: string;
  estado: "pendente" | "enviando" | "erro";
  erro?: string;
  faltas?: { produto_id: string; produto: string; pedido: number; disponivel: number }[];
};

export type PedidoEnviado = {
  client_id: string;
  cliente_id?: string;
  id: string;
  numero: number;
  status: string;
  cliente_nome: string;
  total: number;
  feito_em: string;
};

export type RotaVendedor = { id: string; nome: string; vendedor_id: string | null };

export type Catalogo = {
  produtos: Produto[];
  clientes: Cliente[];
  rotas: RotaVendedor[]; // rotas em que o vendedor é o responsável (roteiro de visitas)
  agenda: ItemAgenda[];  // qual rota em cada dia/período (vazio = todas as rotas todo dia)
  categorias: { id: string; nome: string; ordem: number }[];
  perfil: Perfil | null;
  atualizado_em: string | null;
};

let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB("distribuidora-vendas", 1, {
      upgrade(d) {
        d.createObjectStore("catalogo");
        d.createObjectStore("fila", { keyPath: "client_id" });
        d.createObjectStore("enviados", { keyPath: "client_id" });
      },
    });
  }
  return dbp;
}

export async function lerCatalogo(): Promise<Catalogo> {
  const d = await db();
  const [produtos, clientes, categorias, perfil, atualizado_em, rotas, agenda] = await Promise.all([
    d.get("catalogo", "produtos"), d.get("catalogo", "clientes"), d.get("catalogo", "categorias"), d.get("catalogo", "perfil"), d.get("catalogo", "atualizado_em"), d.get("catalogo", "rotas"), d.get("catalogo", "agenda"),
  ]);
  return { produtos: produtos ?? [], clientes: clientes ?? [], categorias: categorias ?? [], perfil: perfil ?? null, atualizado_em: atualizado_em ?? null, rotas: rotas ?? [], agenda: agenda ?? [] };
}

/** Baixa o catálogo do servidor e guarda no aparelho */
export async function atualizarCatalogo(sb: SupabaseClient, userId: string): Promise<Catalogo> {
  const [p, c, cat, pf, rt, ag] = await Promise.all([
    sb.from("produtos").select("*").eq("ativo", true).order("nome"),
    sb.from("clientes").select("id, codigo, razao_social, nome_fantasia, cpf_cnpj, endereco, numero, bairro, cidade, telefone, rota_id, vendedor_id, ordem_visita, observacao, ativo").eq("ativo", true).order("razao_social"),
    sb.from("categorias").select("id, nome, ordem").order("ordem"),
    sb.from("perfis").select("*").eq("id", userId).single(),
    // rotas em que ele trabalha: as que é responsável e as da agenda dele (bairro compartilhado)
    sb.rpc("rotas_do_vendedor", { p_vendedor: userId }).then(async (r) => {
      if (r.error) return r;
      const ids = (r.data ?? []) as string[];
      return ids.length ? sb.from("rotas").select("id, nome, vendedor_id").in("id", ids).eq("ativo", true).order("nome") : { data: [], error: null };
    }),
    sb.from("agenda_visitas").select("vendedor_id, dia_semana, turno, rota_id").eq("vendedor_id", userId),
  ]);
  const erro = p.error || c.error || cat.error || pf.error || rt.error || ag.error;
  if (erro) throw erro;
  const agora = new Date().toISOString();
  const d = await db();
  const tx = d.transaction("catalogo", "readwrite");
  await Promise.all([
    tx.store.put(p.data, "produtos"), tx.store.put(c.data, "clientes"), tx.store.put(cat.data, "categorias"),
    tx.store.put(pf.data, "perfil"), tx.store.put(agora, "atualizado_em"), tx.store.put(rt.data, "rotas"), tx.store.put(ag.data, "agenda"), tx.done,
  ]);
  return { produtos: p.data as Produto[], clientes: c.data as Cliente[], categorias: cat.data ?? [], perfil: pf.data as Perfil, atualizado_em: agora, rotas: (rt.data ?? []) as RotaVendedor[], agenda: (ag.data ?? []) as ItemAgenda[] };
}

export async function lerFila(): Promise<PedidoFila[]> {
  const l = (await (await db()).getAll("fila")) as PedidoFila[];
  return l.sort((a, b) => a.feito_em.localeCompare(b.feito_em));
}
export async function salvarNaFila(p: PedidoFila) { await (await db()).put("fila", p); }
export async function tirarDaFila(clientId: string) { await (await db()).delete("fila", clientId); }

export async function lerEnviados(): Promise<PedidoEnviado[]> {
  const l = (await (await db()).getAll("enviados")) as PedidoEnviado[];
  return l.sort((a, b) => b.feito_em.localeCompare(a.feito_em));
}
async function guardarEnviado(e: PedidoEnviado) {
  const d = await db();
  await d.put("enviados", e);
  // guarda só os 100 últimos
  const todos = (await d.getAll("enviados")) as PedidoEnviado[];
  todos.sort((a, b) => b.feito_em.localeCompare(a.feito_em)).slice(100).forEach((x) => d.delete("enviados", x.client_id));
}

export const totalItens = (itens: ItemPedido[]) =>
  itens.reduce((s, i) => s + Math.round(i.preco * (1 - i.desconto_pct / 100) * 100) / 100 * i.quantidade, 0);

function ehErroDeRede(e: { message?: string; code?: string } | null) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (!e) return false;
  const m = (e.message ?? "").toLowerCase();
  return !e.code && (m.includes("fetch") || m.includes("network") || m.includes("load failed") || m.includes("timeout"));
}

let sincronizando = false;

/**
 * Envia todos os pedidos pendentes. Pode ser chamado à vontade:
 * se já estiver rodando, não faz nada. O servidor ignora pedido repetido (client_id).
 */
export async function sincronizar(sb: SupabaseClient): Promise<{ enviados: number; erros: number; semRede: boolean; precisaLogin: boolean }> {
  const r = { enviados: 0, erros: 0, semRede: false, precisaLogin: false };
  if (sincronizando) return r;
  if (typeof navigator !== "undefined" && !navigator.onLine) return { ...r, semRede: true };
  sincronizando = true;
  try {
    const fila = (await lerFila()).filter((p) => p.estado !== "erro");
    for (const p of fila) {
      const { data, error } = await sb.rpc("criar_pedido", {
        p_client_id: p.client_id,
        p_cliente_id: p.cliente_id,
        p_itens: p.itens.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, desconto_pct: i.desconto_pct })),
        p_observacao: p.observacao || null,
        p_feito_em: p.feito_em,
      });
      if (error) {
        if (ehErroDeRede(error)) { r.semRede = true; break; }
        if (error.code === "PGRST301" || error.message?.toLowerCase().includes("jwt")) { r.precisaLogin = true; break; }
        let faltas: PedidoFila["faltas"];
        let msg = error.message;
        if (error.message === "ESTOQUE_INSUFICIENTE") {
          try { faltas = JSON.parse(error.details ?? "[]"); } catch {}
          msg = "Faltou estoque: " + (faltas ?? []).map((f) => `${f.produto} (tem ${f.disponivel})`).join(", ");
        }
        await salvarNaFila({ ...p, estado: "erro", erro: msg, faltas });
        r.erros++;
        continue;
      }
      const d = data as { id: string; numero: number; status: string };
      await guardarEnviado({ client_id: p.client_id, cliente_id: p.cliente_id, id: d.id, numero: d.numero, status: d.status, cliente_nome: p.cliente_nome, total: totalItens(p.itens), feito_em: p.feito_em });
      await tirarDaFila(p.client_id);
      r.enviados++;
    }
  } finally {
    sincronizando = false;
  }
  return r;
}

export function novoId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
