// 시군구별 규제지역·수도권·방공제 구간·실거래가 코드 판정(2026-10-24 기준 고시 반영)

import type { RegionInfo, RoomDeductionBucket } from "@/lib/types";

// 투기과열지구·조정대상지역(현재 두 지정이 겹침). 2025-10-16 지정, 2026-07-01 추가 지정분 포함
const REGULATED_GYEONGGI = new Set([
  "과천시",
  "광명시",
  "하남시",
  "의왕시",
  "구리시",
  "성남시 분당구",
  "성남시 수정구",
  "성남시 중원구",
  "수원시 영통구",
  "수원시 장안구",
  "수원시 팔달구",
  "안양시 동안구",
  "용인시 수지구",
  "용인시 기흥구",
  "화성시 동탄구",
]);

// 주택임대차보호법 시행령 제10조 과밀억제권역(서울 제외) + 세종·용인·화성·김포 → 4,800만원 구간
const OVERCROWDED_CITIES = new Set([
  "의정부시",
  "구리시",
  "하남시",
  "고양시",
  "수원시",
  "성남시",
  "안양시",
  "부천시",
  "광명시",
  "과천시",
  "의왕시",
  "군포시",
  "시흥시",
  "용인시",
  "화성시",
  "김포시",
  "세종특별자치시",
]);

// 광역시(군 지역 제외)·안산·광주(경기)·파주·이천·평택 → 2,800만원 구간
const METRO_CITIES = new Set(["안산시", "광주시", "파주시", "이천시", "평택시"]);
const METROPOLITAN_SIDO = new Set(["부산광역시", "대구광역시", "광주광역시", "대전광역시", "울산광역시"]);

const LAWD: Record<string, string> = {
  "서울특별시 종로구": "11110",
  "서울특별시 중구": "11140",
  "서울특별시 용산구": "11170",
  "서울특별시 성동구": "11200",
  "서울특별시 광진구": "11215",
  "서울특별시 동대문구": "11230",
  "서울특별시 중랑구": "11260",
  "서울특별시 성북구": "11290",
  "서울특별시 강북구": "11305",
  "서울특별시 도봉구": "11320",
  "서울특별시 노원구": "11350",
  "서울특별시 은평구": "11380",
  "서울특별시 서대문구": "11410",
  "서울특별시 마포구": "11440",
  "서울특별시 양천구": "11470",
  "서울특별시 강서구": "11500",
  "서울특별시 구로구": "11530",
  "서울특별시 금천구": "11545",
  "서울특별시 영등포구": "11560",
  "서울특별시 동작구": "11590",
  "서울특별시 관악구": "11620",
  "서울특별시 서초구": "11650",
  "서울특별시 강남구": "11680",
  "서울특별시 송파구": "11710",
  "서울특별시 강동구": "11740",
  "경기도 수원시 장안구": "41111",
  "경기도 수원시 권선구": "41113",
  "경기도 수원시 팔달구": "41115",
  "경기도 수원시 영통구": "41117",
  "경기도 성남시 수정구": "41131",
  "경기도 성남시 중원구": "41133",
  "경기도 성남시 분당구": "41135",
  "경기도 의정부시": "41150",
  "경기도 안양시 만안구": "41171",
  "경기도 안양시 동안구": "41173",
  "경기도 광명시": "41210",
  "경기도 평택시": "41220",
  "경기도 과천시": "41290",
  "경기도 구리시": "41310",
  "경기도 남양주시": "41360",
  "경기도 오산시": "41370",
  "경기도 시흥시": "41390",
  "경기도 군포시": "41410",
  "경기도 의왕시": "41430",
  "경기도 하남시": "41450",
  "경기도 용인시 처인구": "41461",
  "경기도 용인시 기흥구": "41463",
  "경기도 용인시 수지구": "41465",
  "경기도 파주시": "41480",
  "경기도 이천시": "41500",
  "경기도 김포시": "41570",
  "경기도 광주시": "41610",
};

const SIDO_ALIASES: Record<string, string> = {
  서울: "서울특별시",
  서울시: "서울특별시",
  경기: "경기도",
  인천: "인천광역시",
  인천시: "인천광역시",
  부산시: "부산광역시",
  대구시: "대구광역시",
  광주광역시: "광주광역시",
  대전시: "대전광역시",
  울산시: "울산광역시",
  세종시: "세종특별자치시",
};

export function normalizeSido(raw: string): string {
  return SIDO_ALIASES[raw] ?? raw;
}

function cityOf(sigungu: string): string {
  return sigungu.split(" ")[0];
}

export function resolveRegion(sidoRaw: string, sigungu: string): RegionInfo {
  const sido = normalizeSido(sidoRaw);
  const city = cityOf(sigungu);
  const isSeoul = sido === "서울특별시";
  const isCapitalArea = isSeoul || sido === "경기도" || sido === "인천광역시";
  const isRegulated = isSeoul || (sido === "경기도" && REGULATED_GYEONGGI.has(sigungu));

  let bucket: RoomDeductionBucket = "other";
  if (isSeoul) bucket = "seoul";
  else if (OVERCROWDED_CITIES.has(city) || sido === "세종특별자치시") bucket = "overcrowded";
  else if (sido === "인천광역시") bucket = ["강화군", "옹진군"].includes(city) ? "other" : "overcrowded";
  else if (METRO_CITIES.has(city) || (METROPOLITAN_SIDO.has(sido) && !city.endsWith("군"))) bucket = "metro";

  return {
    sido,
    sigungu,
    lawdCd: LAWD[`${sido} ${sigungu}`] ?? null,
    isCapitalArea,
    isRegulated,
    roomDeductionBucket: bucket,
    isMetropolitanCity: isSeoul || METROPOLITAN_SIDO.has(sido) || sido === "인천광역시",
  };
}

export function regionLabel(r: RegionInfo): string {
  const tags = [r.isRegulated ? "규제지역" : r.isCapitalArea ? "수도권 비규제" : "지방 비규제"];
  return `${r.sigungu} · ${tags.join(" ")}`;
}
