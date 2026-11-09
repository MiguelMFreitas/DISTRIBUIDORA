export type Permissao =
  | "pedidos_criar"
  | "pedidos_ver_todos"
  | "clientes"
  | "produtos"
  | "estoque"
  | "cargas"
  | "conferencia"
  | "cadastros";

export const PERMISSOES: { chave: Permissao; nome: string; descricao: string }[] = [
  { chave: "pedidos_criar", nome: "Fazer pedidos", descricao: "Usa o app do vendedor no celular" },
  { chave: "pedidos_ver_todos", nome: "Ver e imprimir todos os pedidos", descricao: "Lista de pedidos, impressão e cancelamento" },
  { chave: "clientes", nome: "Clientes", descricao: "Cadastrar e editar clientes" },
  { chave: "produtos", nome: "Produtos e categorias", descricao: "Produtos, preços, categorias e vasilhames" },
  { chave: "estoque", nome: "Estoque", descricao: "Lançar entradas e ajustes de estoque" },
  { chave: "cargas", nome: "Cargas e romaneio", descricao: "Montar cargas e imprimir o romaneio" },
  { chave: "conferencia", nome: "Conferência", descricao: "Conferir o retorno do caminhão" },
  { chave: "cadastros", nome: "Rotas, motoristas e veículos", descricao: "Cadastros de apoio" },
];

export type Perfil = {
  id: string;
  nome: string;
  usuario: string;
  admin: boolean;
  permissoes: Permissao[];
  desconto_max: number;
  telefone: string | null;
  ativo: boolean;
};

export type Unidade = "CX" | "FD" | "LT" | "UN";

export type Produto = {
  id: string;
  codigo: string | null;
  nome: string;
  categoria_id: string | null;
  unidade: Unidade;
  permite_meia: boolean;
  preco: number;
  peso_kg: number;
  estoque: number;
  estoque_minimo: number;
  vasilhame_id: string | null;
  vasilhames_por_unidade: number;
  ativo: boolean;
};

export type Cliente = {
  id: string;
  codigo: string | null;
  razao_social: string;
  nome_fantasia: string | null;
  cpf_cnpj: string | null;
  endereco: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  telefone: string | null;
  rota_id: string | null;
  vendedor_id: string | null;
  observacao: string | null;
  ativo: boolean;
};

export type StatusPedido =
  | "aguardando_aprovacao"
  | "liberado"
  | "carregado"
  | "entregue"
  | "cancelado"
  | "recusado";

export const STATUS_PEDIDO: Record<StatusPedido, { nome: string; cor: string }> = {
  aguardando_aprovacao: { nome: "Aguardando aprovação", cor: "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200" },
  liberado: { nome: "Liberado", cor: "bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200" },
  carregado: { nome: "Carregado", cor: "bg-violet-100 text-violet-900 dark:bg-violet-500/20 dark:text-violet-200" },
  entregue: { nome: "Entregue", cor: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200" },
  cancelado: { nome: "Cancelado", cor: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300" },
  recusado: { nome: "Recusado", cor: "bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-200" },
};

export type Pedido = {
  id: string;
  numero: number;
  cliente_id: string;
  vendedor_id: string | null;
  status: StatusPedido;
  carga_id: string | null;
  total: number;
  peso_kg: number;
  observacao: string | null;
  feito_em: string;
  criado_em: string;
  impresso_em: string | null;
};

export type Carga = {
  id: string;
  numero: number;
  nome: string | null;
  data: string;
  turno: "manha" | "tarde";
  veiculo_id: string | null;
  motorista_id: string | null;
  status: "montando" | "saiu" | "conferida";
  observacao: string | null;
  saiu_em: string | null;
};

export const STATUS_CARGA: Record<string, [string, string]> = {
  montando: ["Montando", "bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200"],
  saiu: ["Saiu para entrega", "bg-violet-100 text-violet-900 dark:bg-violet-500/20 dark:text-violet-200"],
  conferida: ["Conferida", "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200"],
};
