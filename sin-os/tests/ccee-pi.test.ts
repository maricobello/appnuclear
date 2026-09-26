import { describe, expect, it } from "vitest";
import { listarPldEnvelope, parseListarPld, piTimestamp, PiSoapFault } from "../src/lib/sources/ccee-pi-xml";
import { overlayPanel } from "../src/lib/market/brazil";
import { brtToUtc } from "../src/lib/sources/time";

// resposta de exemplo da collection oficial (devccee/postman-collections), prefixos variados
const RESP = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:hdr="http://xmlns.energia.org.br/MH/v1">
  <soapenv:Header>
    <hdr:paginacao><hdr:numero>1</hdr:numero><hdr:quantidadeItens>2</hdr:quantidadeItens><hdr:totalPaginas>360</hdr:totalPaginas><hdr:quantidadeTotalItens>720</hdr:quantidadeTotalItens></hdr:paginacao>
  </soapenv:Header>
  <soapenv:Body>
    <bm:listarPLDResponse xmlns:bm="http://xmlns.energia.org.br/BM/v1" xmlns:bo="http://xmlns.energia.org.br/BO/v1">
      <bm:plds>
        <bm:pld>
          <bo:vigencia><bo:inicio>2020-04-01T00:00:00-03:00</bo:inicio><bo:fim>2020-04-01T01:00:00-03:00</bo:fim></bo:vigencia>
          <bo:valores>
            <bo:valor><bo:indicadorRedeEletrica>false</bo:indicadorRedeEletrica><bo:submercado><bo:codigo>1</bo:codigo><bo:nome>SUDESTE</bo:nome></bo:submercado><bo:tipo>HORARIO</bo:tipo><bo:valor><bo:codigo>BRL</bo:codigo><bo:valor>39.68</bo:valor></bo:valor></bo:valor>
            <bo:valor><bo:indicadorRedeEletrica>false</bo:indicadorRedeEletrica><bo:submercado><bo:codigo>2</bo:codigo><bo:nome>SUL</bo:nome></bo:submercado><bo:tipo>HORARIO</bo:tipo><bo:valor><bo:codigo>BRL</bo:codigo><bo:valor>41.02</bo:valor></bo:valor></bo:valor>
            <bo:valor><bo:submercado><bo:codigo>3</bo:codigo></bo:submercado><bo:tipo>HORARIO</bo:tipo><bo:valor><bo:codigo>BRL</bo:codigo><bo:valor>57,31</bo:valor></bo:valor></bo:valor>
          </bo:valores>
        </bm:pld>
        <bm:pld>
          <bo:vigencia><bo:inicio>2020-04-01T01:00:00</bo:inicio><bo:fim>2020-04-01T02:00:00</bo:fim></bo:vigencia>
          <bo:valores><bo:valor><bo:submercado><bo:codigo>4</bo:codigo><bo:nome>NORTE</bo:nome></bo:submercado><bo:tipo>HORARIO</bo:tipo><bo:valor><bo:codigo>BRL</bo:codigo><bo:valor>100.5</bo:valor></bo:valor></bo:valor></bo:valores>
        </bm:pld>
      </bm:plds>
    </bm:listarPLDResponse>
  </soapenv:Body>
</soapenv:Envelope>`;

describe("CCEE Plataforma de Integração — listarPLD", () => {
  it("interpreta a resposta oficial: hora, submercado (nome ou código), valor e paginação", () => {
    const p = parseListarPld(RESP);
    expect(p.totalPages).toBe(360);
    expect(p.totalItems).toBe(720);
    expect(p.items).toHaveLength(4);
    const h0 = brtToUtc(2020, 4, 1, 0);
    expect(p.items[0]).toEqual({ ts: h0, sub: "SE", value: 39.68 });
    expect(p.items[1]).toMatchObject({ sub: "S", value: 41.02 });
    expect(p.items[2]).toMatchObject({ sub: "NE", value: 57.31 }); // só código + vírgula decimal
    expect(p.items[3]).toEqual({ ts: brtToUtc(2020, 4, 1, 1), sub: "N", value: 100.5 }); // sem fuso = BRT
  });

  it("SOAP Fault vira erro legível com a mensagem da CCEE", () => {
    const fault = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><soap:Fault><faultcode>soap:Client</faultcode><faultstring>Usuário ou senha inválidos</faultstring></soap:Fault></soap:Body></soap:Envelope>`;
    expect(() => parseListarPld(fault)).toThrow(PiSoapFault);
    expect(() => parseListarPld(fault)).toThrow(/Usuário ou senha inválidos/);
  });

  it("envelope escapa credenciais e leva perfil, paginação e vigência", () => {
    const x = listarPldEnvelope({ username: "a<b", password: "p&w'\"", perfil: "123" }, { inicio: "2026-09-20T00:00:00", fim: "2026-09-28T00:00:00", page: 3, pageSize: 240 });
    expect(x).toContain("<oas:Username>a&lt;b</oas:Username>");
    expect(x).toContain("<oas:Password>p&amp;w&apos;&quot;</oas:Password>");
    expect(x).toContain("<mh:codigoPerfilAgente>123</mh:codigoPerfilAgente>");
    expect(x).toContain("<mh:numero>3</mh:numero>");
    expect(x).toContain("<bo:tipo>HORARIO</bo:tipo>");
    expect(piTimestamp("2026-09-27T05:00:00-03:00")).toBe(brtToUtc(2026, 9, 27, 5));
  });

  it("PLD oficial sobreposto ao histórico: oficial prevalece e estende o D+1", () => {
    const t = (h: number) => brtToUtc(2026, 9, 26, h);
    const base = { ts: [t(0), t(1)], unit: "R$/MWh", values: { SE: [50, 60], S: [50, 60], NE: [50, 60], N: [50, 60] } };
    const top = { ts: [t(1), t(2)], unit: "R$/MWh", values: { SE: [61, 70], S: [null, 70], NE: [61, 70], N: [61, 70] } };
    const o = overlayPanel(base, top);
    expect(o.ts).toEqual([t(0), t(1), t(2)]);
    expect(o.values.SE).toEqual([50, 61, 70]);
    expect(o.values.S).toEqual([50, 60, 70]); // null no oficial não apaga o histórico
  });
});
