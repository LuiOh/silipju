// 지하철 노선·역 정적 데이터(public/transit)를 불러와 캔버스 노선·역 레이어와 역 이름 라벨로 그리는 Leaflet 오버레이
import L from "leaflet";

export interface TransitLine {
  name: string;
  color: string;
  paths: [number, number][][];
}

export interface TransitStation {
  name: string;
  lat: number;
  lng: number;
  lines: string[];
}

interface TransitData {
  lines: TransitLine[];
  stations: TransitStation[];
}

const PANE = {
  lines: "transit-lines",
  stations: "transit-stations",
  stationLabels: "transit-labels",
} as const;

/** 타일(200) 위, 마커(600) 아래: 노선 → 역 → 역 이름 순으로 쌓는다. */
export function createMapPanes(map: L.Map): void {
  const order: [string, number][] = [
    [PANE.lines, 410],
    [PANE.stations, 420],
    [PANE.stationLabels, 440],
  ];
  for (const [name, zIndex] of order) {
    const pane = map.createPane(name);
    pane.style.zIndex = String(zIndex);
    pane.style.pointerEvents = "none";
  }
}

let dataPromise: Promise<TransitData> | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} 응답 ${res.status}`);
  return (await res.json()) as T;
}

export function loadTransitData(): Promise<TransitData> {
  dataPromise ??= Promise.all([
    fetchJson<{ lines: TransitLine[] }>("/transit/metro-lines.json"),
    fetchJson<{ stations: TransitStation[] }>("/transit/metro-stations.json"),
  ]).then(
    ([l, s]) => ({ lines: l.lines, stations: s.stations }),
    (err: unknown) => {
      dataPromise = null;
      throw err;
    },
  );
  return dataPromise;
}

const LABEL_MIN_ZOOM = 13;
const STATION_MIN_ZOOM = 11;

function lineWeight(zoom: number): number {
  if (zoom >= 15) return 5;
  if (zoom >= 13) return 4;
  if (zoom >= 11) return 3;
  return 2;
}

function dotStyle(zoom: number, transfer: boolean): { radius: number; weight: number } {
  if (zoom >= 15) return transfer ? { radius: 7, weight: 3 } : { radius: 5, weight: 2.5 };
  if (zoom >= 13) return transfer ? { radius: 5.5, weight: 2.5 } : { radius: 4, weight: 2 };
  if (zoom >= 12) return transfer ? { radius: 4, weight: 2 } : { radius: 3, weight: 1.75 };
  return transfer ? { radius: 3, weight: 1.5 } : { radius: 2.25, weight: 1.25 };
}

function cssToken(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

interface StationDot {
  station: TransitStation;
  marker: L.CircleMarker;
  transfer: boolean;
}

interface LineStroke {
  casing: L.Polyline;
  stroke: L.Polyline;
}

export class TransitOverlay {
  private readonly lineGroup = L.layerGroup();
  private readonly stationGroup = L.layerGroup();
  private readonly labelGroup = L.layerGroup();
  private readonly strokes: LineStroke[] = [];
  private readonly dots: StationDot[] = [];
  private visible = false;

  constructor(
    private readonly map: L.Map,
    data: TransitData,
  ) {
    const surface = cssToken("--color-surface", "#ffffff");
    const transferRing = cssToken("--color-ink-2", "#3d4552");
    const lineRenderer = L.canvas({ pane: PANE.lines, padding: 0.3 });
    const stationRenderer = L.canvas({ pane: PANE.stations, padding: 0.3 });
    const colorOf = new Map(data.lines.map((l) => [l.name, l.color]));
    const zoom = map.getZoom();

    for (const line of data.lines) {
      for (const path of line.paths) {
        const weight = lineWeight(zoom);
        const common = { renderer: lineRenderer, interactive: false, lineCap: "round", lineJoin: "round" } as const;
        const casing = L.polyline(path, { ...common, color: surface, weight: weight + 2, opacity: 0.9 });
        const stroke = L.polyline(path, { ...common, color: line.color, weight, opacity: 0.85 });
        this.strokes.push({ casing, stroke });
      }
    }
    for (const s of this.strokes) s.casing.addTo(this.lineGroup);
    for (const s of this.strokes) s.stroke.addTo(this.lineGroup);

    const ordered = [...data.stations].sort((a, b) => a.lines.length - b.lines.length);
    for (const station of ordered) {
      const transfer = station.lines.length > 1;
      const marker = L.circleMarker([station.lat, station.lng], {
        renderer: stationRenderer,
        interactive: false,
        color: transfer ? transferRing : (colorOf.get(station.lines[0]) ?? transferRing),
        fillColor: surface,
        fillOpacity: 1,
        opacity: 1,
        ...dotStyle(zoom, transfer),
      });
      marker.addTo(this.stationGroup);
      this.dots.push({ station, marker, transfer });
    }
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (visible) {
      this.lineGroup.addTo(this.map);
      this.labelGroup.addTo(this.map);
      this.map.on("zoomend", this.restyle).on("moveend", this.updateLabels);
      this.restyle();
      this.updateLabels();
    } else {
      this.map.off("zoomend", this.restyle).off("moveend", this.updateLabels);
      this.lineGroup.remove();
      this.stationGroup.remove();
      this.labelGroup.remove();
    }
  }

  destroy(): void {
    this.setVisible(false);
    this.labelGroup.clearLayers();
  }

  private readonly restyle = () => {
    const zoom = this.map.getZoom();
    const weight = lineWeight(zoom);
    for (const s of this.strokes) {
      s.casing.setStyle({ weight: weight + 2 });
      s.stroke.setStyle({ weight });
    }
    if (zoom >= STATION_MIN_ZOOM) {
      for (const d of this.dots) {
        const st = dotStyle(zoom, d.transfer);
        d.marker.setRadius(st.radius);
        d.marker.setStyle({ weight: st.weight });
      }
      if (!this.map.hasLayer(this.stationGroup)) this.stationGroup.addTo(this.map);
    } else {
      this.stationGroup.remove();
    }
  };

  /** 화면 안 역만 라벨을 만들고, 환승역부터 자리를 잡아 겹치는 라벨은 건너뛴다. */
  private readonly updateLabels = () => {
    this.labelGroup.clearLayers();
    const zoom = this.map.getZoom();
    if (zoom < LABEL_MIN_ZOOM) return;
    const bounds = this.map.getBounds().pad(0.1);
    const candidates = this.dots
      .filter((d) => bounds.contains([d.station.lat, d.station.lng]))
      .sort((a, b) => b.station.lines.length - a.station.lines.length);
    const placed: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const d of candidates) {
      const radius = dotStyle(zoom, d.transfer).radius;
      const text = `${d.station.name}역`;
      const p = this.map.latLngToContainerPoint([d.station.lat, d.station.lng]);
      const box = { x1: p.x + radius + 2, y1: p.y - 9, x2: p.x + radius + 8 + text.length * 11.5, y2: p.y + 9 };
      if (placed.some((o) => box.x1 < o.x2 && box.x2 > o.x1 && box.y1 < o.y2 && box.y2 > o.y1)) continue;
      placed.push(box);
      const el = document.createElement("span");
      el.className = "map-station";
      el.style.setProperty("--station-offset", `${radius + 3}px`);
      el.textContent = text;
      L.marker([d.station.lat, d.station.lng], {
        pane: PANE.stationLabels,
        icon: L.divIcon({ className: "map-anchor", html: el, iconSize: [0, 0], iconAnchor: [0, 0] }),
        interactive: false,
        keyboard: false,
      }).addTo(this.labelGroup);
    }
  };
}
