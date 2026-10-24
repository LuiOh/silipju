// 직장 위치 입력용 내장 장소 사전(업무지구·주요 사옥·역)과 검색

import type { PlaceSuggestion } from "@/lib/types";
import { STATIONS } from "./stations";

interface BuiltinPlace {
  label: string;
  aliases: string[];
  lat: number;
  lng: number;
  detail: string;
}

const DISTRICTS: BuiltinPlace[] = [
  { label: "판교테크노밸리", aliases: ["판교", "판교밸리", "판교 테크노밸리", "카카오", "엔씨"], lat: 37.402, lng: 127.1086, detail: "성남시 분당구 삼평동" },
  { label: "판교 제2테크노밸리", aliases: ["제2판교", "판교2밸리"], lat: 37.4166, lng: 127.0998, detail: "성남시 수정구 시흥동" },
  { label: "정자동 업무지구", aliases: ["정자", "네이버", "네이버 1784", "그린팩토리"], lat: 37.3594, lng: 127.1052, detail: "성남시 분당구 정자동" },
  { label: "서현역 일대", aliases: ["서현", "분당"], lat: 37.385, lng: 127.1233, detail: "성남시 분당구 서현동" },
  { label: "강남역 업무지구", aliases: ["강남", "강남역"], lat: 37.4979, lng: 127.0276, detail: "서울 강남구 역삼동" },
  { label: "테헤란로(역삼·선릉)", aliases: ["역삼", "선릉", "테헤란로"], lat: 37.5027, lng: 127.0425, detail: "서울 강남구" },
  { label: "삼성역·코엑스", aliases: ["삼성", "코엑스", "삼성역"], lat: 37.5088, lng: 127.0631, detail: "서울 강남구 삼성동" },
  { label: "여의도 업무지구", aliases: ["여의도", "IFC"], lat: 37.5251, lng: 126.9256, detail: "서울 영등포구" },
  { label: "광화문·시청", aliases: ["광화문", "시청", "종로"], lat: 37.5688, lng: 126.9783, detail: "서울 중구·종로구" },
  { label: "을지로·명동", aliases: ["을지로", "명동"], lat: 37.5661, lng: 126.9862, detail: "서울 중구" },
  { label: "서울역", aliases: ["서울역"], lat: 37.5547, lng: 126.9707, detail: "서울 중구" },
  { label: "용산 업무지구", aliases: ["용산"], lat: 37.5298, lng: 126.9648, detail: "서울 용산구" },
  { label: "마곡 LG사이언스파크", aliases: ["마곡", "LG사이언스파크"], lat: 37.5615, lng: 126.834, detail: "서울 강서구 마곡동" },
  { label: "가산디지털단지", aliases: ["가산", "가산디지털"], lat: 37.4795, lng: 126.8826, detail: "서울 금천구" },
  { label: "구로디지털단지", aliases: ["구로", "구디"], lat: 37.4852, lng: 126.8982, detail: "서울 구로구" },
  { label: "상암 DMC", aliases: ["상암", "DMC"], lat: 37.5784, lng: 126.8896, detail: "서울 마포구 상암동" },
  { label: "성수동", aliases: ["성수"], lat: 37.5446, lng: 127.0557, detail: "서울 성동구" },
  { label: "잠실 롯데월드타워", aliases: ["잠실", "롯데타워"], lat: 37.5126, lng: 127.1025, detail: "서울 송파구" },
  { label: "문정 법조단지", aliases: ["문정"], lat: 37.4858, lng: 127.1225, detail: "서울 송파구 문정동" },
  { label: "양재 현대차 사옥", aliases: ["양재", "현대자동차"], lat: 37.4635, lng: 127.0428, detail: "서울 서초구 양재동" },
  { label: "광교 경기도청", aliases: ["광교", "경기도청"], lat: 37.2894, lng: 127.0533, detail: "수원시 영통구 이의동" },
  { label: "삼성전자 수원사업장", aliases: ["삼성전자 수원", "삼성 디지털시티", "매탄"], lat: 37.2581, lng: 127.0518, detail: "수원시 영통구 매탄동" },
  { label: "삼성전자 기흥캠퍼스", aliases: ["삼성 기흥", "기흥캠퍼스"], lat: 37.2233, lng: 127.0689, detail: "용인시 기흥구 농서동" },
  { label: "삼성전자 화성캠퍼스", aliases: ["삼성 화성", "화성캠퍼스"], lat: 37.2196, lng: 127.0605, detail: "화성시 반월동" },
  { label: "삼성전자 평택캠퍼스", aliases: ["삼성 평택", "고덕"], lat: 37.0215, lng: 127.0465, detail: "평택시 고덕동" },
  { label: "SK하이닉스 이천", aliases: ["하이닉스", "SK하이닉스", "이천"], lat: 37.2085, lng: 127.4859, detail: "이천시 부발읍" },
  { label: "SK하이닉스 용인 반도체클러스터", aliases: ["용인 클러스터", "원삼"], lat: 37.1586, lng: 127.3355, detail: "용인시 처인구 원삼면" },
  { label: "동탄 테크노밸리", aliases: ["동탄", "동탄테크노밸리"], lat: 37.2105, lng: 127.0985, detail: "화성시 동탄구" },
  { label: "성남시청", aliases: ["성남시청"], lat: 37.42, lng: 127.1265, detail: "성남시 중원구 여수동" },
  { label: "평촌 업무지구", aliases: ["평촌", "안양"], lat: 37.3943, lng: 126.9636, detail: "안양시 동안구" },
];

export function searchBuiltinPlaces(query: string, limit = 8): PlaceSuggestion[] {
  const q = query.replace(/\s+/g, "").replace(/역$/, "");
  if (!q) return [];
  const results: { score: number; s: PlaceSuggestion }[] = [];
  for (const d of DISTRICTS) {
    const names = [d.label, ...d.aliases].map((n) => n.replace(/\s+/g, ""));
    const exact = names.some((n) => n === q || n === `${q}역`);
    const partial = names.some((n) => n.includes(q));
    if (exact || partial) {
      results.push({
        score: exact ? 3 : 1,
        s: { label: d.label, detail: d.detail, location: { lat: d.lat, lng: d.lng }, kind: "district", source: "builtin" },
      });
    }
  }
  for (const st of STATIONS) {
    const exact = st.name === q;
    if (exact || st.name.includes(q)) {
      results.push({
        score: exact ? 2.5 : 0.8,
        s: {
          label: `${st.name}역`,
          detail: st.lines.join(" · "),
          location: { lat: st.lat, lng: st.lng },
          kind: "station",
          source: "builtin",
        },
      });
    }
  }
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.s);
}
