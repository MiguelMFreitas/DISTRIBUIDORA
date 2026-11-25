import type { Metadata } from "next";
import Link from "next/link";
import { lerEmpresa } from "@/lib/empresa-servidor";
import { PaginaTexto, QuemSomos } from "@/components/site-publico";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { empresa } = await lerEmpresa();
  return { title: `Política de privacidade · ${empresa.nome}` };
}

export default async function Privacidade() {
  const { empresa: e } = await lerEmpresa();
  const contato = e.email ? <>pelo e-mail <a href={`mailto:${e.email}`}>{e.email}</a> ou pelo nosso WhatsApp</> : <>pelo nosso WhatsApp</>;
  return (
    <PaginaTexto empresa={e} titulo="Política de privacidade" atualizado="25 de novembro de 2026">
      <p>
        Esta política explica quais dados pessoais a <b>{e.nome}</b> coleta dos seus clientes, para que usa e quais são os seus
        direitos, conforme a Lei Geral de Proteção de Dados (Lei nº 13.709/2018, LGPD). Ela vale para o nosso atendimento pelo
        WhatsApp, para a página de pedidos e para o sistema que a nossa equipe usa.
      </p>

      <h2>1. Quem cuida dos seus dados</h2>
      <QuemSomos empresa={e} />

      <h2>2. Quais dados coletamos</h2>
      <ul>
        <li><b>Cadastro:</b> nome, razão social, nome fantasia, CNPJ ou CPF, endereço, bairro, telefone, número de WhatsApp e nome da pessoa de contato.</li>
        <li><b>Pedidos:</b> produtos, quantidades, preços, forma de pagamento, datas de entrega, pagamentos e itens devolvidos.</li>
        <li><b>Mensagens no WhatsApp:</b> o que você nos manda para fazer pedidos ou tirar dúvidas, incluindo textos, áudios e fotos de listas.</li>
        <li><b>Clube de pontos:</b> pontos ganhos, trocados e vencidos, prêmios e desafios.</li>
        <li><b>Página de pedidos:</b> nome, telefone, endereço e bairro que você digita para receber o pedido.</li>
      </ul>

      <h2>3. Para que usamos</h2>
      <ul>
        <li>Registrar, conferir, separar e entregar os seus pedidos.</li>
        <li>Mandar o resumo do pedido com os valores para você confirmar.</li>
        <li>Controlar pagamentos, recebimentos e devoluções.</li>
        <li>Calcular os pontos do clube e avisar quando eles estiverem perto de vencer.</li>
        <li>Avisar sobre o seu pedido, o dia da entrega e o atendimento.</li>
        <li>Cumprir obrigações legais e fiscais.</li>
      </ul>
      <p>
        Usamos esses dados porque são necessários para vender e entregar o que você pede (execução de contrato), para cumprir a lei
        e, nos avisos do clube de pontos, pelo nosso interesse legítimo em manter você informado. Você pode pedir para parar de
        receber esses avisos quando quiser.
      </p>

      <h2>4. Atendimento automático no WhatsApp</h2>
      <p>
        O nosso WhatsApp pode ser atendido por um assistente automático, que lê as mensagens, ouve os áudios e lê as fotos das listas
        para montar o pedido. Ele sempre manda o resumo com os produtos e os valores e só fecha o pedido quando você confirma.
        A qualquer momento você pode pedir para falar com uma pessoa da nossa equipe.
      </p>

      <h2>5. Com quem compartilhamos</h2>
      <p>Não vendemos nem alugamos os seus dados. Eles só passam pelos serviços que precisamos para atender você:</p>
      <ul>
        <li><b>WhatsApp (Meta)</b>, por onde as mensagens chegam e saem;</li>
        <li><b>hospedagem e banco de dados</b> do nosso sistema;</li>
        <li><b>serviços de inteligência artificial e de transcrição de áudio</b>, usados só para entender as suas mensagens e montar o pedido;</li>
        <li><b>órgãos públicos</b>, quando a lei exigir (por exemplo, para a nota fiscal).</li>
      </ul>
      <p>Esses serviços só podem usar os dados para o que contratamos e podem estar fora do Brasil, sempre com proteção adequada.</p>

      <h2>6. Por quanto tempo guardamos</h2>
      <p>
        Guardamos os dados enquanto você for nosso cliente. Depois, guardamos só o que a lei manda (os registros de vendas e
        pagamentos ficam pelo prazo da legislação fiscal, em geral 5 anos) e apagamos o resto.
      </p>

      <h2>7. Seus direitos</h2>
      <p>Pela LGPD, você pode pedir a qualquer momento:</p>
      <ul>
        <li>para saber se temos dados seus e receber uma cópia deles;</li>
        <li>para corrigir dados errados ou desatualizados;</li>
        <li>para apagar dados que não precisamos mais guardar;</li>
        <li>para parar de receber avisos e mensagens do clube (é só responder <b>SAIR</b> ou falar com a gente);</li>
        <li>informações sobre com quem compartilhamos os seus dados.</li>
      </ul>
      <p>Para isso, fale com a gente {contato}.</p>

      <h2 id="exclusao">8. Como pedir para apagar os seus dados</h2>
      <p>
        Mande a mensagem <b>APAGAR MEUS DADOS</b> no nosso WhatsApp{e.email ? <> ou escreva para <a href={`mailto:${e.email}`}>{e.email}</a></> : null}.
        Vamos confirmar que o pedido é seu e responder em até 15 dias. Apagamos o cadastro, as mensagens e os pontos. Só ficam
        guardados, pelo tempo que a lei exige, os registros de vendas e pagamentos.
      </p>

      <h2>9. Segurança</h2>
      <p>
        O sistema só é acessado pela nossa equipe, com usuário e senha, e cada pessoa vê só o que precisa para o trabalho dela.
        As informações trafegam com criptografia.
      </p>

      <h2>10. Mudanças nesta política</h2>
      <p>
        Se mudarmos esta política, a nova versão fica nesta página com a data atualizada. Veja também os nossos{" "}
        <Link href="/termos">Termos de uso</Link>.
      </p>
    </PaginaTexto>
  );
}
