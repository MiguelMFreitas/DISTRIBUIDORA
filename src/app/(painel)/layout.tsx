import { perfilAtual } from "@/lib/perfil";
import { PainelShell } from "@/components/painel-shell";

export default async function LayoutPainel({ children }: { children: React.ReactNode }) {
  const perfil = await perfilAtual();
  return <PainelShell perfil={perfil}>{children}</PainelShell>;
}
