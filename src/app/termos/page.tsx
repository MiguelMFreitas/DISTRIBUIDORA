import type { Metadata } from "next";
import Link from "next/link";
import { lerEmpresa } from "@/lib/empresa-servidor";
import { PaginaTexto, QuemSomos } from "@/components/site-publico";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { empresa } = await lerEmpresa();
  return { title: `Termos de uso · ${empresa.nome}` };
}

export default async function Termos() {
  const { empresa: e } = await lerEmpresa();
  return (
    <PaginaTexto empresa={e} titulo="Termos de uso" atualizado="25 de novembro de 2026">
      <p>
        Estes termos valem para quem faz pedidos à <b>{e.nome}</b> pelo WhatsApp ou pela nossa página de pedidos. Ao fazer um
        pedido, você concorda com eles.
      </p>

      <h2>1. Pedidos</h2>
      <ul>
        <li>Vendemos por fardo e por caixa. A cerveja retornável também pode ser vendida em meia caixa. Não vendemos unidades soltas.</li>
        <li>Antes de fechar, mandamos o resumo do pedido com cada produto, a quantidade, o preço e o total. O pedido só vale depois que você confirma.</li>
        <li>Preços e estoque podem mudar sem aviso, mas o preço confirmado no resumo é o que vale para aquele pedido.</li>
        <li>Se faltar algum produto, avisamos e o item sai do pedido ou é trocado com a sua concordância.</li>
      </ul>

      <h2>2. Entrega</h2>
      <ul>
        <li>Entregamos no endereço do cadastro, no dia da rota do seu bairro ou de moto, conforme combinado.</li>
        <li>Pedidos feitos fora do horário de atendimento são registrados e entregues no próximo dia de entrega, que informamos na hora.</li>
        <li>Confira os produtos na entrega. Problemas devem ser avisados ao entregador ou pelo WhatsApp no mesmo dia.</li>
      </ul>

      <h2>3. Pagamento</h2>
      <p>A forma e o prazo de pagamento são os combinados no seu cadastro ou informados no resumo do pedido.</p>

      <h2>4. Clube de pontos</h2>
      <ul>
        <li>Os pedidos feitos pelo nosso WhatsApp dão pontos de acordo com o valor pago. Os pontos entram quando o pagamento é confirmado.</li>
        <li>Se algum item voltar, os pontos dele são descontados.</li>
        <li>Os pontos vencem 3 meses depois de entrar. Avisamos antes de vencer.</li>
        <li>Os pontos podem ser trocados pelos prêmios disponíveis, que seguem junto com o próximo pedido. Pontos não valem dinheiro e não podem ser transferidos.</li>
        <li>Níveis, desafios, prêmios e regras do clube podem mudar. Avisamos antes, e os pontos que você já tem continuam valendo até vencer.</li>
      </ul>

      <h2>5. Atendimento automático</h2>
      <p>
        O WhatsApp pode ser atendido por um assistente automático. Se ele não entender algo, pergunta. Você pode pedir para falar
        com uma pessoa a qualquer momento.
      </p>

      <h2>6. Seus dados</h2>
      <p>O uso dos seus dados está explicado na nossa <Link href="/privacidade">Política de privacidade</Link>.</p>

      <h2>7. Contato</h2>
      <QuemSomos empresa={e} />
    </PaginaTexto>
  );
}
