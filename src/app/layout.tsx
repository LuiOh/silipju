// 루트 레이아웃: 한국어 문서 설정, Pretendard 폰트, 페이지 메타데이터
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "실입주 — 세안고 걸러낸 실입주 매물 검색",
  description: "세안고 매물을 걸러내고 대출·필요현금·통근시간까지 한 번에 비교하는 아파트 매매 검색.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full">
      <head>
        <link
          rel="stylesheet"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
