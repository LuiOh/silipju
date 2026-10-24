// 국토부 실거래가 XML 응답 파싱 테스트(fetch를 가짜 응답으로 대체, 해제 거래·페이지·오류 응답 확인)

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRentMonth, fetchTradeMonth, sameApartment } from "./molit";

function xml(items: string, total: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items>${items}</items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>${total}</totalCount></body></response>`;
}

afterEach(() => vi.unstubAllGlobals());

describe("molit", () => {
  it("매매: 콤마 금액을 원 단위로 바꾸고 해제 거래(O)는 뺀다", async () => {
    const body = xml(
      `<item><aptNm>헬리오시티</aptNm><umdNm>가락동</umdNm><jibun>913</jibun><excluUseAr>84.99</excluUseAr><floor>12</floor><dealAmount> 285,000</dealAmount><dealYear>2026</dealYear><dealMonth>9</dealMonth><dealDay>3</dealDay><cdealType> </cdealType><dealingGbn>중개거래</dealingGbn></item>
       <item><aptNm>헬리오시티</aptNm><excluUseAr>84.99</excluUseAr><floor>3</floor><dealAmount>270,000</dealAmount><dealYear>2026</dealYear><dealMonth>9</dealMonth><dealDay>5</dealDay><cdealType>O</cdealType></item>`,
      2,
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    const rows = await fetchTradeMonth("11710", "202609");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ aptName: "헬리오시티", price: 2_850_000_000, floor: 12, dealDate: "2026-09-03", jibun: "913" });
  });

  it("전월세: 보증금·월세·계약기간을 읽는다", async () => {
    const body = xml(
      `<item><aptNm>헬리오시티</aptNm><excluUseAr>84.99</excluUseAr><floor>12</floor><deposit>120,000</deposit><monthlyRent>0</monthlyRent><dealYear>2025</dealYear><dealMonth>3</dealMonth><dealDay>10</dealDay><contractTerm>25.04~27.04</contractTerm><contractType>신규</contractType><useRRRight></useRRRight></item>`,
      1,
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    const rows = await fetchRentMonth("11710", "202503");
    expect(rows[0]).toMatchObject({ deposit: 1_200_000_000, monthlyRent: 0, contractTerm: "25.04~27.04", contractDate: "2025-03-10" });
  });

  it("게이트웨이 오류 응답은 사유와 함께 예외로 던진다", async () => {
    const body = `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
    await expect(fetchTradeMonth("11710", "202609")).rejects.toThrow("SERVICE_KEY_IS_NOT_REGISTERED_ERROR");
  });

  it("단지명은 공백·'아파트'·괄호를 무시하고 포함 관계로 비교한다", () => {
    expect(sameApartment("래미안대치팰리스1단지", "래미안 대치팰리스")).toBe(true);
    expect(sameApartment("헬리오시티(가락)", "헬리오시티 아파트")).toBe(true);
    expect(sameApartment("헬리오시티", "잠실엘스")).toBe(false);
  });
});
