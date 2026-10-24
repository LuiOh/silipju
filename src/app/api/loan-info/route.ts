// 저장된 현행 대출정보(공시 금리·규정 문구 확인 결과) 조회(GET)와 지금 다시 가져오기(POST) API

import { connection } from "next/server";
import { loadLoanInfo, refreshLoanInfo } from "@/lib/finance/live-rates-fetch";

export async function GET() {
  await connection();
  return Response.json({ snapshot: loadLoanInfo() });
}

export async function POST() {
  const snapshot = await refreshLoanInfo();
  return Response.json({ snapshot });
}
