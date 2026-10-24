// 사용자가 자기 브라우저에서 저장한 네이버페이 부동산 응답(목록·상세·HAR)을 도메인 모델로 변환
// 응답 구조는 REA 캡처로 확인: POST /front-api/v1/complex/article/list, GET /article/basicInfo(SSR dehydrated state)

import type { Complex, ListingUnit, MovingInInfo, MovingInType, RealtorAd } from "@/lib/types";
import { resolveRegion } from "@/lib/finance/regions";

interface NaverArticle {
  complexName: string;
  complexNumber: number;
  articleNumber: string;
  dongName?: string;
  tradeType: string;
  realEstateType?: string;
  spaceInfo?: { supplySpace?: number; exclusiveSpace?: number; supplySpaceName?: string; exclusiveSpaceName?: string };
  buildingInfo?: { buildingConjunctionDate?: string };
  verificationInfo?: { verificationType?: string; articleConfirmDate?: string };
  brokerInfo?: { brokerageName?: string; brokerName?: string };
  articleDetail?: {
    direction?: string;
    articleFeatureDescription?: string;
    floorInfo?: string;
    floorDetailInfo?: { targetFloor?: string; totalFloor?: string };
  };
  articleMediaDto?: { imageUrl?: string };
  address?: { city?: string; division?: string; sector?: string; coordinates?: { xCoordinate?: number; yCoordinate?: number } };
  priceInfo?: { dealPrice?: number };
}

interface NaverListGroup {
  representativeArticleInfo: NaverArticle;
  duplicatedArticleInfo?: { articleInfoList?: NaverArticle[] };
}

interface NaverBasicInfo {
  priceInfo?: { price?: number; previousDeposit?: number; previousMonthlyRent?: number; isLeaseHold?: boolean };
  detailInfo?: {
    articleDetailInfo?: { articleNumber?: string; articleFeatureDescription?: string; articleDescription?: string };
    movingInInfo?: { movingInType?: string; movingInDate?: string; movingInNegotiation?: boolean };
    spaceInfo?: { roomCount?: number };
  };
}

export interface ImportedData {
  complexes: Complex[];
  units: ListingUnit[];
  warnings: string[];
  enrichedAds: number;
}

const MOVING_IN_TYPES = new Set(["MV001", "MV002", "MV003", "MV004"]);
// A01 아파트, A04 재건축. 지도 목록 기본 필터에 섞여 오는 B01(분양권)은 가격 구조가 달라 제외
const APARTMENT_TYPES = new Set(["A01", "A04"]);

function safeParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseFloor(info: string | undefined): { label: string; floor: number | null; total: number | null } {
  const label = info ?? "-";
  const [f, t] = label.split("/");
  const floor = /^\d+$/.test(f ?? "") ? parseInt(f, 10) : null;
  const total = /^\d+$/.test(t ?? "") ? parseInt(t, 10) : null;
  return { label, floor, total };
}

function defaultRooms(area: number): number {
  if (area < 40) return 1;
  if (area < 60) return 2;
  if (area < 90) return 3;
  return 4;
}

function toAd(a: NaverArticle): RealtorAd {
  return {
    articleNo: a.articleNumber,
    realtorName: a.brokerInfo?.brokerageName ?? "중개사 미상",
    cpName: a.brokerInfo?.brokerName ?? null,
    featureText: a.articleDetail?.articleFeatureDescription ?? "",
    description: null,
    movingIn: null,
    previousDeposit: null,
    previousMonthlyRent: null,
    isLeaseHold: null,
    verificationType: a.verificationInfo?.verificationType ?? null,
    confirmedAt: a.verificationInfo?.articleConfirmDate ?? null,
  };
}

function collectJsonCandidates(input: unknown, out: unknown[]): void {
  if (!input || typeof input !== "object") return;
  const obj = input as Record<string, unknown>;
  if (Array.isArray(input)) {
    for (const v of input) collectJsonCandidates(v, out);
    return;
  }
  const log = obj.log as { entries?: { request?: { url?: string }; response?: { content?: { text?: string; encoding?: string } } }[] } | undefined;
  if (log?.entries) {
    for (const e of log.entries) {
      const url = e.request?.url ?? "";
      let text = e.response?.content?.text;
      if (!text) continue;
      if (e.response?.content?.encoding === "base64") text = Buffer.from(text, "base64").toString("utf-8");
      if (url.includes("/front-api/v1/complex/article/list") || url.includes("/front-api/v1/article/basicInfo")) {
        const parsed = safeParse(text);
        if (parsed !== null) out.push(parsed);
      } else if (url.includes("fin.land.naver.com") && text.includes("previousDeposit")) {
        out.push(...extractDehydratedBasicInfo(text));
      }
    }
    return;
  }
  out.push(input);
}

/** 상세 페이지 HTML(Next.js RSC)의 dehydrated "GET /article/basicInfo" 결과를 꺼낸다 */
export function extractDehydratedBasicInfo(html: string): unknown[] {
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map((m) => {
    try {
      return JSON.parse(`"${m[1]}"`) as string;
    } catch {
      return "";
    }
  });
  const text = chunks.length > 0 ? chunks.join("") : html;
  const results: unknown[] = [];
  let from = 0;
  for (;;) {
    const i = text.indexOf('{"isSuccess":true,"result":{"priceInfo"', from);
    if (i < 0) break;
    let depth = 0;
    let end = -1;
    let inStr = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (inStr) {
        if (c === "\\") j++;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    if (end < 0) break;
    const parsed = safeParse(text.slice(i, end + 1));
    if (parsed !== null) results.push(parsed);
    from = end + 1;
  }
  return results;
}

export interface AdDetail {
  articleNo: string;
  description: string | null;
  featureText: string | null;
  previousDeposit: number | null;
  previousMonthlyRent: number | null;
  isLeaseHold: boolean | null;
  movingIn: MovingInInfo | null;
  roomCount: number | null;
}

/** 지도 단지 마커(complexClusters)에만 있는 단지 정보 */
export interface ComplexInfo {
  id: string;
  households: number | null;
  approvalDate: string | null;
  floorAreaRatio: number | null;
}

export interface ParsedNaverData {
  complexes: Complex[];
  units: ListingUnit[];
  details: AdDetail[];
  complexInfos: ComplexInfo[];
  warnings: string[];
}

interface NaverComplexCluster {
  complexNumber?: number;
  realEstateType?: string;
  totalHouseholdNumber?: number;
  useApprovalDate?: string;
  floorAreaRatio?: number;
}

function toDetail(b: NaverBasicInfo): AdDetail | null {
  const no = b.detailInfo?.articleDetailInfo?.articleNumber;
  if (!no) return null;
  const mv = b.detailInfo?.movingInInfo;
  return {
    articleNo: no,
    description: b.detailInfo?.articleDetailInfo?.articleDescription ?? null,
    featureText: b.detailInfo?.articleDetailInfo?.articleFeatureDescription ?? null,
    previousDeposit: b.priceInfo?.previousDeposit ?? null,
    previousMonthlyRent: b.priceInfo?.previousMonthlyRent ?? null,
    isLeaseHold: b.priceInfo?.isLeaseHold ?? null,
    movingIn: mv
      ? {
          type: mv.movingInType && MOVING_IN_TYPES.has(mv.movingInType) ? (mv.movingInType as MovingInType) : null,
          date: mv.movingInDate ?? null,
          negotiable: !!mv.movingInNegotiation,
        }
      : null,
    roomCount: b.detailInfo?.spaceInfo?.roomCount ?? null,
  };
}

export function applyDetailToAd(ad: RealtorAd, d: AdDetail): void {
  ad.description = d.description ?? ad.description;
  ad.featureText = d.featureText ?? ad.featureText;
  ad.previousDeposit = d.previousDeposit;
  ad.previousMonthlyRent = d.previousMonthlyRent;
  ad.isLeaseHold = d.isLeaseHold;
  ad.movingIn = d.movingIn;
}

/** 목록 그룹과 상세 보강 정보를 분리해서 돌려준다(DB 적재는 둘을 따로 반영) */
export function parseNaverPayloads(payloads: unknown[]): ParsedNaverData {
  const candidates: unknown[] = [];
  for (const p of payloads) collectJsonCandidates(p, candidates);

  const complexes = new Map<string, Complex>();
  const units = new Map<string, ListingUnit>();
  const details: AdDetail[] = [];
  const complexInfos = new Map<string, ComplexInfo>();
  const warnings: string[] = [];

  for (const c of candidates) {
    const result = (c as { result?: unknown }).result as
      | { list?: NaverListGroup[]; priceInfo?: unknown; clusters?: NaverComplexCluster[]; points?: NaverComplexCluster[] }
      | undefined;
    if (result?.clusters && Array.isArray(result.clusters)) {
      // 지도를 넓게 보면 눈에 띄는 단지는 clusters, 나머지 단지는 points로 나뉘어 오며 둘 다 세대수를 담고 있다
      const markers = [...result.clusters, ...(Array.isArray(result.points) ? result.points : [])];
      for (const k of markers) {
        if (!k.complexNumber || typeof k.totalHouseholdNumber !== "number") continue;
        if (k.realEstateType && !APARTMENT_TYPES.has(k.realEstateType)) continue;
        const id = `naver-${k.complexNumber}`;
        complexInfos.set(id, {
          id,
          households: k.totalHouseholdNumber > 0 ? k.totalHouseholdNumber : null,
          approvalDate: k.useApprovalDate || null,
          floorAreaRatio: typeof k.floorAreaRatio === "number" ? k.floorAreaRatio : null,
        });
      }
    } else if (result?.list && Array.isArray(result.list)) {
      for (const g of result.list) {
        const rep = g.representativeArticleInfo;
        if (!rep || rep.tradeType !== "A1" || !rep.complexNumber) continue;
        if (rep.realEstateType && !APARTMENT_TYPES.has(rep.realEstateType)) continue;
        const list = g.duplicatedArticleInfo?.articleInfoList?.length ? g.duplicatedArticleInfo.articleInfoList : [rep];
        const complexId = `naver-${rep.complexNumber}`;
        if (!complexes.has(complexId)) {
          const coords = rep.address?.coordinates;
          const region = resolveRegion(rep.address?.city ?? "", rep.address?.division ?? "");
          complexes.set(complexId, {
            id: complexId,
            name: rep.complexName,
            source: "naver-import",
            location: { lat: coords?.yCoordinate ?? 0, lng: coords?.xCoordinate ?? 0 },
            address: [rep.address?.city, rep.address?.division, rep.address?.sector].filter(Boolean).join(" "),
            region,
            households: null,
            floorAreaRatio: null,
            approvalYear: rep.buildingInfo?.buildingConjunctionDate
              ? parseInt(rep.buildingInfo.buildingConjunctionDate.slice(0, 4), 10)
              : null,
          });
          if (!region.lawdCd) warnings.push(`${rep.complexName}: 시군구 코드 미확인(${region.sido} ${region.sigungu}) — 실거래가 조회 불가`);
        }
        const area = rep.spaceInfo?.exclusiveSpace ?? 0;
        const floor = parseFloor(rep.articleDetail?.floorInfo);
        const unitId = `naver-${rep.articleNumber}`;
        const ads = list.map(toAd);
        const unit: ListingUnit = {
          id: unitId,
          complexId,
          dong: rep.dongName ?? null,
          floorLabel: floor.label,
          floor: floor.floor,
          totalFloors: floor.total,
          exclusiveArea: area,
          supplyArea: rep.spaceInfo?.supplySpace ?? null,
          areaName: rep.spaceInfo?.supplySpaceName ?? null,
          roomCount: defaultRooms(area),
          direction: rep.articleDetail?.direction ?? null,
          price: rep.priceInfo?.dealPrice ?? 0,
          ads,
          photoUrl: rep.articleMediaDto?.imageUrl ?? null,
        };
        units.set(unitId, unit);
      }
    } else if (result && (result as { priceInfo?: unknown }).priceInfo) {
      const d = toDetail(result as NaverBasicInfo);
      if (d) details.push(d);
    }
  }
  return { complexes: [...complexes.values()], units: [...units.values()], details, complexInfos: [...complexInfos.values()], warnings };
}

/** 메모리 안에서 목록+상세를 합친 결과(DB 없이 쓰는 경로·테스트용) */
export function importNaverPayloads(payloads: unknown[]): ImportedData {
  const parsed = parseNaverPayloads(payloads);
  const adIndex = new Map<string, { ad: RealtorAd; unit: ListingUnit }>();
  for (const u of parsed.units) for (const ad of u.ads) adIndex.set(ad.articleNo, { ad, unit: u });
  let enriched = 0;
  for (const d of parsed.details) {
    const hit = adIndex.get(d.articleNo);
    if (!hit) {
      parsed.warnings.push(`상세 ${d.articleNo}: 목록에 없는 매물이라 건너뜀`);
      continue;
    }
    applyDetailToAd(hit.ad, d);
    if (d.roomCount) hit.unit.roomCount = d.roomCount;
    enriched++;
  }
  if (parsed.units.length === 0) {
    parsed.warnings.push("매매(A1) 매물 그룹을 찾지 못했습니다. complex/article/list 응답 또는 HAR 파일인지 확인하세요.");
  }
  return { complexes: parsed.complexes, units: parsed.units, warnings: parsed.warnings, enrichedAds: enriched };
}
