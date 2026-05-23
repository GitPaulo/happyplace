import { useCallback, useRef, useState } from "react";
import type { CellScore, GridCell, SourceScore } from "@happyplace/shared";
import type { SourceCategory } from "@happyplace/shared";
import { generateGrid } from "@happyplace/shared";
import { streamScores, type SourceStreamEvent, type AmenityPoint } from "../utils/api";

interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface MapAmenityPoint extends AmenityPoint {
  sourceId: string;
}

export function useGridScores(weights: Record<string, number>, hasCar: boolean) {
  const [cells, setCells] = useState<CellScore[]>([]);
  const [sources, setSources] = useState<
    { id: string; name: string; weight: number; category: SourceCategory }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [amenityPoints, setAmenityPoints] = useState<MapAmenityPoint[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const accumRef = useRef<Map<string, SourceStreamEvent>>(new Map());
  const pointsAccumRef = useRef<MapAmenityPoint[]>([]);

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
          const w = weights[sd.sourceId] ?? sd.weight;
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

      timerRef.current = setTimeout(async () => {
        if (abortRef.current) abortRef.current.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        accumRef.current = new Map();
        pointsAccumRef.current = [];
        setLoading(true);
        setAmenityPoints([]);

        const gridCells = generateGrid(bounds);

        try {
          await streamScores(
            bounds,
            weights,
            hasCar,
            (event) => {
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
            },
            controller.signal,
          );
        } catch (e) {
          if (!(e instanceof DOMException && e.name === "AbortError")) {
            console.error("Failed to stream scores:", e);
          }
        } finally {
          setLoading(false);
        }
      }, 500);
    },
    [weights, hasCar, recompute],
  );

  return { cells, sources, loading, amenityPoints, fetchForBounds: fetch_ };
}
