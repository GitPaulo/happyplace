import { useState, useRef, useEffect, useCallback } from "react";

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
  type: string;
}

interface SearchBarProps {
  onNavigate: (lat: number, lng: number) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function SearchBar({ onNavigate, placeholder, autoFocus }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 3) { setResults([]); return; }
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, {
        headers: { "User-Agent": "HappyPlace/1.0" },
      });
      if (!res.ok) return;
      const data = await res.json();
      setResults(data);
      setOpen(data.length > 0);
      setActiveIdx(-1);
    } catch { /* ignore */ }
  }, []);

  const handleInput = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val), 300);
  };

  const handleSelect = (r: SearchResult) => {
    setQuery(r.display_name.split(",").slice(0, 2).join(","));
    setResults([]);
    setOpen(false);
    onNavigate(parseFloat(r.lat), parseFloat(r.lon));
    inputRef.current?.blur();
  };

  const triggerSearch = async () => {
    if (query.length < 3) return;
    if (open && results.length > 0) {
      handleSelect(results[activeIdx >= 0 ? activeIdx : 0]);
      return;
    }
    await search(query);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && results.length > 0 && activeIdx >= 0) {
        handleSelect(results[activeIdx]);
      } else {
        triggerSearch();
      }
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    }
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="search-container" ref={containerRef}>
      <div className="search-input-row">
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          placeholder={placeholder ?? "search location..."}
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => { if (results.length > 0) setOpen(true); }}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoFocus={autoFocus}
        />
        <button className="search-btn" onClick={triggerSearch} title="Search">
          {"\u2192"}
        </button>
      </div>
      {open && results.length > 0 && (
        <div className="search-dropdown">
          {results.map((r, i) => (
            <div
              key={`${r.lat}-${r.lon}`}
              className={`search-result ${i === activeIdx ? "active" : ""}`}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseDown={() => handleSelect(r)}
            >
              <span className="search-result-name">
                {r.display_name.split(",").slice(0, 2).join(",")}
              </span>
              <span className="search-result-detail">
                {r.display_name.split(",").slice(2, 4).join(",").trim()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
