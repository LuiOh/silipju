"use client";
// Leaflet 지도(클라이언트 전용): 옅은 OSM 바탕·지하철 노선, 단지 최저가 마커, 직장 마커, 지도 클릭으로 직장 찍기
import { useEffect, useEffectEvent, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { GeoPoint, SearchResultItem, Workplace } from "@/lib/types";
import { formatEokShort } from "@/lib/format";
import { createMapPanes, loadTransitData, TransitOverlay } from "./transit-layer";

export interface MapFocus {
  point: GeoPoint;
  seq: number;
}

interface ComplexGroup {
  id: string;
  name: string;
  location: GeoPoint;
  lowest: number;
  count: number;
  hasMoveIn: boolean;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}

const DEFAULT_CENTER: L.LatLngTuple = [37.45, 127.07];


export default function LeafletMap({
  items,
  workplaces,
  selectedComplexId,
  highlightedComplexId,
  focus,
  fitSeq,
  pickMode,
  showTransit,
  onComplexClick,
  onPick,
}: {
  items: SearchResultItem[];
  workplaces: Workplace[];
  selectedComplexId: string | null;
  highlightedComplexId: string | null;
  focus: MapFocus | null;
  fitSeq: number;
  pickMode: boolean;
  showTransit: boolean;
  onComplexClick: (complexId: string) => void;
  onPick: (p: GeoPoint) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const complexLayerRef = useRef<L.LayerGroup | null>(null);
  const workLayerRef = useRef<L.LayerGroup | null>(null);
  const transitRef = useRef<TransitOverlay | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, ComplexGroup>();
    for (const it of items) {
      const g = m.get(it.complex.id);
      const movein = it.seango.status === "movein";
      if (g) {
        g.lowest = Math.min(g.lowest, it.unit.price);
        g.count += 1;
        g.hasMoveIn ||= movein;
      } else {
        m.set(it.complex.id, {
          id: it.complex.id,
          name: it.complex.name,
          location: it.complex.location,
          lowest: it.unit.price,
          count: 1,
          hasMoveIn: movein,
        });
      }
    }
    return [...m.values()];
  }, [items]);

  const handleMapClick = useEffectEvent((ll: L.LatLng) => {
    if (pickMode) onPick({ lat: Number(ll.lat.toFixed(5)), lng: Number(ll.lng.toFixed(5)) });
  });
  const handleComplexClick = useEffectEvent((id: string) => onComplexClick(id));
  const applyTransitVisibility = useEffectEvent(() => transitRef.current?.setVisible(showTransit));

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const map = L.map(el, { center: DEFAULT_CENTER, zoom: 11, zoomControl: false, attributionControl: true });
    L.control.zoom({ position: "bottomright" }).addTo(map);
    createMapPanes(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      className: "map-basemap",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.attributionControl.setPrefix(false);
    complexLayerRef.current = L.layerGroup().addTo(map);
    workLayerRef.current = L.layerGroup().addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => handleMapClick(e.latlng));
    mapRef.current = map;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    let disposed = false;
    loadTransitData().then(
      (data) => {
        if (disposed) return;
        transitRef.current = new TransitOverlay(map, data);
        applyTransitVisibility();
      },
      (err: unknown) => console.warn("지하철 노선 데이터를 불러오지 못했습니다.", err),
    );
    return () => {
      disposed = true;
      transitRef.current?.destroy();
      transitRef.current = null;
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      complexLayerRef.current = null;
      workLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    transitRef.current?.setVisible(showTransit);
  }, [showTransit]);

  useEffect(() => {
    const layer = complexLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    for (const g of groups) {
      const active = g.id === selectedComplexId || g.id === highlightedComplexId;
      const cls = ["map-pin", g.hasMoveIn ? "map-pin--movein" : "", active ? "map-pin--active" : ""].filter(Boolean).join(" ");
      const html = `<div class="${cls}" title="${escapeHtml(g.name)}">${formatEokShort(g.lowest)}${
        g.count > 1 ? `<span class="map-pin-count">${g.count}</span>` : ""
      }</div>`;
      const marker = L.marker([g.location.lat, g.location.lng], {
        icon: L.divIcon({ className: "map-anchor", html, iconSize: [0, 0], iconAnchor: [0, 0] }),
        title: `${g.name} 최저 ${formatEokShort(g.lowest)}`,
        alt: `${g.name} 최저 ${formatEokShort(g.lowest)}`,
        keyboard: true,
        riseOnHover: true,
        zIndexOffset: active ? 1000 : g.hasMoveIn ? 100 : 0,
      });
      marker.on("click", () => handleComplexClick(g.id));
      marker.addTo(layer);
    }
  }, [groups, selectedComplexId, highlightedComplexId]);

  useEffect(() => {
    const layer = workLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    workplaces.forEach((w, i) => {
      const html = `<div class="map-work"><b>${i + 1}</b>${escapeHtml(w.label)}</div>`;
      L.marker([w.location.lat, w.location.lng], {
        icon: L.divIcon({ className: "map-anchor", html, iconSize: [0, 0], iconAnchor: [0, 0] }),
        title: `직장 ${w.label}`,
        alt: `직장 ${w.label}`,
        interactive: false,
        zIndexOffset: 2000,
      }).addTo(layer);
    });
  }, [workplaces]);

  const fitAll = useEffectEvent(() => {
    const map = mapRef.current;
    if (!map) return;
    const pts: L.LatLngTuple[] = [
      ...groups.map((g): L.LatLngTuple => [g.location.lat, g.location.lng]),
      ...workplaces.map((w): L.LatLngTuple => [w.location.lat, w.location.lng]),
    ];
    if (pts.length === 0) return;
    if (pts.length === 1) map.setView(pts[0], 14);
    else map.fitBounds(L.latLngBounds(pts), { padding: [48, 48], maxZoom: 15 });
  });

  useEffect(() => {
    if (fitSeq > 0) fitAll();
  }, [fitSeq]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    map.setView([focus.point.lat, focus.point.lng], Math.max(map.getZoom(), 14), { animate: true });
  }, [focus]);

  useEffect(() => {
    containerRef.current?.classList.toggle("map-picking", pickMode);
  }, [pickMode]);

  return <div ref={containerRef} className="h-full w-full bg-surface-3" role="application" aria-label="매물 지도" />;
}
