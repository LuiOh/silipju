// 역세권 점수(거리 구간·환승 가산)와 재개발 호재 추정(연식·용적률·1기 신도시) 단위 테스트

import { describe, expect, it } from "vitest";
import type { RegionInfo } from "@/lib/types";
import { redevelopmentSignal } from "./redevelopment";
import { stationScore } from "./station-access";

const station = (distanceM: number, lines = ["신분당선"]) => ({ name: "정자", lines, distanceM, walkMinutes: 1 });
const TRANSFER = ["신분당선", "수인분당선"];

describe("stationScore", () => {
  it("300m 이내 만점, 1.5km 이상 0점, 그 사이는 거리에 비례한다", () => {
    expect(stationScore(station(250))).toBe(1);
    expect(stationScore(station(900))).toBeCloseTo(0.5);
    expect(stationScore(station(1600))).toBe(0);
  });

  it("환승역은 0.1점 더하되 1점을 넘지 않고, 너무 먼 역에는 더하지 않는다", () => {
    expect(stationScore(station(900, TRANSFER))).toBeCloseTo(0.6);
    expect(stationScore(station(250, TRANSFER))).toBe(1);
    expect(stationScore(station(1600, TRANSFER))).toBe(0);
  });
});

const region = (sigungu: string): RegionInfo => ({
  sido: "경기도",
  sigungu,
  lawdCd: null,
  isCapitalArea: true,
  isRegulated: false,
  roomDeductionBucket: "overcrowded",
  isMetropolitanCity: false,
});

describe("redevelopmentSignal", () => {
  it("준공연도를 모르면 0점", () => {
    expect(redevelopmentSignal({ approvalYear: null, floorAreaRatio: 180, region: region("성남시 분당구") }, 2026).score).toBe(0);
  });

  it("오래되고 용적률이 낮을수록, 1기 신도시일수록 높고 신축은 0점", () => {
    const bundang = redevelopmentSignal({ approvalYear: 1993, floorAreaRatio: 180, region: region("성남시 분당구") }, 2026);
    const suwon = redevelopmentSignal({ approvalYear: 1993, floorAreaRatio: 180, region: region("수원시 장안구") }, 2026);
    const dense = redevelopmentSignal({ approvalYear: 1993, floorAreaRatio: 300, region: region("수원시 장안구") }, 2026);
    const fresh = redevelopmentSignal({ approvalYear: 2015, floorAreaRatio: 180, region: region("성남시 분당구") }, 2026);
    expect(bundang.score).toBeGreaterThan(0.9);
    expect(bundang.detail).toContain("1기 신도시(분당)");
    expect(suwon.score).toBeLessThan(bundang.score);
    expect(dense.score).toBeLessThan(suwon.score);
    expect(fresh.score).toBe(0);
  });
});
