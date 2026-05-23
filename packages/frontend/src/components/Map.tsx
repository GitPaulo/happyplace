import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CellScore, GridCell, ScoresResponse } from "@happyplace/shared";
import { generateGrid } from "@happyplace/shared";
import { useGridScores } from "../hooks/useGridScores";
import { scoreToColor } from "../utils/colors";
import { amenityMarkerHtml } from "../utils/amenityIcons";

export interface MapHandle {
  flyTo: (lat: number, lng: number) => void;
}

interface MapProps {
  onCellClick: (cell: CellScore) => void;
  onLoadingChange: (loading: boolean) => void;
  onSourcesChange: (sources: ScoresResponse["sources"]) => void;
  weights: Record<string, number>;
  hasCar: boolean;
  panelOpen: boolean;
}

function cellHasPartialData(cellScore: CellScore): boolean {
  return cellScore.breakdown.some((b) => !b.hasData);
}

function injectShimmerDefs(map: L.Map) {
  const container = (map as any)._renderer?._container as SVGElement | undefined;
  if (!container) return;
  if (container.querySelector("#shimmer-gradient")) return;

  const ns = "http://www.w3.org/2000/svg";
  const defs = document.createElementNS(ns, "defs");

  const grad = document.createElementNS(ns, "linearGradient");
  grad.setAttribute("id", "shimmer-gradient");
  grad.setAttribute("x1", "0%");
  grad.setAttribute("y1", "0%");
  grad.setAttribute("x2", "100%");
  grad.setAttribute("y2", "100%");
  grad.setAttribute("gradientUnits", "objectBoundingBox");

  const stops = [
    { offset: "0%", color: "#111" },
    { offset: "40%", color: "#111" },
    { offset: "50%", color: "#2a2a2a" },
    { offset: "60%", color: "#111" },
    { offset: "100%", color: "#111" },
  ];
  for (const s of stops) {
    const stop = document.createElementNS(ns, "stop");
    stop.setAttribute("offset", s.offset);
    stop.setAttribute("stop-color", s.color);
    grad.appendChild(stop);
  }

  const anim = document.createElementNS(ns, "animate");
  anim.setAttribute("attributeName", "x1");
  anim.setAttribute("values", "-100%;100%");
  anim.setAttribute("dur", "1.5s");
  anim.setAttribute("repeatCount", "indefinite");
  grad.appendChild(anim);

  const anim2 = document.createElementNS(ns, "animate");
  anim2.setAttribute("attributeName", "x2");
  anim2.setAttribute("values", "0%;200%");
  anim2.setAttribute("dur", "1.5s");
  anim2.setAttribute("repeatCount", "indefinite");
  grad.appendChild(anim2);

  defs.appendChild(grad);
  container.insertBefore(defs, container.firstChild);
}

const PANEL_WIDTH = 360;

export const Map = forwardRef<MapHandle, MapProps>(function Map({ onCellClick, onLoadingChange, onSourcesChange, weights, hasCar, panelOpen }, ref) {
  const mapRef = useRef<L.Map | null>(null);
  const gridLayerRef = useRef<L.LayerGroup | null>(null);
  const scoreLayerRef = useRef<L.LayerGroup | null>(null);
  const shimmerLayerRef = useRef<L.LayerGroup | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const amenityLayerRef = useRef<L.LayerGroup | null>(null);
  const zoomControlRef = useRef<L.Control.Zoom | null>(null);
  const selectedRef = useRef<L.Rectangle | null>(null);
  const scoredBoundsRef = useRef<{ south: number; west: number; north: number; east: number }[]>([]);
  const loadingRef = useRef(false);
  const { cells, sources, loading, amenityPoints, fetchForBounds } = useGridScores(weights, hasCar);

  loadingRef.current = loading;

  useImperativeHandle(ref, () => ({
    flyTo(lat: number, lng: number) {
      mapRef.current?.flyTo([lat, lng], 14, { duration: 1.5 });
    },
  }));

  useEffect(() => {
    onLoadingChange(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    if (sources.length > 0) onSourcesChange(sources);
  }, [sources, onSourcesChange]);

  const redrawShimmer = useCallback((map: L.Map) => {
    const layer = shimmerLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    injectShimmerDefs(map);

    const b = map.getBounds();
    const gridCells = generateGrid({
      north: b.getNorth(),
      south: b.getSouth(),
      east: b.getEast(),
      west: b.getWest(),
    });

    const scored = scoredBoundsRef.current;
    const isLoading = loadingRef.current;

    gridCells.forEach((cell: GridCell) => {
      const covered = scored.some(
        (s) => cell.centerLat > s.south && cell.centerLat < s.north &&
               cell.centerLng > s.west && cell.centerLng < s.east
      );

      if (!covered) {
        // No data yet - full shimmer
        L.rectangle(
          [[cell.south, cell.west], [cell.north, cell.east]],
          {
            color: "#1a1a1a",
            weight: 1,
            fillColor: "#0a0a0a",
            fillOpacity: 0.6,
            interactive: false,
            className: "cell-loading",
          }
        ).addTo(layer);
      } else if (isLoading) {
        // Has partial data but still loading more sources - light shimmer overlay
        L.rectangle(
          [[cell.south, cell.west], [cell.north, cell.east]],
          {
            color: "transparent",
            weight: 0,
            fillColor: "#0a0a0a",
            fillOpacity: 0.25,
            interactive: false,
            className: "cell-loading",
          }
        ).addTo(layer);
      }
    });
  }, []);

  const drawBaseGrid = useCallback((map: L.Map) => {
    const layer = gridLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    const b = map.getBounds();
    const gridCells = generateGrid({
      north: b.getNorth(),
      south: b.getSouth(),
      east: b.getEast(),
      west: b.getWest(),
    });

    gridCells.forEach((cell: GridCell) => {
      L.rectangle(
        [[cell.south, cell.west], [cell.north, cell.east]],
        {
          color: "#1a1a1a",
          fillColor: "transparent",
          fillOpacity: 0,
          weight: 1,
          interactive: false,
        }
      ).addTo(layer);
    });
  }, []);

  useEffect(() => {
    if (mapRef.current) return;

    const map = L.map("map", {
      center: [48.8566, 2.3522],
      zoom: 12,
      zoomControl: false,
    });

    L.tileLayer(
      "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: "abcd",
        maxZoom: 19,
      }
    ).addTo(map);

    const zoomCtrl = L.control.zoom({ position: "bottomright" });
    zoomCtrl.addTo(map);
    zoomControlRef.current = zoomCtrl;

    // Layer order: base grid → scores → shimmer overlay → warning markers → amenity icons
    gridLayerRef.current = L.layerGroup().addTo(map);
    scoreLayerRef.current = L.layerGroup().addTo(map);
    shimmerLayerRef.current = L.layerGroup().addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);
    amenityLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const onMove = () => {
      drawBaseGrid(map);
      redrawShimmer(map);
      redrawAmenities();
      const b = map.getBounds();
      fetchForBounds({
        north: b.getNorth(),
        south: b.getSouth(),
        east: b.getEast(),
        west: b.getWest(),
      });
    };

    map.on("moveend", onMove);
    drawBaseGrid(map);
    redrawShimmer(map);
    onMove();

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!mapRef.current) return;
    const b = mapRef.current.getBounds();
    fetchForBounds({
      north: b.getNorth(),
      south: b.getSouth(),
      east: b.getEast(),
      west: b.getWest(),
    });
  }, [weights, fetchForBounds]);

  const onCellClickRef = useRef(onCellClick);
  onCellClickRef.current = onCellClick;

  // Re-render scored cells when score data arrives
  useEffect(() => {
    const scoreLayer = scoreLayerRef.current;
    const markerLayer = markerLayerRef.current;
    if (!scoreLayer || !markerLayer || !mapRef.current) return;
    scoreLayer.clearLayers();
    markerLayer.clearLayers();

    scoredBoundsRef.current = cells.map((cs) => ({
      south: cs.cell.south,
      west: cs.cell.west,
      north: cs.cell.north,
      east: cs.cell.east,
    }));

    cells.forEach((cellScore) => {
      const { cell, score } = cellScore;
      const color = scoreToColor(score);
      const partial = cellHasPartialData(cellScore);

      const rect = L.rectangle(
        [[cell.south, cell.west], [cell.north, cell.east]],
        {
          color: "#1a1a1a",
          fillColor: color,
          fillOpacity: 0.45,
          weight: 1,
        }
      );

      rect.on("mouseover", () => {
        rect.setStyle({ weight: 2, color: "rgba(255,255,255,0.5)" });
      });
      rect.on("mouseout", () => {
        if (selectedRef.current !== rect) {
          rect.setStyle({ weight: 1, color: "#1a1a1a" });
        }
      });
      rect.on("click", () => {
        if (selectedRef.current && selectedRef.current !== rect) {
          selectedRef.current.setStyle({ weight: 1, color: "#1a1a1a" });
        }
        rect.setStyle({ weight: 2, color: "rgba(255,255,255,0.6)" });
        selectedRef.current = rect;
        onCellClickRef.current(cellScore);
      });

      rect.addTo(scoreLayer);

      if (partial) {
        const icon = L.divIcon({
          className: "",
          html: `<div style="color:#ff8800;font-size:10px;font-family:'Fira Code',monospace;text-shadow:0 0 2px #000,0 0 4px #000;">!</div>`,
          iconSize: [12, 12],
          iconAnchor: [0, 0],
        });
        L.marker([cell.north, cell.west], { icon, interactive: false }).addTo(markerLayer);
      }
    });

    redrawShimmer(mapRef.current);
  }, [cells, redrawShimmer]);

  // Update shimmer when loading state changes (clear overlay when done)
  useEffect(() => {
    if (!mapRef.current) return;
    redrawShimmer(mapRef.current);
  }, [loading, redrawShimmer]);

  // Shift Leaflet bottom-right controls when panel opens/closes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const wrapper = map.getContainer().querySelector<HTMLElement>(".leaflet-right.leaflet-bottom");
    if (!wrapper) return;
    wrapper.style.transition = "right 0.25s ease-out";
    wrapper.style.right = panelOpen ? `${PANEL_WIDTH}px` : "0px";
  }, [panelOpen]);

  // Prevent browser zoom (Ctrl+scroll, Ctrl+/-, pinch) so only the map zooms
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    const onKeydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "-" || e.key === "=" || e.key === "0")) {
        e.preventDefault();
      }
    };
    document.addEventListener("wheel", onWheel, { passive: false });
    document.addEventListener("keydown", onKeydown);
    return () => {
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("keydown", onKeydown);
    };
  }, []);

  // Render amenity icons (only at zoom >= 15 to avoid clutter)
  const redrawAmenities = useCallback(() => {
    const layer = amenityLayerRef.current;
    const map = mapRef.current;
    if (!layer || !map) return;
    layer.clearLayers();

    if (map.getZoom() < 15) return;

    const b = map.getBounds();
    for (const point of amenityPointsRef.current) {
      if (point.lat < b.getSouth() || point.lat > b.getNorth() ||
          point.lng < b.getWest() || point.lng > b.getEast()) continue;

      const icon = L.divIcon({
        className: "amenity-marker",
        html: amenityMarkerHtml(point.sourceId),
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      L.marker([point.lat, point.lng], { icon, interactive: false }).addTo(layer);
    }
  }, []);

  const amenityPointsRef = useRef(amenityPoints);
  amenityPointsRef.current = amenityPoints;

  useEffect(() => {
    redrawAmenities();
  }, [amenityPoints, redrawAmenities]);

  return <div id="map" style={{ width: "100%", height: "100%" }} />;
});
