# Sistema da Distribuidora

Pedidos pelo celular dos vendedores (funciona sem internet), cargas, **romaneio de carga** na ordem de carregamento, estoque e conferência de retorno.

## O que tem

| Tela | Para quê |
|---|---|
| **App do vendedor** (`/vender`) | Pedido pelo celular: pesquisa cliente e produto, meia caixa / meio fardo, desconto até o limite do vendedor. Sem internet, o pedido fica guardado no celular e é enviado sozinho quando a conexão volta. |
| **Pedidos** | Todos os pedidos, filtros, aprovação de desconto, cancelamento e impressão. |
| **Cargas e romaneio** | Escolhe veículo e motorista, adiciona pedidos (por rota inteira ou um a um), vê o peso em relação à capacidade e imprime o romaneio e os pedidos. |
| **Categorias (ordem)** | A ordem em que os produtos sobem no caminhão. O romaneio sai nessa ordem. |
| **Conferência** | Retorno do caminhão: vasilhames esperados × devolvidos, produtos que voltaram cheios (voltam para o estoque) e trocas por avaria. Tem o botão de WhatsApp. |
| **Estoque** | Entrada de mercadoria (vários produtos de uma vez), ajuste e histórico. Avisa quando o estoque está baixo e bloqueia a venda quando zera. |
| **Ranking** | Ranking semanal dos vendedores: clientes atendidos, itens vendidos e valor. Só os administradores veem. |
| **Usuários** | Só administradores. Ao criar uma conta, você escolhe as permissões e o desconto máximo. |

## Como colocar no ar (uma vez)

### 1. Banco de dados (Supabase, grátis)
1. Crie uma conta em https://supabase.com e um projeto novo (região **São Paulo**).
2. Abra **SQL Editor**, cole todo o conteúdo de `supabase/instalar.sql` e clique em **Run**.
   (É a junção dos arquivos de `supabase/migrations/`. Mudanças futuras vêm como arquivos novos nessa pasta.)
3. Em **Project Settings → API**, copie a *Project URL*, a chave `anon` e a chave `service_role`.

### 2. Configurar e criar o primeiro administrador
```bash
cp .env.example .env.local   # e preencha com os dados do passo 1
npm install
node --env-file=.env.local scripts/criar-admin.mjs miguel SUA_SENHA "Miguel"
```
Faça o mesmo para a conta do seu pai. As outras contas vocês criam pela tela **Usuários**.

### 3. Publicar o site (Vercel, grátis)
1. Entre em https://vercel.com com a sua conta do GitHub e importe este repositório.
2. Em **Environment Variables**, coloque as 4 variáveis do `.env.example`.
3. Clique em **Deploy**. O endereço gerado (ex.: `distribuidora.vercel.app`) é o que vocês e os vendedores vão usar.

### 4. No celular dos vendedores
Abra o endereço no Chrome (Android) ou no Safari (iPhone), entre com o usuário e toque em **Adicionar à tela inicial**. Abra o app uma vez com internet. Depois disso ele abre mesmo sem sinal.

## Para rodar no computador (desenvolvimento)
```bash
npm run dev
```

## Testes do banco
`supabase/tests/testes.sql` testa as regras: estoque, meia caixa, desconto, pedido repetido no envio offline, permissões, carga, romaneio, conferência e ranking.
```bash
bash supabase/tests/rodar.sh   # precisa de um Postgres local na porta 5433
```
