const USER_AGENT = "HappyPlace/1.0 (livability score aggregator)";

export interface ResilientFetchOptions {
  /** Maximum number of attempts (default 3) */
  maxRetries?: number;
  /** Base timeout in ms for the request (default 15000) */
  timeoutMs?: number;
  /** Initial backoff delay in ms before first retry (default 1000) */
  baseDelayMs?: number;
  /** Extra headers to send */
  headers?: Record<string, string>;
  /** Label for logging (e.g. "[crime]") */
  label?: string;
}

const DEFAULT_OPTIONS: Required<Omit<ResilientFetchOptions, "headers" | "label">> = {
  maxRetries: 3,
  timeoutMs: 15000,
  baseDelayMs: 1000,
};

/**
 * Fetch with automatic retries, exponential backoff, Retry-After support,
 * and rate-limit awareness. Returns null on exhausted retries instead of throwing.
 */
export async function resilientFetch(
  url: string,
  opts: ResilientFetchOptions = {},
): Promise<Response | null> {
  const maxRetries = opts.maxRetries ?? DEFAULT_OPTIONS.maxRetries;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs;
  const baseDelay = opts.baseDelayMs ?? DEFAULT_OPTIONS.baseDelayMs;
  const label = opts.label ?? "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          ...(opts.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (res.ok) return res;

      // Rate limited
      if (res.status === 429 || res.status === 503) {
        const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
        const delay = retryAfter ?? baseDelay * Math.pow(2, attempt);

        if (attempt < maxRetries) {
          console.warn(
            `${label} ${res.status} on attempt ${attempt + 1}/${maxRetries + 1}, ` +
            `retrying in ${Math.round(delay / 1000)}s...`
          );
          await sleep(delay);
          continue;
        }
      }

      // Server errors worth retrying
      if (res.status >= 500 && attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(
          `${label} HTTP ${res.status} on attempt ${attempt + 1}/${maxRetries + 1}, ` +
          `retrying in ${Math.round(delay / 1000)}s...`
        );
        await sleep(delay);
        continue;
      }

      // Client error (4xx) or final attempt — don't retry
      console.warn(`${label} HTTP ${res.status} for ${url.substring(0, 120)}`);
      return res;
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      const isTimeout = msg.includes("TimeoutError") || msg.includes("aborted");

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(
          `${label} ${isTimeout ? "timeout" : "error"} on attempt ${attempt + 1}/${maxRetries + 1} ` +
          `(${msg.substring(0, 80)}), retrying in ${Math.round(delay / 1000)}s...`
        );
        await sleep(delay);
        continue;
      }

      console.warn(`${label} failed after ${maxRetries + 1} attempts: ${msg.substring(0, 120)}`);
      return null;
    }
  }

  return null;
}

/**
 * Convenience: fetch + parse JSON with retries. Returns null if the request fails
 * or the response is non-OK.
 */
export async function resilientJson<T = any>(
  url: string,
  opts: ResilientFetchOptions = {},
): Promise<T | null> {
  const res = await resilientFetch(url, opts);
  if (!res || !res.ok) return null;
  try {
    return await res.json() as T;
  } catch {
    console.warn(`${opts.label ?? ""} JSON parse error for ${url.substring(0, 120)}`);
    return null;
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = parseInt(header, 10);
  if (!isNaN(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  if (!isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
