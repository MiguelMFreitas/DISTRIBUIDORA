import { redirect } from "next/navigation";
import { perfilAtual, inicioDoUsuario } from "@/lib/perfil";

export default async function Inicio() {
  const p = await perfilAtual();
  redirect(inicioDoUsuario(p));
}
