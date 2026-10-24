// 층 판정(건물 층수 3등분·네이버 저/중/고 표기)과 층 조건 필터 단위 테스트

import { describe, expect, it } from "vitest";
import type { FloorFilter } from "@/lib/types";
import { floorInfo, matchesFloors } from "./floors";

const unit = (floorLabel: string, floor: number | null, totalFloors: number | null) => ({ floorLabel, floor, totalFloors });
const ALL: FloorFilter = { bands: [], excludeFirst: false, excludeTop: false };

describe("floorInfo", () => {
  it("정확한 층은 건물 층수를 3등분해 저·중·고층으로 나눈다", () => {
    expect([1, 5, 6, 10, 11, 15].map((f) => floorInfo(unit(`${f}/15`, f, 15)).band)).toEqual(["low", "low", "mid", "mid", "high", "high"]);
  });

  it("네이버가 저/중/고로만 올린 매물은 그 표기를 따르고 1층·탑층 여부는 모른다고 본다", () => {
    expect(floorInfo(unit("저/15", null, 15))).toEqual({ band: "low", first: null, top: false });
    expect(floorInfo(unit("고/20", null, 20))).toEqual({ band: "high", first: false, top: null });
  });

  it("1층과 탑층을 구분한다", () => {
    expect(floorInfo(unit("1/12", 1, 12))).toMatchObject({ band: "low", first: true, top: false });
    expect(floorInfo(unit("15/15", 15, 15))).toMatchObject({ band: "high", first: false, top: true });
  });
});

describe("matchesFloors", () => {
  it("저층을 빼고(중·고층 선택) 1층·탑층도 뺀다", () => {
    const f: FloorFilter = { bands: ["mid", "high"], excludeFirst: true, excludeTop: true };
    expect(matchesFloors(unit("3/15", 3, 15), f)).toBe(false);
    expect(matchesFloors(unit("8/15", 8, 15), f)).toBe(true);
    expect(matchesFloors(unit("15/15", 15, 15), f)).toBe(false);
    expect(matchesFloors(unit("고/15", null, 15), f)).toBe(true);
  });

  it("층을 모르는 매물은 저·중·고를 골랐을 때만 뺀다", () => {
    const unknown = unit("-", null, null);
    expect(matchesFloors(unknown, ALL)).toBe(true);
    expect(matchesFloors(unknown, { ...ALL, excludeFirst: true, excludeTop: true })).toBe(true);
    expect(matchesFloors(unknown, { ...ALL, bands: ["low"] })).toBe(false);
  });
});
