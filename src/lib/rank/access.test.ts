// 역세권 노선 제외(에버라인 등)와 학군(가까운 초·중학교 거리) 계산을 실제 정적 데이터로 확인하는 테스트

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nearestSchools, schoolScore } from "./school-access";
import { nearestStation, stationLines } from "./station-access";

const stations = (JSON.parse(readFileSync(path.join(process.cwd(), "public", "transit", "metro-stations.json"), "utf8")) as {
  stations: { name: string; lat: number; lng: number; lines: string[] }[];
}).stations;
const stationAt = (name: string, line: string) => {
  const s = stations.find((x) => x.name === name && x.lines.includes(line));
  if (!s) throw new Error(`${name}(${line}) 역이 데이터에 없습니다.`);
  return { lat: s.lat, lng: s.lng };
};

describe("역세권 노선 제외", () => {
  it("에버라인(용인경전철)만 지나는 역은 빼면 다른 노선 역으로 계산한다", () => {
    const jiseok = stationAt("지석", "용인경전철");
    expect(nearestStation(jiseok)?.name).toBe("지석");
    const other = nearestStation(jiseok, ["용인경전철"]);
    expect(other?.name).not.toBe("지석");
    expect(other?.lines).not.toContain("용인경전철");
    expect(other?.distanceM).toBeGreaterThan(0);
  });

  it("환승역은 남은 노선만 남긴다", () => {
    const giheung = stationAt("기흥", "수인분당선");
    expect(nearestStation(giheung, ["용인경전철"])).toMatchObject({ name: "기흥", lines: ["수인분당선"], distanceM: 0 });
  });

  it("노선 목록은 1~9호선이 먼저 오고 에버라인·경강선을 포함한다", () => {
    const lines = stationLines();
    expect(lines.slice(0, 3)).toEqual(["1호선", "2호선", "3호선"]);
    expect(lines).toEqual(expect.arrayContaining(["용인경전철", "경강선"]));
  });
});

describe("학군(가까운 초·중학교)", () => {
  it("학교 바로 옆이면 그 학교를 찾고 거리가 0에 가깝다", () => {
    const raw = JSON.parse(readFileSync(path.join(process.cwd(), "public", "schools", "schools.json"), "utf8")) as {
      schools: { name: string; kind: string; lat: number; lng: number }[];
    };
    const school = raw.schools.find((s) => s.name === "구갈초등학교");
    expect(school).toBeDefined();
    const access = nearestSchools({ lat: school!.lat, lng: school!.lng });
    expect(access?.elementary).toMatchObject({ name: "구갈초등학교", distanceM: 0 });
    expect(access?.middle?.distanceM).toBeGreaterThan(0);
  });

  it("초등학교 250m·중학교 400m 이내면 만점, 둘 다 멀면 0점", () => {
    const at = (e: number, m: number) => ({ elementary: { name: "초", distanceM: e, walkMinutes: 1 }, middle: { name: "중", distanceM: m, walkMinutes: 1 } });
    expect(schoolScore(at(200, 300))).toBe(1);
    expect(schoolScore(at(1300, 1600))).toBe(0);
    expect(schoolScore(at(725, 400))).toBeCloseTo(0.7);
    expect(schoolScore({ elementary: null, middle: null })).toBe(0);
  });
});
