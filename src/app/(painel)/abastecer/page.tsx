"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { alfa, erroMsg, fmtData, fmtMoeda, hojeISO } from "@/lib/formato";
import { Botao, BotaoConfirmar, Cabecalho, Modal, Vazio, avisar } from "@/components/ui";
import { Exige, usePerfil } from "@/components/perfil-contexto";
import { comprimirFoto } from "@/lib/foto";

type Carro = { id: string; nome: string; placa: string | null; marca_km: boolean; ativo: boolean };
type Ab = { id: string; veiculo_id: string; data: string; km: number | null; valor: number; preco_litro: number; litros: number; criado_em: string; usuario_id: string | null };

const BUCKET = "abastecimentos";
const fmtKm = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toLocaleString("pt-BR")} km`);
const fmtL = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} L`;
const num = (t: string) => { const s = t.replace(/[^\d,.]/g, ""); const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s); return Number.isFinite(n) ? n : 0; };
const isoLocal = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
/** segunda-feira da semana (data local, AAAA-MM-DD) */
function segundaISO(d = new Date()) {
  const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return isoLocal(x);
}

/** Campo de foto: abre a câmera do celular e mostra a prévia */
function CampoFoto({ rotulo, arquivo, aoEscolher }: { rotulo: string; arquivo: File | null; aoEscolher: (f: File | null) => void }) {
  const [previa, setPrevia] = useState<string | null>(null);
  useEffect(() => {
    if (!arquivo) return setPrevia(null);
    const u = URL.createObjectURL(arquivo); setPrevia(u);
    return () => URL.revokeObjectURL(u);
  }, [arquivo]);
  return (
    <label className={`block cursor-pointer overflow-hidden rounded-xl border-2 border-dashed ${arquivo ? "border-emerald-500" : "border-zinc-300 dark:border-zinc-700"}`}>
      <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label={rotulo} onChange={(e) => aoEscolher(e.target.files?.[0] ?? null)} />
      {previa
        // eslint-disable-next-line @next/next/no-img-element
        ? <div className="relative"><img src={previa} alt={rotulo} className="h-40 w-full object-cover" /><span className="absolute bottom-1 left-1 rounded bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">✓ {rotulo} · tocar para trocar</span></div>
        : <div className="grid h-28 place-items-center text-center"><div><div className="text-3xl">📷</div><div className="font-semibold">{rotulo}</div></div></div>}
    </label>
  );
}

export default function Abastecer() {
  const sb = supabaseNavegador();
  const eu = usePerfil();
  const [carros, setCarros] = useState<Carro[]>([]);
  const [abs, setAbs] = useState<Ab[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [carro, setCarro] = useState<Carro | null>(null);          // abastecendo este
  const [editCarro, setEditCarro] = useState<Partial<Carro> | null>(null); // cadastro
  const [inativos, setInativos] = useState(false);

  // formulário
  const [data, setData] = useState(hojeISO());
  const [km, setKm] = useState("");
  const [valor, setValor] = useState("");
  const [preco, setPreco] = useState("");
  const [obs, setObs] = useState("");
  const [fotoPainel, setFotoPainel] = useState<File | null>(null);
  const [fotoKm, setFotoKm] = useState<File | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const desde = new Date(); desde.setDate(desde.getDate() - 120);
    const [{ data: c, error }, { data: a }] = await Promise.all([
      sb.from("veiculos").select("id, nome, placa, marca_km, ativo"),
      sb.from("abastecimentos").select("id, veiculo_id, data, km, valor, preco_litro, litros, criado_em, usuario_id").gte("data", isoLocal(desde)).order("data", { ascending: false }).order("criado_em", { ascending: false }),
    ]);
    if (error) avisar(erroMsg(error), "erro");
    setCarros(((c ?? []) as Carro[]).sort((x, y) => alfa(x.nome, y.nome)));
    setAbs((a ?? []) as Ab[]);
    setCarregado(true);
  }, [sb]);
  useEffect(() => { carregar(); }, [carregar]);

  const semana = segundaISO();
  const ultimo = useMemo(() => {
    const m: Record<string, Ab> = {};
    abs.forEach((a) => { if (!m[a.veiculo_id]) m[a.veiculo_id] = a; });
    return m;
  }, [abs]);
  const ultimoKm = (id: string) => abs.find((a) => a.veiculo_id === id && a.km != null)?.km ?? null;
  const ativos = carros.filter((c) => c.ativo);
  const feitosSemana = ativos.filter((c) => ultimo[c.id] && ultimo[c.id].data >= semana).length;

  function abrir(c: Carro) {
    setCarro(c); setData(hojeISO()); setKm(""); setValor(""); setPreco(""); setObs(""); setFotoPainel(null); setFotoKm(null);
  }

  const v = num(valor), p = num(preco), k = km ? num(km) : null;
  const litros = v > 0 && p > 0 ? v / p : 0;
  const kmAnt = carro ? ultimoKm(carro.id) : null;

  async function salvar() {
    if (!carro) return;
    const falta = [
      carro.marca_km && !k && "quilometragem",
      !(v > 0) && "valor",
      !(p > 0) && "preço do litro",
      !fotoPainel && "foto do painel",
      carro.marca_km && !fotoKm && "foto da quilometragem",
    ].filter(Boolean);
    if (falta.length) return avisar("Falta: " + falta.join(", "), "erro");
    if (carro.marca_km && kmAnt != null && k! < kmAnt) return avisar(`A km está menor que a do último abastecimento (${fmtKm(kmAnt)}). Confira o número.`, "erro");
    setSalvando(true);
    const enviados: string[] = [];
    try {
      const base = `${carro.id}/${data}-${crypto.randomUUID().slice(0, 8)}`;
      const subir = async (f: File, nome: string) => {
        const caminho = `${base}-${nome}.jpg`;
        const blob = await comprimirFoto(f);
        const { error } = await sb.storage.from(BUCKET).upload(caminho, blob, { contentType: "image/jpeg" });
        if (error) throw new Error("Não deu para enviar a foto: " + error.message);
        enviados.push(caminho);
        return caminho;
      };
      const caminhoPainel = await subir(fotoPainel!, "painel");
      const caminhoKm = carro.marca_km && fotoKm ? await subir(fotoKm, "km") : null;
      const { error } = await sb.rpc("registrar_abastecimento", {
        p_veiculo: carro.id, p_data: data, p_km: carro.marca_km ? k : null, p_valor: v, p_preco_litro: p,
        p_foto_painel: caminhoPainel, p_foto_km: caminhoKm, p_observacao: obs || null,
      });
      if (error) throw new Error(erroMsg(error));
      avisar(`⛽ ${carro.nome}: ${fmtL(litros)} · ${fmtMoeda(v)}`);
      setCarro(null);
      carregar();
    } catch (e) {
      if (enviados.length) await sb.storage.from(BUCKET).remove(enviados);
      avisar((e as Error).message, "erro");
    } finally {
      setSalvando(false);
    }
  }

  async function apagar(a: Ab) {
    const { data: fotos, error } = await sb.rpc("apagar_abastecimento", { p_id: a.id });
    if (error) return avisar(erroMsg(error), "erro");
    const lista = String(fotos ?? "").split(",").filter(Boolean);
    if (lista.length) await sb.storage.from(BUCKET).remove(lista);
    avisar("Abastecimento apagado");
    carregar();
  }

  async function salvarCarro(e: React.FormEvent) {
    e.preventDefault();
    if (!editCarro) return;
    const dados = { nome: (editCarro.nome ?? "").trim().toLocaleUpperCase("pt-BR"), placa: (editCarro.placa ?? "").trim().toUpperCase() || null, marca_km: editCarro.marca_km ?? true, ativo: editCarro.ativo ?? true };
    if (!dados.nome) return avisar("Informe o nome do carro.", "erro");
    const { error } = editCarro.id ? await sb.from("veiculos").update(dados).eq("id", editCarro.id) : await sb.from("veiculos").insert(dados);
    if (error) return avisar(erroMsg(error), "erro");
    avisar(editCarro.id ? "Carro atualizado" : `${dados.nome} cadastrado`);
    setEditCarro(null);
    carregar();
  }

  const recentes = abs.filter((a) => a.usuario_id === eu.id || eu.admin).slice(0, 12);
  const nomeCarro = (id: string) => carros.find((c) => c.id === id)?.nome ?? "—";
  const campo = "campo h-12! text-lg!";

  return (
    <Exige perm="abastecimento">
      <div className="mx-auto max-w-xl">
        <Cabecalho titulo="⛽ Abastecer" sub={ativos.length ? `Semana de ${fmtData(semana)}: ${feitosSemana} de ${ativos.length} carro(s) abastecido(s)` : "Cadastre os carros para começar."}>
          <Botao variante="secundario" onClick={() => setEditCarro({ marca_km: true, ativo: true })}>+ Carro</Botao>
        </Cabecalho>

        {carregado && ativos.length === 0 && <Vazio>Nenhum carro ainda. Toque em “+ Carro” e coloque o nome e a placa.</Vazio>}

        <div className="space-y-2">
          {carros.filter((c) => c.ativo || inativos).map((c) => {
            const u = ultimo[c.id];
            const feito = u && u.data >= semana;
            return (
              <div key={c.id} className={`cartao flex items-center gap-3 p-3 ${c.ativo ? "" : "opacity-50"}`}>
                <div className={`grid size-11 shrink-0 place-items-center rounded-full text-xl ${feito ? "bg-emerald-100 dark:bg-emerald-500/20" : "bg-amber-100 dark:bg-amber-500/20"}`}>{feito ? "✅" : "⛽"}</div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-lg font-bold leading-tight">{c.nome}</div>
                  {c.placa && <div className="text-sm font-semibold tracking-wide text-zinc-600 dark:text-zinc-300">{c.placa}</div>}
                  <div className="text-sm text-zinc-500">
                    {u ? <>Último: {fmtData(u.data)} · {fmtMoeda(u.valor)}{c.marca_km && ultimoKm(c.id) != null ? ` · ${fmtKm(ultimoKm(c.id))}` : ""}</> : "Ainda não abasteceu"}
                    {!c.marca_km && <span className="text-amber-600"> · não marca km</span>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  {c.ativo && <Botao tamanho="p" variante={feito ? "secundario" : "primario"} onClick={() => abrir(c)}>Abastecer</Botao>}
                  <button className="text-xs font-semibold text-zinc-500" onClick={() => setEditCarro(c)}>Editar</button>
                </div>
              </div>
            );
          })}
        </div>
        {carros.some((c) => !c.ativo) && <label className="mt-2 flex items-center gap-2 text-sm text-zinc-500"><input type="checkbox" checked={inativos} onChange={(e) => setInativos(e.target.checked)} /> Mostrar carros desativados</label>}

        {recentes.length > 0 && (
          <section className="mt-6">
            <h2 className="titulo mb-2 text-lg">Últimos abastecimentos</h2>
            <div className="cartao divide-y divide-zinc-100 dark:divide-zinc-800">
              {recentes.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                  <div><b>{nomeCarro(a.veiculo_id)}</b> · {fmtData(a.data)}<div className="text-zinc-500">{fmtL(Number(a.litros))} a {fmtMoeda(a.preco_litro)}{a.km != null ? ` · ${fmtKm(a.km)}` : ""}</div></div>
                  <div className="flex items-center gap-2">
                    <b>{fmtMoeda(a.valor)}</b>
                    {(eu.admin || (a.usuario_id === eu.id && isoLocal(new Date(a.criado_em)) === hojeISO())) &&
                      <BotaoConfirmar tamanho="p" variante="fantasma" aoConfirmar={() => apagar(a)} textoConfirmar="Apagar?">✕</BotaoConfirmar>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* ---------- abastecer ---------- */}
      <Modal aberto={!!carro} aoFechar={() => !salvando && setCarro(null)} titulo={carro ? `⛽ ${carro.nome}` : ""} largura="max-w-lg"
        rodape={<>
          <Botao variante="secundario" onClick={() => setCarro(null)} disabled={salvando}>Cancelar</Botao>
          <Botao tamanho="g" onClick={salvar} carregando={salvando}>Salvar abastecimento</Botao>
        </>}>
        {carro && (
          <div className="space-y-3">
            <label className="block"><span className="rotulo">Data</span><input type="date" className={campo} value={data} max={hojeISO()} onChange={(e) => setData(e.target.value)} /></label>
            {carro.marca_km ? (
              <label className="block"><span className="rotulo">Quilometragem atual (km)</span>
                <input className={campo} inputMode="numeric" placeholder={kmAnt != null ? `último: ${Number(kmAnt).toLocaleString("pt-BR")}` : "ex.: 85.400"} value={km} onChange={(e) => setKm(e.target.value)} />
                {kmAnt != null && k != null && k > 0 && <span className={`text-sm ${k < kmAnt ? "font-semibold text-red-600" : "text-zinc-500"}`}>{k < kmAnt ? `Menor que o último (${fmtKm(kmAnt)})` : `Rodou ${fmtKm(k - kmAnt)} desde o último`}</span>}
              </label>
            ) : <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">Este carro não marca a quilometragem: só o valor, o preço do litro e a foto do painel.</p>}
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="rotulo">Valor pago (R$)</span><input className={campo} inputMode="decimal" placeholder="200,00" value={valor} onChange={(e) => setValor(e.target.value)} /></label>
              <label className="block"><span className="rotulo">Preço do litro (R$)</span><input className={campo} inputMode="decimal" placeholder="6,29" value={preco} onChange={(e) => setPreco(e.target.value)} /></label>
            </div>
            <div className="rounded-xl bg-marca-50 p-3 text-center dark:bg-marca-500/10">
              <div className="text-xs font-semibold uppercase text-zinc-500">Litros colocados</div>
              <div className="font-display text-4xl font-bold">{litros ? fmtL(litros) : "—"}</div>
            </div>
            <div className={`grid gap-3 ${carro.marca_km ? "grid-cols-2" : ""}`}>
              <CampoFoto rotulo="Foto do painel" arquivo={fotoPainel} aoEscolher={setFotoPainel} />
              {carro.marca_km && <CampoFoto rotulo="Foto da km" arquivo={fotoKm} aoEscolher={setFotoKm} />}
            </div>
            <label className="block"><span className="rotulo">Observação (opcional)</span><input className="campo" value={obs} onChange={(e) => setObs(e.target.value)} /></label>
          </div>
        )}
      </Modal>

      {/* ---------- cadastro do carro ---------- */}
      <Modal aberto={!!editCarro} aoFechar={() => setEditCarro(null)} titulo={editCarro?.id ? "Editar carro" : "Novo carro"} largura="max-w-md"
        rodape={<>
          <Botao variante="secundario" onClick={() => setEditCarro(null)}>Cancelar</Botao>
          <Botao type="submit" form="form-carro">Salvar</Botao>
        </>}>
        {editCarro && (
          <form id="form-carro" onSubmit={salvarCarro} className="space-y-3">
            <label className="block"><span className="rotulo">Carro</span><input className="campo uppercase" autoFocus placeholder="ex.: STRADA BRANCA" value={editCarro.nome ?? ""} onChange={(e) => setEditCarro({ ...editCarro, nome: e.target.value })} /></label>
            <label className="block"><span className="rotulo">Placa</span><input className="campo uppercase" placeholder="ABC1D23" value={editCarro.placa ?? ""} onChange={(e) => setEditCarro({ ...editCarro, placa: e.target.value })} /></label>
            <div>
              <span className="rotulo">O painel está marcando a quilometragem?</span>
              <div className="grid grid-cols-2 gap-2">
                {[true, false].map((x) => (
                  <button key={String(x)} type="button" onClick={() => setEditCarro({ ...editCarro, marca_km: x })}
                    className={`h-12 rounded-xl border-2 font-bold ${(editCarro.marca_km ?? true) === x ? "border-marca-500 bg-marca-50 dark:bg-marca-500/10" : "border-zinc-300 dark:border-zinc-700"}`}>{x ? "Sim, marca" : "Não marca"}</button>
                ))}
              </div>
              <p className="mt-1 text-xs text-zinc-500">Se não marca, o abastecimento pede só o valor, o preço do litro e a foto do painel.</p>
            </div>
            {editCarro.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editCarro.ativo ?? true} onChange={(e) => setEditCarro({ ...editCarro, ativo: e.target.checked })} /> Carro ativo (desmarque se vendeu ou parou de usar)</label>}
          </form>
        )}
      </Modal>
    </Exige>
  );
}
