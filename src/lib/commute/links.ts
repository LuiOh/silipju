// 카카오맵·네이버지도·TMAP 길찾기 딥링크 생성

import type { CommuteMode, GeoPoint, RouteLinks } from "@/lib/types";

export function buildRouteLinks(
  from: GeoPoint,
  fromName: string,
  to: GeoPoint,
  toName: string,
  mode: CommuteMode,
  appUrl: string,
): RouteLinks {
  const fn = encodeURIComponent(fromName);
  const tn = encodeURIComponent(toName);
  const kakaoBy = mode === "car" ? "car" : "traffic";
  const kakaoAppBy = mode === "car" ? "car" : "publictransit";
  const naverPath = mode === "car" ? "car" : "public";
  return {
    kakaoWeb: `https://map.kakao.com/link/by/${kakaoBy}/${fn},${from.lat},${from.lng}/${tn},${to.lat},${to.lng}`,
    kakaoApp: `kakaomap://route?sp=${from.lat},${from.lng}&ep=${to.lat},${to.lng}&by=${kakaoAppBy}`,
    naverApp: `nmap://route/${naverPath}?slat=${from.lat}&slng=${from.lng}&sname=${fn}&dlat=${to.lat}&dlng=${to.lng}&dname=${tn}&appname=${encodeURIComponent(appUrl)}`,
    tmapApp: `tmap://route?startx=${from.lng}&starty=${from.lat}&startname=${fn}&goalx=${to.lng}&goaly=${to.lat}&goalname=${tn}`,
  };
}
