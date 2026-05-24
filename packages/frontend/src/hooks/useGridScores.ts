import { useCallback, useEffect, useRef, useState } from "react";
import type { CellScore, GridCell, SourceScore } from "@happyplace/shared";
import type { SourceCategory } from "@happyplace/shared";
import { generateGrid } from "@happyplace/shared";
import type { SourceStreamEvent } from "../scoring/engine";

interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface AmenityPoint {
  lat: number;
  lng: number;
  type: string;
}

export interface MapAmenityPoint extends AmenityPoint {
  sourceId: string;
}

let nextId = 0;

export function useGridScores(weights: Record<string, number>, hasCar: boolean) {
  const [cells, setCells] = useState<CellScore[]>([]);
  const [sources, setSources] = useState<
    { id: string; name: string; weight: number; category: SourceCategory }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [amenityPoints, setAmenityPoints] = useState<MapAmenityPoint[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accumRef = useRef<Map<string, SourceStreamEvent>>(new Map());
  const pointsAccumRef = useRef<MapAmenityPoint[]>([]);
  const activeIdRef = useRef(-1);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(
      new URL("../scoring/worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const recompute = useCallback(
    (gridCells: GridCell[]) => {
      const accum = accumRef.current;
      if (accum.size === 0) return;

      const result: CellScore[] = gridCells.map((cell) => {
        let totalWeighted = 0;
        let totalWeight = 0;
        const breakdown: SourceScore[] = [];

        for (const sd of accum.values()) {
          const cs = sd.cells[cell.id];
          if (!cs) continue;
          let w = weights[sd.sourceId] ?? sd.weight;
          if (sd.weightMode === "penalty") {
            w *= 1 - 0.8 * (cs.score / 100);
          }
          totalWeighted += cs.score * w;
          totalWeight += w;
          breakdown.push({
            sourceId: sd.sourceId,
            sourceName: sd.sourceName,
            score: cs.score,
            details: cs.details,
            hasData: cs.hasData,
            category: sd.category,
          });
        }

        return {
          cell,
          score: totalWeight > 0
            ? Math.round((totalWeighted / totalWeight) * 10) / 10
            : 0,
          breakdown,
        };
      });

      setCells(result);
    },
    [weights],
  );

  const fetch_ = useCallback(
    (bounds: Bounds) => {
      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = setTimeout(() => {
        const worker = workerRef.current;
        if (!worker) return;

        const id = ++nextId;
        activeIdRef.current = id;

        accumRef.current = new Map();
        pointsAccumRef.current = [];
        setLoading(true);
        setAmenityPoints([]);

        const gridCells = generateGrid(bounds);

        worker.onmessage = (e: MessageEvent) => {
          if (e.data.id !== id) return;

          if (e.data.type === "source") {
            const event = e.data.event as SourceStreamEvent;
            accumRef.current.set(event.sourceId, event);

            if (event.points && event.points.length > 0) {
              const tagged = event.points.map((p) => ({
                ...p,
                sourceId: event.sourceId,
              }));
              pointsAccumRef.current = [...pointsAccumRef.current, ...tagged];
              setAmenityPoints([...pointsAccumRef.current]);
            }

            setSources((prev) => {
              const has = prev.some((s) => s.id === event.sourceId);
              if (has) return prev;
              return [
                ...prev,
                {
                  id: event.sourceId,
                  name: event.sourceName,
                  weight: event.weight,
                  category: event.category,
                },
              ];
            });

            recompute(gridCells);
          }

          if (e.data.type === "done" || e.data.type === "error") {
            if (e.data.type === "error") {
              console.error("Worker scoring error:", e.data.error);
            }
            setLoading(false);
          }
        };

        worker.postMessage({
          type: "compute",
          id,
          bounds,
          weights,
          ctx: { hasCar },
        });
      }, 500);
    },
    [weights, hasCar, recompute],
  );

  return { cells, sources, loading, amenityPoints, fetchForBounds: fetch_ };
}
