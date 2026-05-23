import { Router } from "express";
import type { BoundingBox } from "@happyplace/shared";
import { scoringEngine } from "../scoring.js";
import { getCacheStats } from "../cache.js";

export const scoresRouter = Router();

scoresRouter.get("/cache/stats", (_req, res) => {
  res.json(getCacheStats());
});

scoresRouter.get("/scores", async (req, res) => {
  const { north, south, east, west, hasCar } = req.query;

  if (!north || !south || !east || !west) {
    res.status(400).json({ error: "Missing bounding box parameters" });
    return;
  }

  const bounds: BoundingBox = {
    north: parseFloat(north as string),
    south: parseFloat(south as string),
    east: parseFloat(east as string),
    west: parseFloat(west as string),
  };

  const weights: Record<string, number> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (key.startsWith("w_") && value) {
      weights[key.slice(2)] = parseFloat(value as string);
    }
  }

  const ctx = { hasCar: hasCar === "true" };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  let aborted = false;
  req.on("close", () => { aborted = true; });

  try {
    await scoringEngine.computeScoresStream(bounds, weights, ctx, (event) => {
      if (aborted) return;
      res.write(`event: source\ndata: ${JSON.stringify(event)}\n\n`);
    });

    if (!aborted) {
      res.write(`event: done\ndata: {}\n\n`);
    }
  } catch (err) {
    console.error("Scoring error:", err);
    if (!aborted) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: "Failed to compute scores" })}\n\n`);
    }
  }

  res.end();
});
