// 국토교통부 아파트 매매·전월세 실거래가 API(data.go.kr) 조회 어댑터(서버·배치 전용, XML 응답)

import { XMLParser } from "fast-xml-parser";
import type { Db } from "@/lib/db/client";
import { getApiKey } from "@/lib/settings";
import type { RealTrade } from "@/lib/types";

const TRADE_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev";
const RENT_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent";
const PAGE_SIZE = 1000;

export interface TradeRow {
  lawdCd: string;
  aptName: string;
  umdName: string | null;
  jibun: string | null;
  exclusiveArea: number;
  floor: number | null;
  price: number;
  dealDate: string;
  dealingType: string | null;
}

export interface RentRow {
  lawdCd: string;
  aptName: string;
  umdName: string | null;
  jibun: string | null;
  exclusiveArea: number;
  floor: number | null;
  deposit: number;
  monthlyRent: number;
  contractDate: string;
  contractTerm: string | null;
  contractType: string | null;
  useRRRight: string | null;
}

type Item = Record<string, string | number | undefined>;

export function molitAvailable(db?: Db): boolean {
  return !!getApiKey("molit", db);
}

export function aptKey(name: string): string {
  return name.replace(/\s+|아파트|\(.*?\)/g, "");
}

export function sameApartment(a: string, b: string): boolean {
  const x = aptKey(a);
  const y = aptKey(b);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}

const toWon = (v: string | number | undefined) => parseInt(String(v ?? "0").replace(/[,\s]/g, ""), 10) * 10_000;
const str = (v: string | number | undefined) => (v === undefined || String(v).trim() === "" ? null : String(v).trim());
const num = (v: string | number | undefined) => (v === undefined || String(v).trim() === "" ? null : Number(v));
const date = (it: Item) => `${it.dealYear}-${String(it.dealMonth).padStart(2, "0")}-${String(it.dealDay).padStart(2, "0")}`;

async function fetchItems(url: string, lawdCd: string, ym: string, serviceKey: string): Promise<Item[]> {
  const parser = new XMLParser({ parseTagValue: false });
  const all: Item[] = [];
  for (let page = 1; ; page++) {
    const params = new URLSearchParams({
      serviceKey,
      LAWD_CD: lawdCd,
      DEAL_YMD: ym,
      pageNo: String(page),
      numOfRows: String(PAGE_SIZE),
    });
    const res = await fetch(`${url}?${params}`, { signal: AbortSignal.timeout(15_000) });
    const doc = parser.parse(await res.text()) as {
      response?: {
        header?: { resultCode?: string; resultMsg?: string };
        body?: { totalCount?: string; items?: { item?: Item | Item[] } | string };
      };
      OpenAPI_ServiceResponse?: { cmmMsgHeader?: { returnAuthMsg?: string; returnReasonCode?: string } };
    };
    if (doc.OpenAPI_ServiceResponse) {
      const h = doc.OpenAPI_ServiceResponse.cmmMsgHeader;
      throw new Error(`실거래가 API 오류: ${h?.returnAuthMsg ?? "인증 실패"}(${h?.returnReasonCode ?? "?"})`);
    }
    const code = String(doc.response?.header?.resultCode ?? "");
    if (code !== "000" && code !== "00") {
      throw new Error(`실거래가 API 오류: ${doc.response?.header?.resultMsg ?? (code || `HTTP ${res.status} 응답 형식 오류`)}`);
    }
    const items = doc.response?.body?.items;
    const raw = typeof items === "object" ? items.item : undefined;
    const pageItems = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    all.push(...pageItems);
    const total = parseInt(String(doc.response?.body?.totalCount ?? "0"), 10);
    if (all.length >= total || pageItems.length < PAGE_SIZE) return all;
  }
}

export async function fetchTradeMonth(lawdCd: string, ym: string, serviceKey = getApiKey("molit") ?? ""): Promise<TradeRow[]> {
  const items = await fetchItems(TRADE_URL, lawdCd, ym, serviceKey);
  return items
    .filter((it) => String(it.cdealType ?? "").trim() !== "O")
    .map((it) => ({
      lawdCd,
      aptName: String(it.aptNm ?? "").trim(),
      umdName: str(it.umdNm),
      jibun: str(it.jibun),
      exclusiveArea: Number(it.excluUseAr),
      floor: num(it.floor),
      price: toWon(it.dealAmount),
      dealDate: date(it),
      dealingType: str(it.dealingGbn),
    }))
    .filter((r) => r.aptName && r.price > 0);
}

export async function fetchRentMonth(lawdCd: string, ym: string, serviceKey = getApiKey("molit") ?? ""): Promise<RentRow[]> {
  const items = await fetchItems(RENT_URL, lawdCd, ym, serviceKey);
  return items
    .map((it) => ({
      lawdCd,
      aptName: String(it.aptNm ?? "").trim(),
      umdName: str(it.umdNm),
      jibun: str(it.jibun),
      exclusiveArea: Number(it.excluUseAr),
      floor: num(it.floor),
      deposit: toWon(it.deposit),
      monthlyRent: toWon(it.monthlyRent),
      contractDate: date(it),
      contractTerm: str(it.contractTerm),
      contractType: str(it.contractType),
      useRRRight: str(it.useRRRight),
    }))
    .filter((r) => r.aptName);
}

export function monthsBack(count: number, now = new Date()): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

/** 웹 상세 화면용 즉석 조회. 배치로 DB에 쌓인 실거래가 없을 때만 쓴다 */
export async function fetchComplexTrades(lawdCd: string, complexName: string, months = 12, now = new Date()): Promise<RealTrade[]> {
  const out: RealTrade[] = [];
  for (const ym of monthsBack(months, now)) {
    for (const r of await fetchTradeMonth(lawdCd, ym)) {
      if (sameApartment(r.aptName, complexName)) {
        out.push({ date: r.dealDate, exclusiveArea: r.exclusiveArea, floor: r.floor, price: r.price });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
