// 동네 브리핑 LLM 답 해석(코드 블록·앞뒤 설명·빠진 필드), 인용 출처 병합, 바로가기 링크 테스트(네트워크 없음)

import { describe, expect, it } from "vitest";
import type { Complex } from "@/lib/types";
import { BriefParseError, briefLinks, buildBriefPrompt, citationLinks, mergeSources, parseBriefAnswer } from "./brief";

const full = {
  summary: "역세권 대단지입니다.",
  location: { transit: "수인분당선 도보 5분", amenities: "대형마트 인접", education: "학원가 도보권", nature: "근린공원 인접" },
  reputation: {
    pros: ["조용함"],
    cons: ["주차 부족"],
    quotes: [{ text: "관리가 잘 됩니다 010-1234-5678", source: "호갱노노", url: "https://hogangnono.com/apt/abc" }],
  },
  schools: {
    assignedElementary: { name: "OO초등학교", confidence: "추정", basis: "단지 바로 옆", url: "https://example.com/school" },
    middleSchoolNote: "중학교는 학군 추첨입니다.",
  },
  cautions: ["학구도에서 확인하세요."],
  sources: [{ title: "후기", url: "https://blog.example.com/1" }],
};

describe("parseBriefAnswer", () => {
  it("코드 블록 안 JSON을 읽는다", () => {
    const text = `검색해 보겠습니다.\n\n\`\`\`json\n${JSON.stringify(full, null, 2)}\n\`\`\`\n`;
    const r = parseBriefAnswer(text);
    expect(r.summary).toBe("역세권 대단지입니다.");
    expect(r.schools.assignedElementary).toEqual({ name: "OO초등학교", confidence: "추정", basis: "단지 바로 옆", url: "https://example.com/school" });
    expect(r.reputation.quotes[0].text).not.toContain("010-1234-5678");
  });

  it("코드 블록 없이 앞에 설명이 붙은 JSON도 찾는다", () => {
    const text = `여러 출처를 확인했습니다. {중괄호 섞인 문장} 정리하면 다음과 같습니다.\n${JSON.stringify(full)}\n이상입니다.`;
    expect(parseBriefAnswer(text).location.transit).toBe("수인분당선 도보 5분");
  });

  it("문자열 안의 중괄호를 깨지 않고 읽는다", () => {
    const text = JSON.stringify({ ...full, summary: "요약 {괄호} \"따옴표\"" });
    expect(parseBriefAnswer(`앞말 ${text}`).summary).toBe('요약 {괄호} "따옴표"');
  });

  it("빠진 필드는 기본값으로 채우고 잘못된 값은 버린다", () => {
    const r = parseBriefAnswer(
      '```json\n{"summary":"짧은 요약","reputation":{"pros":["a", 3, ""],"quotes":[{"text":"q","url":"javascript:alert(1)"}]},"schools":{"assignedElementary":{"name":"모름","confidence":"확실"}},"sources":[{"url":"ftp://x"},{"title":"t","url":"https://ok.example/"}]}\n```',
    );
    expect(r.location).toEqual({ transit: "모름", amenities: "모름", education: "모름", nature: "모름" });
    expect(r.reputation.pros).toEqual(["a"]);
    expect(r.reputation.cons).toEqual([]);
    expect(r.reputation.quotes).toEqual([{ text: "q", source: "출처 미상", url: null }]);
    expect(r.schools.assignedElementary).toEqual({ name: null, confidence: "모름", basis: "근거를 찾지 못했습니다.", url: null });
    expect(r.cautions).toEqual([]);
    expect(r.sources).toEqual([{ title: "t", url: "https://ok.example/" }]);
  });

  it("JSON이 없으면 한국어 오류를 던진다", () => {
    expect(() => parseBriefAnswer("죄송합니다. 정보를 찾지 못했습니다.")).toThrow(BriefParseError);
    expect(() => parseBriefAnswer('{"foo": 1}')).toThrow("브리핑 JSON을 찾지 못했습니다");
  });
});

describe("출처 병합", () => {
  it("웹 검색 인용 URL을 모으고 중복을 없앤다", () => {
    const cites = citationLinks([
      { type: "text", text: "a", citations: [{ type: "web_search_result_location", url: "https://blog.example.com/1", title: "중복" }] },
      { type: "text", text: "b", citations: [{ type: "web_search_result_location", url: "https://news.example.com/2", title: "뉴스" }] },
      { type: "web_search_tool_result", content: [] },
      { type: "text", text: "c" },
    ]);
    expect(cites).toHaveLength(2);
    const merged = mergeSources([{ title: "후기", url: "https://blog.example.com/1" }], cites);
    expect(merged.map((m) => m.url)).toEqual(["https://blog.example.com/1", "https://news.example.com/2"]);
  });
});

const complex: Complex = {
  id: "naver-111385",
  name: "테스트마을",
  source: "naver-import",
  location: { lat: 37.367, lng: 127.1083 },
  address: "경기도 성남시 분당구 정자동 1",
  region: {
    sido: "경기도",
    sigungu: "성남시 분당구",
    lawdCd: "41135",
    isCapitalArea: true,
    isRegulated: false,
    roomDeductionBucket: "overcrowded",
    isMetropolitanCity: false,
  },
  households: 1200,
  approvalYear: 1995,
  floorAreaRatio: null,
};

describe("프롬프트와 링크", () => {
  it("단지 사실·가까운 역·학교를 프롬프트에 넣는다", () => {
    const { user, system } = buildBriefPrompt(complex, [
      { id: "1", name: "정자초등학교", kind: "elementary", distanceM: 320, walkMinutes: 6, address: null, url: null },
    ]);
    expect(user).toContain("테스트마을");
    expect(user).toContain("정자역");
    expect(user).toContain("정자초등학교(초) 직선 320m");
    expect(system).toContain("schoolzone.emac.kr");
  });

  it("네이버 단지 번호로 바로가기를 만든다", () => {
    const links = briefLinks(complex);
    expect(links[0].url).toBe("https://fin.land.naver.com/complexes/111385");
    expect(links.some((l) => l.url.startsWith("https://hogangnono.com/search?q="))).toBe(true);
    expect(links.at(-1)?.url).toBe("https://schoolzone.emac.kr/");
    expect(briefLinks({ ...complex, id: "demo-1" }).some((l) => l.url.includes("fin.land"))).toBe(false);
  });
});
