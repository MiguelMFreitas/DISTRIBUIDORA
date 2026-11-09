"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg, fmtDataHora, fmtMoeda } from "@/lib/formato";
import { IMPRESSORA_CUPOM } from "@/lib/impressao";
import { Cupom, SELECT_PEDIDO_IMPRESSAO, ordenarItens, type Ped } from "@/components/cupom-pedido";

/*
 * Impressão automática: esta aba fica aberta no computador ligado à Elgin i9.
 * A cada 15 segundos pega os pedidos liberados ainda não impressos e imprime.
 * Para sair sem a janela de impressão, o Chrome deste computador precisa ser
 * aberto com --kiosk-printing e a i9 como impressora padrão do Windows.
 */
const INTERVALO = 15000;
const CHAVE = "impressao_automatica";

type Registro = { id: string; numero: number; cliente: string; total: number; em: string };

export default function ImpressaoAutomatica() {
  const sb = supabaseNavegador();
  const [ligada, setLigada] = useState(false);
  const [desde, setDesde] = useState<string | null>(null);
  const [esperando, setEsperando] = useState<number | null>(null);
  const [lote, setLote] = useState<Ped[]>([]);
  const [historico, setHistorico] = useState<Registro[]>([]);
  const [ultima, setUltima] = useState<Date | null>(null);
  const [erro, setErro] = useState("");
  const ocupado = useRef(false);
  const empresa = process.env.NEXT_PUBLIC_EMPRESA_NOME || "Distribuidora";

  // lembra se estava ligada (se o computador reiniciar, volta sozinha)
  useEffect(() => {
    document.title = "Impressão automática";
    try {
      const s = JSON.parse(localStorage.getItem(CHAVE) ?? "null");
      if (s?.ligada && s.desde) { setLigada(true); setDesde(s.desde); }
      setHistorico(JSON.parse(localStorage.getItem(CHAVE + "_historico") ?? "[]"));
    } catch {}
  }, []);
  useEffect(() => { try { localStorage.setItem(CHAVE, JSON.stringify({ ligada, desde })); } catch {} }, [ligada, desde]);
  useEffect(() => { try { localStorage.setItem(CHAVE + "_historico", JSON.stringify(historico.slice(0, 100))); } catch {} }, [historico]);

  // quantos pedidos de hoje ainda não foram impressos (aparece antes de ligar)
  const inicioDoDia = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
  useEffect(() => {
    if (ligada) return;
    sb.rpc("pedidos_sem_imprimir", { p_desde: inicioDoDia() }).then(({ data, error }) => { if (!error) setEsperando(data as number); });
  }, [sb, ligada]);

  const verificar = useCallback(async () => {
    if (!ligada || !desde || ocupado.current) return;
    ocupado.current = true;
    try {
      const { data: ids, error } = await sb.rpc("pegar_pedidos_para_imprimir", { p_desde: desde });
      setUltima(new Date());
      if (error) { setErro(erroMsg(error)); return; }
      setErro("");
      const lista = ((ids ?? []) as unknown[]).map((x) => (typeof x === "string" ? x : (x as { pegar_pedidos_para_imprimir: string }).pegar_pedidos_para_imprimir));
      if (!lista.length) return;
      const { data, error: e2 } = await sb.from("pedidos").select(SELECT_PEDIDO_IMPRESSAO).in("id", lista);
      if (e2) { setErro(erroMsg(e2)); return; }
      const peds = ordenarItens((data ?? []) as unknown as Ped[]).sort((a, b) => a.numero - b.numero);
      setLote(peds); // o efeito abaixo imprime
    } finally {
      ocupado.current = false;
    }
  }, [sb, ligada, desde]);

  useEffect(() => {
    if (!ligada) return;
    verificar();
    const t = setInterval(verificar, INTERVALO);
    return () => clearInterval(t);
  }, [ligada, verificar]);

  // imprime o lote depois que ele aparece na tela
  useEffect(() => {
    if (!lote.length) return;
    const t = setTimeout(() => {
      window.print();
      const agora = new Date().toISOString();
      setHistorico((h) => [...lote.map((p) => ({ id: p.id, numero: p.numero, cliente: p.clientes.razao_social, total: Number(p.total), em: agora })).reverse(), ...h]);
      setLote([]);
    }, 400);
    return () => clearTimeout(t);
  }, [lote]);

  function ligar(incluirPendentes: boolean) {
    setDesde(incluirPendentes ? inicioDoDia() : new Date().toISOString());
    setLigada(true);
  }

  async function reimprimir(id: string) {
    const { data, error } = await sb.from("pedidos").select(SELECT_PEDIDO_IMPRESSAO).eq("id", id);
    if (error) return setErro(erroMsg(error));
    setLote(ordenarItens((data ?? []) as unknown as Ped[]));
  }

  return (
    <>
      <style>{"@page { margin: 0; }"}</style>
      <div className="barra" style={{ flexDirection: "column", alignItems: "stretch", gap: 12, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>🖨 Impressão automática dos pedidos</div>
            <div style={{ opacity: .8 }}>Impressora: <b>{IMPRESSORA_CUPOM}</b> · deixe esta aba aberta neste computador</div>
          </div>
          {ligada ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ background: "#0f8a4f", color: "#fff", borderRadius: 999, padding: "6px 14px", fontWeight: 700 }}>● LIGADA</span>
              <button className="sec" onClick={() => { setLigada(false); setDesde(null); }}>Desligar</button>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => ligar(false)}>Ligar (só pedidos novos)</button>
              {!!esperando && <button className="sec" onClick={() => ligar(true)}>Ligar e imprimir os {esperando} de hoje que ainda não saíram</button>}
            </div>
          )}
        </div>
        <div style={{ fontSize: 13, opacity: .85 }}>
          {ligada
            ? <>Procurando pedidos novos a cada 15 segundos{ultima ? ` · última vez às ${ultima.toLocaleTimeString("pt-BR")}` : ""}. Pedido com desconto acima do limite sai quando for aprovado.</>
            : <>Desligada. Ao ligar, cada pedido liberado que chegar dos vendedores sai sozinho na {IMPRESSORA_CUPOM}, uma vez só.</>}
        </div>
        {erro && <div style={{ background: "#c0362c", borderRadius: 8, padding: "8px 12px" }}>Erro: {erro}. Vou tentar de novo sozinho.</div>}

        <details style={{ background: "#ffffff14", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Como fazer imprimir sem aparecer a janela de impressão (fazer uma vez)</summary>
          <ol style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
            <li>No Windows: <b>Configurações → Impressoras</b> → <b>{IMPRESSORA_CUPOM}</b> → <b>Definir como padrão</b>. Em <b>Preferências de impressão</b>, papel 80 mm e corte ao fim da página.</li>
            <li>Crie um atalho do Chrome na área de trabalho. Clique com o botão direito → <b>Propriedades</b>. No campo <b>Destino</b>, no final, depois das aspas, adicione um espaço e: <code style={{ background: "#0006", padding: "1px 4px", borderRadius: 4 }}>--kiosk-printing</code></li>
            <li>Feche <b>todas</b> as janelas do Chrome e abra pelo atalho novo. Entre no sistema e abra esta tela.</li>
            <li>Pronto: os pedidos saem direto, sem perguntar. Mantenha esta janela aberta (pode ficar atrás de outras).</li>
          </ol>
        </details>

        {historico.length > 0 && (
          <details open style={{ background: "#ffffff14", borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>Impressos neste computador ({historico.length})</summary>
            <div style={{ maxHeight: 220, overflowY: "auto", marginTop: 6 }}>
              {historico.map((h, i) => (
                <div key={h.id + i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0", borderTop: i ? "1px solid #ffffff22" : 0, alignItems: "center" }}>
                  <span>Pedido <b>{h.numero}</b> · {h.cliente} · {fmtMoeda(h.total)}</span>
                  <span style={{ display: "flex", gap: 8, alignItems: "center" }}><span style={{ opacity: .7 }}>{fmtDataHora(h.em)}</span><button className="sec" style={{ padding: "3px 10px" }} onClick={() => reimprimir(h.id)}>Reimprimir</button></span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {lote.length > 0 && (
        <div className="cupons t80">
          {lote.map((p) => <Cupom key={p.id} p={p} empresa={empresa} />)}
        </div>
      )}
    </>
  );
}
