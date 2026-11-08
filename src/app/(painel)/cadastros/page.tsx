"use client";

import { useState } from "react";
import { Cadastro, type Campo, type Coluna } from "@/components/cadastro";
import { Cabecalho } from "@/components/ui";
import { usePode } from "@/components/perfil-contexto";
import type { Permissao } from "@/lib/tipos";

type Aba = { chave: string; nome: string; tabela: string; singular: string; perm: Permissao; campos: Campo[]; colunas: Coluna[]; busca: string[]; ordem: string };

const ABAS: Aba[] = [
  {
    chave: "rotas", nome: "Rotas", tabela: "rotas", singular: "Rota", perm: "cadastros", ordem: "nome", busca: ["nome"],
    campos: [{ nome: "nome", rotulo: "Nome da rota", obrigatorio: true, maiusculo: true }, { nome: "ativo", rotulo: "Ativa", tipo: "bool", padrao: true }],
    colunas: [{ rotulo: "Rota", valor: (l) => <span className="font-semibold">{l.nome}</span> }],
  },
  {
    chave: "motoristas", nome: "Motoristas", tabela: "motoristas", singular: "Motorista", perm: "cadastros", ordem: "nome", busca: ["nome", "telefone"],
    campos: [
      { nome: "nome", rotulo: "Nome", obrigatorio: true, largura: 3, maiusculo: true },
      { nome: "telefone", rotulo: "Telefone", largura: 3 },
      { nome: "ativo", rotulo: "Ativo", tipo: "bool", padrao: true },
    ],
    colunas: [{ rotulo: "Motorista", valor: (l) => <span className="font-semibold">{l.nome}</span> }, { rotulo: "Telefone", valor: (l) => l.telefone ?? "—" }],
  },
  {
    chave: "veiculos", nome: "Veículos", tabela: "veiculos", singular: "Veículo", perm: "cadastros", ordem: "nome", busca: ["nome", "placa"],
    campos: [
      { nome: "nome", rotulo: "Nome / modelo", obrigatorio: true, largura: 3, maiusculo: true },
      { nome: "placa", rotulo: "Placa", largura: 1, maiusculo: true },
      { nome: "capacidade_kg", rotulo: "Capacidade (kg)", tipo: "numero", largura: 2, ajuda: "O romaneio avisa se passar" },
      { nome: "ativo", rotulo: "Ativo", tipo: "bool", padrao: true },
    ],
    colunas: [
      { rotulo: "Veículo", valor: (l) => <span className="font-semibold">{l.nome}</span> },
      { rotulo: "Placa", valor: (l) => l.placa ?? "—" },
      { rotulo: "Capacidade", valor: (l) => (l.capacidade_kg ? `${Number(l.capacidade_kg).toLocaleString("pt-BR")} kg` : "—") },
    ],
  },
  {
    chave: "vasilhames", nome: "Vasilhames", tabela: "vasilhames", singular: "Vasilhame", perm: "produtos", ordem: "nome", busca: ["nome"],
    campos: [{ nome: "nome", rotulo: "Tipo de vasilhame (ex.: Engradado 600ml)", obrigatorio: true, maiusculo: true }, { nome: "ativo", rotulo: "Ativo", tipo: "bool", padrao: true }],
    colunas: [{ rotulo: "Vasilhame", valor: (l) => <span className="font-semibold">{l.nome}</span> }],
  },
];

export default function Cadastros() {
  const pode = usePode();
  const abas = ABAS.filter((a) => pode(a.perm));
  const [atual, setAtual] = useState(abas[0]?.chave);
  const aba = abas.find((a) => a.chave === atual);
  if (!aba) return <p>Sem acesso.</p>;
  return (
    <>
      <Cabecalho titulo="Cadastros de apoio" />
      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {abas.map((a) => (
          <button key={a.chave} role="tab" aria-selected={a.chave === atual} onClick={() => setAtual(a.chave)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold ${a.chave === atual ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "bg-white text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>
            {a.nome}
          </button>
        ))}
      </div>
      <Cadastro key={aba.chave} tabela={aba.tabela} singular={aba.singular} campos={aba.campos} colunas={aba.colunas} buscaEm={aba.busca} ordem={aba.ordem} podeEditar />
    </>
  );
}
