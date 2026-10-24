// 수도권 샘플 단지·매물·실거래를 결정적으로 생성(세안고 단서 분산·구조필드·미래입주 등 실제 패턴 재현)

import type { Complex, ListingUnit, MovingInInfo, RealTrade, RealtorAd } from "@/lib/types";
import { resolveRegion } from "@/lib/finance/regions";

interface ComplexSpec {
  name: string;
  sido: string;
  sigungu: string;
  dongName: string;
  lat: number;
  lng: number;
  households: number;
  year: number;
  floors: number;
  /** [전용면적, 공급면적 이름, 기준 매매가(억)] */
  types: [number, string, number][];
}

const SPECS: ComplexSpec[] = [
  { name: "역삼 다온팰리스", sido: "서울", sigungu: "강남구", dongName: "역삼동", lat: 37.4995, lng: 127.039, households: 820, year: 2008, floors: 25, types: [[84.9, "112A", 28], [114.7, "146A", 36]] },
  { name: "대치 한결아파트", sido: "서울", sigungu: "강남구", dongName: "대치동", lat: 37.496, lng: 127.061, households: 1600, year: 1999, floors: 15, types: [[76.8, "101A", 27], [84.6, "109A", 31]] },
  { name: "잠실 솔빛레이크", sido: "서울", sigungu: "송파구", dongName: "잠실동", lat: 37.5105, lng: 127.089, households: 3500, year: 2008, floors: 32, types: [[59.9, "82A", 21], [84.8, "110A", 27]] },
  { name: "가락 새솔파크", sido: "서울", sigungu: "송파구", dongName: "가락동", lat: 37.4985, lng: 127.115, households: 2200, year: 2018, floors: 29, types: [[59.9, "84B", 18.5], [84.9, "110C", 24]] },
  { name: "성수 리버다온", sido: "서울", sigungu: "성동구", dongName: "성수동", lat: 37.542, lng: 127.052, households: 900, year: 2016, floors: 30, types: [[59.8, "83A", 16], [84.9, "112A", 21]] },
  { name: "마곡 늘해랑", sido: "서울", sigungu: "강서구", dongName: "마곡동", lat: 37.565, lng: 126.83, households: 1500, year: 2014, floors: 20, types: [[59.9, "81A", 11], [84.9, "108A", 14]] },
  { name: "상계 미래숲", sido: "서울", sigungu: "노원구", dongName: "상계동", lat: 37.656, lng: 127.065, households: 2800, year: 1988, floors: 15, types: [[58.7, "79A", 7.2], [84.4, "109A", 9.3]] },
  { name: "봉천 푸른솔", sido: "서울", sigungu: "관악구", dongName: "봉천동", lat: 37.479, lng: 126.956, households: 1200, year: 2003, floors: 20, types: [[59.8, "80A", 8.8], [84.9, "107A", 11.5]] },
  { name: "신도림 다온시티", sido: "서울", sigungu: "구로구", dongName: "신도림동", lat: 37.508, lng: 126.887, households: 1100, year: 2010, floors: 33, types: [[59.9, "82A", 9.5], [84.9, "110A", 12.5]] },
  { name: "미사강변 솔빛", sido: "경기", sigungu: "하남시", dongName: "망월동", lat: 37.56, lng: 127.189, households: 1300, year: 2017, floors: 25, types: [[84.9, "112A", 11], [101.8, "133A", 13]] },
  { name: "정자 솔빛마을", sido: "경기", sigungu: "성남시 분당구", dongName: "정자동", lat: 37.364, lng: 127.113, households: 1400, year: 1995, floors: 20, types: [[59.4, "79A", 12.5], [84.8, "109A", 16.5]] },
  { name: "수내 한결마을", sido: "경기", sigungu: "성남시 분당구", dongName: "수내동", lat: 37.38, lng: 127.118, households: 1800, year: 1993, floors: 15, types: [[84.9, "112A", 17.5], [101.9, "132A", 20]] },
  { name: "판교 늘해랑마을", sido: "경기", sigungu: "성남시 분당구", dongName: "백현동", lat: 37.389, lng: 127.108, households: 900, year: 2009, floors: 18, types: [[84.9, "111A", 20], [101.9, "133A", 24]] },
  { name: "서현 미래숲", sido: "경기", sigungu: "성남시 분당구", dongName: "서현동", lat: 37.383, lng: 127.13, households: 1100, year: 1993, floors: 15, types: [[59.4, "80A", 11.5], [84.9, "110A", 15.5]] },
  { name: "야탑 다온마을", sido: "경기", sigungu: "성남시 분당구", dongName: "야탑동", lat: 37.413, lng: 127.133, households: 1000, year: 1995, floors: 20, types: [[59.9, "80A", 9.8], [84.9, "108A", 12.8]] },
  { name: "단대 새솔푸르지오", sido: "경기", sigungu: "성남시 수정구", dongName: "단대동", lat: 37.446, lng: 127.154, households: 1000, year: 2020, floors: 30, types: [[59.9, "84A", 9.2], [84.9, "113A", 11.8]] },
  { name: "신흥 한결자이", sido: "경기", sigungu: "성남시 수정구", dongName: "신흥동", lat: 37.441, lng: 127.145, households: 4700, year: 2023, floors: 35, types: [[59.9, "84A", 9.5], [84.9, "114A", 12]] },
  { name: "상현 솔빛마을", sido: "경기", sigungu: "용인시 수지구", dongName: "상현동", lat: 37.2985, lng: 127.073, households: 1200, year: 2006, floors: 20, types: [[84.9, "110A", 9.3], [114.9, "146A", 11.5]] },
  { name: "성복 늘해랑", sido: "경기", sigungu: "용인시 수지구", dongName: "성복동", lat: 37.315, lng: 127.078, households: 1500, year: 2012, floors: 25, types: [[84.9, "112A", 10.5], [101.9, "134A", 12.5]] },
  { name: "동천 미래숲", sido: "경기", sigungu: "용인시 수지구", dongName: "동천동", lat: 37.336, lng: 127.099, households: 800, year: 2008, floors: 20, types: [[84.9, "111A", 10.8]] },
  { name: "구성역 한결마을", sido: "경기", sigungu: "용인시 기흥구", dongName: "마북동", lat: 37.301, lng: 127.108, households: 1300, year: 2004, floors: 20, types: [[59.9, "81A", 5.6], [84.9, "108A", 6.9]] },
  { name: "신갈 다온마을", sido: "경기", sigungu: "용인시 기흥구", dongName: "신갈동", lat: 37.285, lng: 127.115, households: 900, year: 2003, floors: 15, types: [[59.8, "79A", 4.9], [84.7, "106A", 6.3]] },
  { name: "기흥역 새솔더샵", sido: "경기", sigungu: "용인시 기흥구", dongName: "구갈동", lat: 37.277, lng: 127.118, households: 1700, year: 2018, floors: 39, types: [[59.9, "84A", 6.9], [84.9, "112A", 8.6]] },
  { name: "동백 솔빛마을", sido: "경기", sigungu: "용인시 기흥구", dongName: "중동", lat: 37.271, lng: 127.15, households: 1100, year: 2005, floors: 20, types: [[84.9, "110A", 6.2], [101.9, "132A", 7.4]] },
  { name: "역북 늘해랑", sido: "경기", sigungu: "용인시 처인구", dongName: "역북동", lat: 37.24, lng: 127.205, households: 1000, year: 2019, floors: 25, types: [[59.9, "84A", 4.2], [84.9, "112A", 5.2]] },
  { name: "영통 한결마을", sido: "경기", sigungu: "수원시 영통구", dongName: "영통동", lat: 37.253, lng: 127.073, households: 1300, year: 1998, floors: 20, types: [[59.9, "80A", 5.4], [84.9, "108A", 6.8]] },
  { name: "망포 다온아이파크", sido: "경기", sigungu: "수원시 영통구", dongName: "망포동", lat: 37.244, lng: 127.06, households: 1600, year: 2017, floors: 30, types: [[59.9, "84A", 7.1], [84.9, "112A", 8.9]] },
  { name: "광교호수 솔빛", sido: "경기", sigungu: "수원시 영통구", dongName: "하동", lat: 37.287, lng: 127.056, households: 1200, year: 2012, floors: 30, types: [[84.9, "113A", 13.5], [101.9, "134A", 15.5]] },
  { name: "매탄 새솔", sido: "경기", sigungu: "수원시 영통구", dongName: "매탄동", lat: 37.254, lng: 127.042, households: 2400, year: 2009, floors: 25, types: [[59.9, "82A", 5.9], [84.9, "109A", 7.3]] },
  { name: "호매실 늘푸른", sido: "경기", sigungu: "수원시 권선구", dongName: "호매실동", lat: 37.268, lng: 126.958, households: 1100, year: 2014, floors: 25, types: [[59.9, "83A", 4.6], [84.9, "111A", 5.8]] },
  { name: "동탄역 늘해랑", sido: "경기", sigungu: "화성시 동탄구", dongName: "청계동", lat: 37.201, lng: 127.099, households: 1500, year: 2015, floors: 30, types: [[84.9, "112A", 9.8], [101.9, "134A", 11.2]] },
  { name: "동탄2 미래숲", sido: "경기", sigungu: "화성시 동탄구", dongName: "영천동", lat: 37.19, lng: 127.11, households: 900, year: 2017, floors: 25, types: [[59.9, "83A", 5.6], [84.9, "111A", 6.8]] },
  { name: "경기광주역 한결", sido: "경기", sigungu: "광주시", dongName: "역동", lat: 37.402, lng: 127.255, households: 1000, year: 2018, floors: 25, types: [[59.9, "84A", 4.6], [84.9, "112A", 5.8]] },
  { name: "오포 다온마을", sido: "경기", sigungu: "광주시", dongName: "오포읍", lat: 37.365, lng: 127.229, households: 1200, year: 2016, floors: 20, types: [[84.9, "110A", 4.9]] },
  { name: "부발 솔빛", sido: "경기", sigungu: "이천시", dongName: "부발읍", lat: 37.261, lng: 127.487, households: 800, year: 2019, floors: 25, types: [[84.9, "112A", 4.4]] },
  { name: "고덕 늘해랑", sido: "경기", sigungu: "평택시", dongName: "고덕동", lat: 37.035, lng: 127.048, households: 1200, year: 2021, floors: 30, types: [[84.9, "113A", 5.9], [101.9, "134A", 6.9]] },
  { name: "평촌 새솔", sido: "경기", sigungu: "안양시 동안구", dongName: "평촌동", lat: 37.392, lng: 126.959, households: 1800, year: 1993, floors: 15, types: [[59.4, "79A", 8.5], [84.9, "109A", 11]] },
  { name: "산본 한결", sido: "경기", sigungu: "군포시", dongName: "산본동", lat: 37.36, lng: 126.93, households: 1500, year: 1994, floors: 15, types: [[59.9, "79A", 5.3], [84.9, "108A", 6.8]] },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GENERIC = [
  "남향 로얄층",
  "초역세권 도보 5분",
  "올수리 깔끔",
  "확장형 채광 좋음",
  "학군 우수 초품아",
  "탁 트인 조망",
  "풀옵션 시스템에어컨",
  "단지 중심동 커뮤니티 인접",
  "신혼부부 추천",
  "관리 잘 된 집",
  "급매 가격 조정 가능",
  "판상형 3베이",
  "주차 편리 엘리베이터 인접",
  "공원 조망 정남향",
];
const MOVE_IN = ["주인거주 입주협의", "즉시입주 가능", "공실 바로입주", "집주인 거주 날짜협의", "입주가능 올수리", "입주협의 가능"];
const OFFICE_SUFFIX = ["공인중개사", "부동산", "공인중개사사무소", "부동산중개법인"];
const OFFICE_PREFIX = ["으뜸", "제일", "행복", "신뢰", "센트럴", "삼성", "현대", "명품", "우리", "하나", "첫집", "해밀", "다솜", "푸른", "한빛", "정직"];
const CP = ["매경부동산", "부동산뱅크", "부동산써브", "한국공인중개사협회", "직방"];

type Scenario = "movein" | "allExplicit" | "dispersed" | "structured" | "futureDate" | "conflict";

function pick<T>(r: () => number, arr: readonly T[]): T {
  return arr[Math.floor(r() * arr.length)];
}

function eok(n: number): string {
  const v = Math.round(n / 50_000_000) * 0.5;
  return `${Number.isInteger(v) ? v : v.toFixed(1)}억`;
}

function futureMonth(r: () => number): { label: string; ym: string } {
  const months = 4 + Math.floor(r() * 16);
  const base = new Date(2026, 9, 1);
  base.setMonth(base.getMonth() + months);
  const y = base.getFullYear();
  const m = base.getMonth() + 1;
  const forms = [`${y}.${m}월 입주`, `${String(y).slice(2)}년${m}월 입주`, `${String(y).slice(2)}.${String(m).padStart(2, "0")} 입주가능`, `${y}년 ${m}월 이후 입주`];
  return { label: pick(r, forms), ym: `${y}-${String(m).padStart(2, "0")}` };
}

function buildAd(
  r: () => number,
  complexShort: string,
  articleNo: string,
  text: string,
  movingIn: MovingInInfo | null,
  extra: Partial<RealtorAd> = {},
): RealtorAd {
  return {
    articleNo,
    realtorName: `${complexShort} ${pick(r, OFFICE_PREFIX)}${pick(r, OFFICE_SUFFIX)}`,
    cpName: pick(r, CP),
    featureText: text,
    description: null,
    movingIn,
    previousDeposit: null,
    previousMonthlyRent: null,
    isLeaseHold: null,
    verificationType: r() < 0.3 ? "OWNER" : "S_VR",
    confirmedAt: `2026-10-${String(1 + Math.floor(r() * 23)).padStart(2, "0")}`,
    ...extra,
  };
}

function generateUnitAds(r: () => number, scenario: Scenario, short: string, unitNo: string, price: number): RealtorAd[] {
  const count = scenario === "dispersed" ? 6 + Math.floor(r() * 18) : 1 + Math.floor(r() * r() * 12);
  const ads: RealtorAd[] = [];
  const deposit = price * (0.55 + r() * 0.15);
  const future = futureMonth(r);
  const defaultMovingIn = (): MovingInInfo | null => (r() < 0.5 ? { type: "MV001", date: null, negotiable: r() < 0.5 } : null);
  const dispersedIndex = Math.floor(r() * count);

  for (let i = 0; i < count; i++) {
    const no = `${unitNo}${String(i).padStart(2, "0")}`;
    const generic = `${pick(r, GENERIC)}, ${pick(r, GENERIC)}`;
    switch (scenario) {
      case "movein":
        ads.push(buildAd(r, short, no, r() < 0.55 ? `${generic} ${pick(r, MOVE_IN)}` : generic, defaultMovingIn()));
        break;
      case "allExplicit": {
        const phrase = pick(r, ["세안고", "전세안고 갭투자", "세안고 매매", `전세 ${eok(deposit)} 끼고`, "높은 세안고", "세 끼고 매매"]);
        ads.push(buildAd(r, short, no, r() < 0.8 ? `${generic} ${phrase}` : generic, defaultMovingIn()));
        break;
      }
      case "dispersed":
        ads.push(buildAd(r, short, no, i === dispersedIndex ? `${generic} 세안고` : generic, defaultMovingIn()));
        break;
      case "structured":
        ads.push(
          buildAd(
            r,
            short,
            no,
            generic,
            i === 0 ? { type: "MV004", date: `${future.ym}-01`, negotiable: false } : defaultMovingIn(),
            i === 0 ? { isLeaseHold: true, previousDeposit: Math.round(deposit / 10_000_000) * 10_000_000, previousMonthlyRent: 0 } : {},
          ),
        );
        break;
      case "futureDate":
        ads.push(buildAd(r, short, no, r() < 0.7 ? `${generic} ${future.label}` : generic, defaultMovingIn()));
        break;
      case "conflict":
        ads.push(buildAd(r, short, no, i === 0 ? `${generic} 즉시입주` : `${generic} 세안고`, i === 0 ? { type: "MV001", date: null, negotiable: false } : null));
        break;
    }
  }
  return ads;
}

function pickScenario(r: () => number): Scenario {
  const x = r();
  if (x < 0.68) return "movein";
  if (x < 0.79) return "allExplicit";
  if (x < 0.86) return "dispersed";
  if (x < 0.91) return "structured";
  if (x < 0.96) return "futureDate";
  return "conflict";
}

export interface DemoData {
  complexes: Complex[];
  units: ListingUnit[];
  trades: Map<string, RealTrade[]>;
}

export function generateDemoData(seed = 20261024): DemoData {
  const r = mulberry32(seed);
  const complexes: Complex[] = [];
  const units: ListingUnit[] = [];
  const trades = new Map<string, RealTrade[]>();

  SPECS.forEach((spec, ci) => {
    const id = `demo-${String(ci + 1).padStart(3, "0")}`;
    const region = resolveRegion(spec.sido, spec.sigungu);
    complexes.push({
      id,
      name: spec.name,
      source: "demo",
      location: { lat: spec.lat, lng: spec.lng },
      address: `${region.sido} ${spec.sigungu} ${spec.dongName}`,
      region,
      households: spec.households,
      approvalYear: spec.year,
      floorAreaRatio: null,
    });
    const short = spec.name.split(" ")[0];
    const complexTrades: RealTrade[] = [];

    spec.types.forEach(([area, areaName, baseEok], ti) => {
      const base = baseEok * 100_000_000;
      const unitCount = 4 + Math.floor(r() * 5);
      for (let u = 0; u < unitCount; u++) {
        const floor = 1 + Math.floor(r() * spec.floors);
        const floorAdj = floor <= 3 ? -0.05 : floor >= spec.floors - 2 ? 0.01 : 0.01 * Math.min(3, floor / 6);
        const scenario = pickScenario(r);
        const discount = scenario === "movein" ? 0 : 0.03 + r() * 0.05;
        const price = Math.round((base * (1 + floorAdj + (r() - 0.5) * 0.08 - discount)) / 5_000_000) * 5_000_000;
        const unitNo = `9${String(ci + 1).padStart(3, "0")}${ti}${String(u).padStart(2, "0")}`;
        units.push({
          id: `${id}-${ti}-${u}`,
          complexId: id,
          dong: String(101 + Math.floor(r() * 12)),
          floorLabel: `${floor}/${spec.floors}`,
          floor,
          totalFloors: spec.floors,
          exclusiveArea: area,
          supplyArea: parseFloat(areaName),
          areaName,
          roomCount: area < 60 ? 3 : area < 100 ? 3 : 4,
          direction: pick(r, ["S", "SE", "SW", "E", "W"]),
          price,
          ads: generateUnitAds(r, scenario, short, unitNo, price),
          photoUrl: null,
        });
      }
      for (let m = 24; m >= 1; m--) {
        const d = new Date(2026, 9, 15);
        d.setMonth(d.getMonth() - m);
        const n = Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          const trend = 1 - (m / 24) * 0.09;
          complexTrades.push({
            date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(1 + Math.floor(r() * 27)).padStart(2, "0")}`,
            exclusiveArea: area,
            floor: 1 + Math.floor(r() * spec.floors),
            price: Math.round((base * trend * (0.95 + r() * 0.08)) / 5_000_000) * 5_000_000,
          });
        }
      }
    });
    trades.set(id, complexTrades.sort((a, b) => a.date.localeCompare(b.date)));
  });

  return { complexes, units, trades };
}
