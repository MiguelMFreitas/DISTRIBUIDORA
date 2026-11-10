export const DIAS_SEMANA = [
  { n: 1, nome: "Segunda" }, { n: 2, nome: "Terça" }, { n: 3, nome: "Quarta" },
  { n: 4, nome: "Quinta" }, { n: 5, nome: "Sexta" }, { n: 6, nome: "Sábado" }, { n: 0, nome: "Domingo" },
];
export type Turno = "manha" | "tarde";
export const NOME_TURNO: Record<Turno, string> = { manha: "Manhã", tarde: "Tarde" };
export type ItemAgenda = { vendedor_id: string; dia_semana: number; turno: Turno; rota_id: string };
/** Manhã até meio-dia */
export const turnoAgora = (): Turno => (new Date().getHours() < 12 ? "manha" : "tarde");
