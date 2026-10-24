// 금액·면적·시간 표기와 한국식 금액 문자열 파싱 유틸

const EOK = 100_000_000;
const MAN = 10_000;

/** 원 단위 금액을 "6억 4,500만" 형태로 표기 */
export function formatWon(won: number | null | undefined, opts: { zero?: string } = {}): string {
  if (won === null || won === undefined || Number.isNaN(won)) return "-";
  if (won === 0) return opts.zero ?? "0원";
  const sign = won < 0 ? "-" : "";
  const abs = Math.abs(Math.round(won));
  const eok = Math.floor(abs / EOK);
  const man = Math.round((abs % EOK) / MAN);
  if (eok > 0 && man > 0) return `${sign}${eok}억 ${man.toLocaleString("ko-KR")}만`;
  if (eok > 0) return `${sign}${eok}억`;
  if (man > 0) return `${sign}${man.toLocaleString("ko-KR")}만`;
  return `${sign}${abs.toLocaleString("ko-KR")}원`;
}

/** 원 단위 금액을 "6.45억"처럼 짧게 표기 */
export function formatEokShort(won: number): string {
  const v = won / EOK;
  return `${v >= 10 ? v.toFixed(1) : v.toFixed(2)}억`.replace(/\.?0+억$/, "억");
}

export function toPyeong(squareMeters: number): number {
  return squareMeters / 3.305785;
}

export function formatMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return "-";
  const m = Math.round(min);
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h}시간` : `${h}시간 ${r}분`;
}

/**
 * "9억", "9.5억", "5억5천", "5억 5,000만", "95,000만", "3500만원" 같은 문자열을 원 단위로 변환한다.
 * 해석할 수 없으면 null.
 */
export function parseKoreanMoney(raw: string): number | null {
  const s = raw.replace(/\s+/g, "").replace(/원$/, "");
  const m = s.match(/^(\d+(?:\.\d+)?)억(?:(\d[\d,]*)(천만?|만)?)?$/);
  if (m) {
    const eok = parseFloat(m[1]);
    let rest = 0;
    if (m[2]) {
      const n = parseInt(m[2].replace(/,/g, ""), 10);
      if (m[3]?.startsWith("천")) rest = n * 1000 * MAN;
      else if (m[3] === "만") rest = n * MAN;
      // 단위 없이 "5억5000"이면 만원 단위로 본다
      else rest = n < 10 ? n * 1000 * MAN : n * MAN;
    }
    return Math.round(eok * EOK + rest);
  }
  const m2 = s.match(/^(\d[\d,]*)(천만?|만)$/);
  if (m2) {
    const n = parseInt(m2[1].replace(/,/g, ""), 10);
    return m2[2].startsWith("천") ? n * 1000 * MAN : n * MAN;
  }
  return null;
}

export const WON = { EOK, MAN };
