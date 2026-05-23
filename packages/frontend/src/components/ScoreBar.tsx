import { scoreToColor } from "../utils/colors";

interface ScoreBarProps {
  label: string;
  iconHtml: string;
  score: number;
  details: string;
  hasData: boolean;
}

export function ScoreBar({ label, iconHtml, score, details, hasData }: ScoreBarProps) {
  const color = hasData ? scoreToColor(score) : "#555";

  return (
    <div className="score-bar-item">
      <div className="score-bar-header">
        <span
          className="score-bar-icon"
          dangerouslySetInnerHTML={{ __html: iconHtml }}
        />
        <span className="score-bar-label">
          {label}
          {!hasData && <span style={{ color: "#ff8800", marginLeft: 4 }}>!</span>}
        </span>
        <span className="score-bar-value" style={{ color }}>
          {hasData ? Math.round(score) : "--"}
        </span>
      </div>
      <div className="score-bar-track">
        <div
          className="score-bar-fill"
          style={{
            width: hasData ? `${score}%` : "0%",
            backgroundColor: color,
          }}
        />
      </div>
      <div className={`score-bar-details ${!hasData ? "score-bar-no-data" : ""}`}>
        {details}
      </div>
    </div>
  );
}
