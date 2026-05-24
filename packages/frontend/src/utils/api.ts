import type { SourceCategory } from "@happyplace/shared";

export interface AmenityPoint {
  lat: number;
  lng: number;
  type: string;
}

export interface SourceStreamEvent {
  sourceId: string;
  sourceName: string;
  category: SourceCategory;
  weight: number;
  weightMode?: "default" | "penalty";
  cells: Record<string, { score: number; details: string; hasData: boolean }>;
  points?: AmenityPoint[];
}

export async function streamScores(
  bounds: { north: number; south: number; east: number; west: number },
  weights: Record<string, number>,
  hasCar: boolean,
  onSource: (event: SourceStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const params = new URLSearchParams({
    north: bounds.north.toString(),
    south: bounds.south.toString(),
    east: bounds.east.toString(),
    west: bounds.west.toString(),
    hasCar: hasCar.toString(),
  });

  for (const [id, w] of Object.entries(weights)) {
    params.set(`w_${id}`, w.toString());
  }

  const res = await fetch(`/api/scores?${params}`, { signal });
  if (!res.ok || !res.body) {
    throw new Error(`API error: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE: lines separated by \n, events separated by \n\n
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      let eventType = "";
      let data = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event: ")) eventType = line.slice(7).trim();
        else if (line.startsWith("data: ")) data = line.slice(6);
      }
      if (eventType === "source" && data) {
        onSource(JSON.parse(data));
      }
    }
  }
}
