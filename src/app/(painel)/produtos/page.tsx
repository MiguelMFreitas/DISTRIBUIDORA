"use client";

import { Cadastro, type Campo, type Coluna } from "@/components/cadastro";
import { Cabecalho, Selo } from "@/components/ui";
import { Exige, usePode } from "@/components/perfil-contexto";
import { fmtMoeda, fmtPeso, fmtQtd } from "@/lib/formato";

const CAMPOS: Campo[] = [
  { nome: "nome", rotulo: "Descrição do produto", obrigatorio: true, largura: 3, maiusculo: true },
  { nome: "codigo", rotulo: "Código", largura: 2 },
  { nome: "categoria_id", rotulo: "Categoria (ordem no caminhão)", ref: { tabela: "categorias", rotulo: "nome", ordem: "ordem" }, largura: 3 },
  {
    nome: "unidade", rotulo: "Vendido em", tipo: "select", obrigatorio: true, padrao: "CX", largura: 3,
    opcoes: [{ valor: "CX", nome: "Caixa" }, { valor: "FD", nome: "Fardo" }, { valor: "LT", nome: "Litro" }, { valor: "UN", nome: "Unidade" }],
  },
  { nome: "permite_meia", rotulo: "Vende meia caixa / meio fardo", tipo: "bool", largura: 6 },
  { nome: "preco", rotulo: "Preço de venda (R$)", tipo: "moeda", obrigatorio: true, largura: 2 },
  { nome: "custo", rotulo: "Custo (R$)", tipo: "moeda", largura: 2, ajuda: "Atualiza sozinho a cada entrada" },
  { nome: "peso_kg", rotulo: "Peso (kg) por unidade", tipo: "numero", largura: 2, ajuda: "Peso de 1 caixa/fardo/litro" },
  { nome: "estoque_minimo", rotulo: "Estoque mínimo", tipo: "numero", largura: 2, ajuda: "Avisa quando ficar abaixo" },
  { nome: "vasilhame_id", rotulo: "Vasilhame que deve voltar", ref: { tabela: "vasilhames", rotulo: "nome" }, largura: 3, ajuda: "Só para retornáveis" },
  { nome: "vasilhames_por_unidade", rotulo: "Cascos por unidade vendida", tipo: "numero", padrao: 1, largura: 3 },
  { nome: "ativo", rotulo: "Ativo (aparece para os vendedores)", tipo: "bool", padrao: true },
];

const COLUNAS: Coluna[] = [
  { rotulo: "Cód.", valor: (l) => l.codigo ?? "—", classe: "text-zinc-500 w-16" },
  { rotulo: "Produto", valor: (l) => <span className="font-semibold">{l.nome}</span> },
  { rotulo: "Categoria", valor: (l, r) => r.categoria_id?.[l.categoria_id] ?? <span className="text-red-600">sem categoria</span> },
  { rotulo: "Un.", valor: (l) => l.unidade + (l.permite_meia ? " ½" : "") },
  { rotulo: "Preço", valor: (l) => fmtMoeda(l.preco), classe: "text-right whitespace-nowrap" },
  { rotulo: "Custo", valor: (l) => (Number(l.custo) > 0 ? fmtMoeda(l.custo) : <span className="text-amber-600">sem custo</span>), classe: "text-right whitespace-nowrap" },
  { rotulo: "Peso", valor: (l) => fmtPeso(l.peso_kg), classe: "text-right whitespace-nowrap" },
  {
    rotulo: "Estoque", classe: "text-right",
    valor: (l) => {
      const cor = l.estoque <= 0 ? "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200"
        : l.estoque <= l.estoque_minimo ? "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200" : "bg-zinc-100 dark:bg-zinc-800";
      return <Selo cor={cor}>{fmtQtd(l.estoque)}</Selo>;
    },
  },
];

const filtros = (linhas: Record<string, unknown>[]) => [
  { nome: "Estoque baixo", teste: (l: Record<string, any>) => l.estoque > 0 && l.estoque <= l.estoque_minimo }, // eslint-disable-line @typescript-eslint/no-explicit-any
  { nome: "Sem estoque", teste: (l: Record<string, any>) => l.estoque <= 0 }, // eslint-disable-line @typescript-eslint/no-explicit-any
  ...(linhas.some((l) => !l.categoria_id) ? [{ nome: "Sem categoria", teste: (l: Record<string, unknown>) => !l.categoria_id }] : []),
];

export default function Produtos() {
  const pode = usePode();
  return (
    <Exige perm="produtos">
      <Cabecalho titulo="Produtos" sub="O estoque muda pela tela de Estoque, pelos pedidos e pela conferência." />
      <Cadastro tabela="produtos" singular="Produto" campos={CAMPOS} colunas={COLUNAS} ordem="nome" podeEditar={pode("produtos")}
        buscaEm={["nome", "codigo"]} filtros={filtros} />
    </Exige>
  );
}
