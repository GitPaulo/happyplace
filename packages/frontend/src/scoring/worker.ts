import type { BoundingBox, ScoringContext } from "@happyplace/shared";
import { scoringEngine, type SourceStreamEvent } from "./engine";

interface ComputeMessage {
  type: "compute";
  id: number;
  bounds: BoundingBox;
  weights: Record<string, number>;
  ctx: ScoringContext;
}

interface AbortMessage {
  type: "abort";
  id: number;
}

type InMessage = ComputeMessage | AbortMessage;

let activeId = -1;

self.onmessage = async (e: MessageEvent<InMessage>) => {
  const msg = e.data;

  if (msg.type === "abort") {
    activeId = -1;
    return;
  }

  if (msg.type === "compute") {
    activeId = msg.id;

    try {
      await scoringEngine.computeScores(
        msg.bounds,
        msg.weights,
        msg.ctx,
        (event: SourceStreamEvent) => {
          if (activeId !== msg.id) return;
          self.postMessage({ type: "source", id: msg.id, event });
        },
      );
    } catch (err) {
      if (activeId !== msg.id) return;
      self.postMessage({ type: "error", id: msg.id, error: String(err) });
    }

    if (activeId === msg.id) {
      self.postMessage({ type: "done", id: msg.id });
    }
  }
};
