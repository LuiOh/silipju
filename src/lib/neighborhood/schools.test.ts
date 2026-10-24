// 카카오 SC4 결과의 초·중·고 분류, 도보 시간 추정, 거리순 정리 테스트(네트워크 없음)

import { describe, expect, it } from "vitest";
import { classifySchool, normalizeSchools, walkMinutes } from "./schools";

describe("classifySchool", () => {
  it("카테고리 끝 이름으로 분류한다", () => {
    expect(classifySchool("교육,학문 > 학교 > 초등학교", "정자초등학교")).toBe("elementary");
    expect(classifySchool("교육,학문 > 학교 > 중학교", "내정중학교")).toBe("middle");
    expect(classifySchool("교육,학문 > 학교 > 고등학교", "분당고등학교")).toBe("high");
  });

  it("카테고리가 모호하면 학교 이름으로 분류한다", () => {
    expect(classifySchool("교육,학문 > 학교", "수원여자고등학교")).toBe("high");
    expect(classifySchool("교육,학문 > 학교", "한빛초교")).toBe("elementary");
    expect(classifySchool("교육,학문 > 학교", "성남여중")).toBe("middle");
  });

  it("유치원·대학교·병설은 제외한다", () => {
    expect(classifySchool("교육,학문 > 학교 > 대학교", "가천대학교")).toBeNull();
    expect(classifySchool("교육,학문 > 학교", "정자초등학교병설유치원")).toBeNull();
    expect(classifySchool("교육,학문 > 학원", "OO중고등부학원")).toBeNull();
  });
});

describe("normalizeSchools", () => {
  it("거리순으로 정리하고 중복·분류 불가를 걸러 낸다", () => {
    const r = normalizeSchools([
      { id: "3", place_name: "내정중학교", category_name: "교육,학문 > 학교 > 중학교", distance: "800", place_url: "http://place.map.kakao.com/3" },
      { id: "1", place_name: "정자초등학교", category_name: "교육,학문 > 학교 > 초등학교", distance: "250", road_address_name: "성남시 분당구 정자로 1" },
      { id: "1", place_name: "정자초등학교", category_name: "교육,학문 > 학교 > 초등학교", distance: "250" },
      { id: "9", place_name: "가천대학교", category_name: "교육,학문 > 학교 > 대학교", distance: "100" },
      { id: "4", place_name: "분당고등학교", category_name: "교육,학문 > 학교 > 고등학교", distance: "abc" },
    ]);
    expect(r.map((s) => s.name)).toEqual(["정자초등학교", "내정중학교"]);
    expect(r[0]).toMatchObject({ kind: "elementary", distanceM: 250, address: "성남시 분당구 정자로 1", url: null });
    expect(r[1].url).toBe("http://place.map.kakao.com/3");
  });
});

describe("walkMinutes", () => {
  it("우회 계수를 반영해 분 단위로 반올림한다", () => {
    expect(walkMinutes(0)).toBe(1);
    expect(walkMinutes(750)).toBe(13);
    expect(walkMinutes(1500)).toBe(26);
  });
});
