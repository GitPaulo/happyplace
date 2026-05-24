import express from "express";
import cors from "cors";
import { scoresRouter } from "./routes/scores.js";
import { startPeriodicRefresh } from "./sources/de/data-refresh.js";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use("/api", scoresRouter);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  startPeriodicRefresh();
});
