// 재개발·재건축 호재 추정: 준공 연식(재건축 연한 30년), 용적률(낮을수록 사업성↑), 노후계획도시 특별법 대상 1기 신도시 여부

import type { Complex } from "@/lib/types";

export interface RedevelopmentSignal {
  score: number;
  detail: string;
}

// 노후계획도시 정비 및 지원에 관한 특별법(2024-04-27 시행)의 대표 대상인 1기 신도시가 속한 시군구
const FIRST_GEN_NEW_TOWNS: { prefix: string; name: string }[] = [
  { prefix: "성남시 분당구", name: "분당" },
  { prefix: "고양시 일산", name: "일산" },
  { prefix: "안양시 동안구", name: "평촌" },
  { prefix: "군포시", name: "산본" },
  { prefix: "부천시", name: "중동" },
];

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function redevelopmentSignal(c: Pick<Complex, "approvalYear" | "floorAreaRatio" | "region">, currentYear: number): RedevelopmentSignal {
  if (c.approvalYear === null) return { score: 0, detail: "준공연도를 몰라 판단하지 않았습니다." };
  const age = currentYear - c.approvalYear;
  const town = FIRST_GEN_NEW_TOWNS.find((t) => c.region.sigungu.startsWith(t.prefix)) ?? null;
  const ageScore = clamp01((age - 20) / 15);
  const farScore = c.floorAreaRatio === null ? 0.5 : clamp01((300 - c.floorAreaRatio) / 150);
  const newTown = town !== null && age >= 25;
  const score = clamp01(ageScore * (0.35 + 0.65 * farScore) + (newTown ? 0.2 : 0));
  const parts = [`${c.approvalYear}년 준공(${age}년차)${age < 30 ? `, 재건축 연한(30년)까지 ${30 - age}년` : ", 재건축 연한 30년 지남"}`];
  parts.push(c.floorAreaRatio === null ? "용적률 미확인" : `용적률 ${c.floorAreaRatio}%${c.floorAreaRatio <= 200 ? "(낮아 사업성 유리)" : c.floorAreaRatio >= 280 ? "(높아 사업성 불리)" : ""}`);
  if (newTown) parts.push(`1기 신도시(${town.name}) 노후계획도시 특별법 대상 지역`);
  return { score, detail: `${parts.join(" · ")}. 연식·용적률로 추정한 값이며 정비구역 지정 여부는 반영하지 않았습니다.` };
}
