"use client";

import { useEffect, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { hojeISO } from "@/lib/formato";

/** Versão que este site espera do banco (a última atualização em supabase/migrations) */
export const VERSAO_ESPERADA = 28;
const PASTA = "https://github.com/MiguelMFreitas/DISTRIBUIDORA/tree/main/supabase/migrations";

type Falta = { n: string; arquivo: string; o_que: string };

/**
 * Confere se o banco do Supabase tem todas as atualizações. Só para administradores.
 * Cada teste só LÊ (nada é gravado). O resultado fica guardado na sessão.
 */
export function VerificaBanco() {
  const sb = supabaseNavegador();
  const [faltas, setFaltas] = useState<Falta[] | null>(null);

  useEffect(() => {
    try { const c = JSON.parse(sessionStorage.getItem("verifica_banco") ?? "null"); if (c && c.v === VERSAO_ESPERADA) { setFaltas(c.faltas); return; } } catch {}
    (async () => {
      const lerColuna = (tabela: string, coluna: string) => sb.from(tabela).select(coluna).limit(1);
      const testes: [string, string, string, () => PromiseLike<{ error: unknown }>][] = [
        ["04", "20261109000004_nome_da_carga.sql", "nome da carga", () => lerColuna("cargas", "nome")],
        ["05", "20261109000005_financeiro.sql", "financeiro (e correção de segurança)", () => lerColuna("produtos", "custo")],
        ["06", "20261109000006_recibos.sql", "recibos", () => lerColuna("recibos", "id")],
        ["07", "20261109000007_desempenho_vendedores.sql", "tela Vendedores", () => sb.rpc("desempenho_vendedores", { p_inicio: hojeISO(), p_fim: hojeISO() })],
        ["08", "20261110000008_numero_da_carga_por_dia.sql", "número da carga por dia", () => lerColuna("cargas", "numero_dia")],
        ["09", "20261110000009_impressao_automatica.sql", "impressão automática", () => sb.rpc("pedidos_sem_imprimir", { p_desde: new Date().toISOString() })],
        ["10", "20261110000010_roteiro_de_visitas.sql", "roteiro de visitas", () => lerColuna("clientes", "ordem_visita")],
        ["11", "20261110000011_alerta_clientes_sem_pedido.sql", "alerta no celular", () => sb.rpc("clientes_do_roteiro_com_pedido", { p_dia: hojeISO() })],
        ["12", "20261110000012_ranking_clientes.sql", "ranking de clientes", () => sb.rpc("ranking_clientes", { p_inicio: hojeISO(), p_fim: hojeISO() })],
        ["16", "20261111000016_agenda_de_visitas.sql", "agenda de visitas", () => lerColuna("agenda_visitas", "id")],
        ["17", "20261111000017_bairro_compartilhado.sql", "bairro compartilhado", () => sb.rpc("rotas_do_vendedor", { p_vendedor: "00000000-0000-0000-0000-000000000000" })],
        ["18", "20261111000018_pedidos_do_roteiro.sql", "dois vendedores no mesmo cliente", () => sb.rpc("pedidos_do_roteiro", { p_dia: hojeISO() })],
        ["20", "20261115000020_versao_do_banco.sql", "controle de versão do banco", () => sb.rpc("versao_banco")],
        ["21", "20261115000021_desconto_por_preco.sql", "desconto por preço e aprovação por produto", () => lerColuna("pedido_itens", "precisa_aprovacao")],
        ["22", "20261116000022_moto_balcao_sem_desconto.sql", "entrega de moto, balcão e vendedor sem desconto", () => lerColuna("pedidos", "entrega")],
        // sem coluna nova: confere pela versão gravada no banco
        ["23", "20261116000023_varios_bairros_por_periodo.sql", "mais de um bairro por período na agenda",
          () => sb.rpc("versao_banco").then(({ data, error }) => ({ error: error ?? (typeof data === "number" && data < 23 ? { message: "does not exist" } : null) }))],
        ["24", "20261116000024_link_de_pedidos.sql", "link de pedidos para os clientes", () => lerColuna("pedidos", "origem")],
        ["25", "20261116000025_abastecimento.sql", "abastecimento dos carros", () => lerColuna("abastecimentos", "id")],
        ["26", "20261117000026_combustivel.sql", "combustível do carro e “dois de três” no abastecimento", () => lerColuna("veiculos", "combustiveis")],
        ["27", "20261118000027_codigos_automaticos.sql", "códigos automáticos de clientes e produtos",
          () => sb.rpc("versao_banco").then(({ data, error }) => ({ error: error ?? (typeof data === "number" && data < 27 ? { message: "does not exist" } : null) }))],
        ["28", "20261125000028_clube_de_pontos.sql", "clube de pontos, recebimentos e devolução por cliente", () => lerColuna("pontos_movimentos", "id")],
      ];
      const res = await Promise.all(testes.map(async ([n, arquivo, o_que, f]) => {
        const { error } = await f();
        const msg = JSON.stringify(error ?? "");
        // só conta como "falta" quando o banco diz que a tabela, coluna ou função não existe
        const naoExiste = !!error && /PGRST202|PGRST204|42703|42P01|42883|does not exist|Could not find/i.test(msg);
        return naoExiste ? { n, arquivo, o_que } : null;
      }));
      let lista = res.filter(Boolean) as Falta[];
      // a partir da 20, compara a versão gravada no banco
      if (!lista.some((f) => f.n === "20")) {
        const { data } = await sb.rpc("versao_banco");
        if (typeof data === "number" && data < VERSAO_ESPERADA && !lista.length) lista.push({ n: String(VERSAO_ESPERADA), arquivo: "", o_que: `atualizações depois da ${data}` });
      }
      // a 13, 14, 15 e 19 vêm junto: se faltam as de depois, provavelmente faltam elas também
      if (lista.some((f) => Number(f.n) >= 17)) {
        const extras: Falta[] = [
          { n: "13", arquivo: "20261110000013_carteira_de_clientes.sql", o_que: "carteira de clientes" },
          { n: "14", arquivo: "20261110000014_venda_do_administrador.sql", o_que: "venda do administrador" },
          { n: "15", arquivo: "20261110000015_administrador_pode_tudo.sql", o_que: "administrador pode tudo" },
          { n: "19", arquivo: "20261111000019_bairros.sql", o_que: "bairros" },
        ];
        lista = [...lista, ...extras.filter((e) => !lista.some((f) => f.n === e.n))];
      }
      lista.sort((a, b) => Number(a.n) - Number(b.n));
      setFaltas(lista);
      try { sessionStorage.setItem("verifica_banco", JSON.stringify({ v: VERSAO_ESPERADA, faltas: lista })); } catch {}
    })();
  }, [sb]);

  if (!faltas || faltas.length === 0) return null;
  return (
    <div className="nao-imprimir mb-4 rounded-xl border-2 border-red-500 bg-red-50 p-4 text-red-900 dark:bg-red-500/10 dark:text-red-100">
      <div className="text-lg font-bold">⚠️ O banco de dados está desatualizado: algumas telas vão dar erro</div>
      <p className="mt-1 text-sm">Rode estes arquivos no Supabase (Editor SQL → + → colar → Correr), <b>nesta ordem</b>. Rodar um que já foi rodado não tem problema.</p>
      <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm">
        {faltas.map((f) => (
          <li key={f.n}>
            {f.arquivo ? <a className="font-semibold underline" href={`https://github.com/MiguelMFreitas/DISTRIBUIDORA/blob/main/supabase/migrations/${f.arquivo}`} target="_blank" rel="noopener">{f.arquivo}</a> : <a className="font-semibold underline" href={PASTA} target="_blank" rel="noopener">pasta das atualizações</a>}
            <span className="text-red-700 dark:text-red-200"> · {f.o_que}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs">Depois de rodar, saia e entre de novo no sistema para este aviso sumir.</p>
    </div>
  );
}
