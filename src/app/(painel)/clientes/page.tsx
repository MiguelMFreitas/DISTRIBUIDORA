"use client";

import { Cadastro, type Campo, type Coluna } from "@/components/cadastro";
import { Cabecalho } from "@/components/ui";
import { Exige, usePode } from "@/components/perfil-contexto";

const CAMPOS: Campo[] = [
  { nome: "razao_social", rotulo: "Razão social", obrigatorio: true, largura: 3, maiusculo: true },
  { nome: "nome_fantasia", rotulo: "Nome fantasia", largura: 3, maiusculo: true },
  { nome: "codigo", rotulo: "Código", largura: 1 },
  { nome: "cpf_cnpj", rotulo: "CPF / CNPJ", largura: 2 },
  { nome: "inscricao_estadual", rotulo: "Inscrição estadual", largura: 3 },
  { nome: "endereco", rotulo: "Endereço", largura: 3, maiusculo: true },
  { nome: "numero", rotulo: "Número", largura: 1 },
  { nome: "bairro", rotulo: "Bairro", largura: 2, maiusculo: true },
  { nome: "cidade", rotulo: "Cidade", largura: 2, maiusculo: true },
  { nome: "cep", rotulo: "CEP", largura: 1 },
  { nome: "referencia", rotulo: "Ponto de referência", largura: 3 },
  { nome: "telefone", rotulo: "Telefone", largura: 3 },
  { nome: "telefone2", rotulo: "Telefone 2", largura: 3 },
  { nome: "rota_id", rotulo: "Rota", ref: { tabela: "rotas", rotulo: "nome" }, largura: 3 },
  { nome: "vendedor_id", rotulo: "Vendedor (dono do cliente)", ref: { tabela: "perfis", rotulo: "nome" }, largura: 3, obrigatorio: true, ajuda: "Só este vendedor pode fazer pedido para o cliente" },
  { nome: "observacao", rotulo: "Observação", tipo: "area" },
  { nome: "ativo", rotulo: "Ativo", tipo: "bool", padrao: true },
];

const COLUNAS: Coluna[] = [
  { rotulo: "Cód.", valor: (l) => l.codigo ?? "—", classe: "text-zinc-500 w-16" },
  { rotulo: "Cliente", valor: (l) => (<><div className="font-semibold">{l.razao_social}</div>{l.nome_fantasia && <div className="text-sm text-zinc-500">{l.nome_fantasia}</div>}</>) },
  { rotulo: "Endereço", valor: (l) => [l.endereco && `${l.endereco}${l.numero ? ", " + l.numero : ""}`, l.bairro, l.cidade].filter(Boolean).join(" · ") || "—", classe: "text-sm" },
  { rotulo: "Telefone", valor: (l) => l.telefone ?? "—", classe: "whitespace-nowrap" },
  { rotulo: "Rota", valor: (l, r) => r.rota_id?.[l.rota_id] ?? "—" },
  { rotulo: "Vendedor", valor: (l, r) => r.vendedor_id?.[l.vendedor_id] ?? <b className="text-red-600">sem vendedor</b> },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const filtros = (linhas: Record<string, any>[]) => (linhas.some((l) => !l.vendedor_id) ? [{ nome: `Sem vendedor (${linhas.filter((l) => !l.vendedor_id && l.ativo).length})`, teste: (l: Record<string, unknown>) => !l.vendedor_id }] : []);

export default function Clientes() {
  const pode = usePode();
  return (
    <Exige perm="clientes">
      <Cabecalho titulo="Clientes" sub="Cada cliente é de um vendedor. Só ele vê o cliente no celular e faz pedido para ele." />
      <Cadastro tabela="clientes" singular="Cliente" campos={CAMPOS} colunas={COLUNAS} ordem="razao_social" podeEditar={pode("clientes")}
        buscaEm={["razao_social", "nome_fantasia", "codigo", "cpf_cnpj", "bairro", "cidade", "telefone"]} filtros={filtros} />
    </Exige>
  );
}
