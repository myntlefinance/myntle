/**
 * Minimal TinyFish Fetch API client.
 *
 * No SDK install required. One POST with `X-API-Key`, markdown out.
 * Free to 1,000 URLs/day, then wallet billing. TinyFish rejects private
 * IPs, localhost, and cloud metadata before fetching.
 */

export type FetchedPage = {
  title: string | null;
  text: string;
  finalUrl: string;
  publishedDate: string | null;
};

export type PageFetchFailure = {
  url: string;
  error: string;
};

export type FetchedPages = {
  pages: FetchedPage[];
  failures: PageFetchFailure[];
};

/** One get_page_content call reads at most this many URLs in parallel. */
export const MAX_PARALLEL_PAGES = 8;

const FETCH_BASE =
  process.env.TINYFISH_FETCH_BASE_URL ?? "https://api.fetch.tinyfish.ai";

const DEFAULT_TIMEOUT_MS = 25000;
export const MAX_PAGE_CHARS = 8000;

function getApiKey(): string | null {
  return process.env.TINYFISH_API_KEY?.trim() || null;
}

type FetchApiResult = {
  url: string;
  final_url?: string;
  title?: string | null;
  published_date?: string | null;
  text?: string | null;
};

type FetchApiResponse = {
  results?: FetchApiResult[];
  errors?: { url: string; error: string }[];
};

function parseHttpsUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("INVALID_URL: pass https URLs only.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("INVALID_URL: only https URLs are fetched.");
  }
  return parsed;
}

function toFetchedPage(
  page: FetchApiResult,
  fallbackUrl: string,
  maxChars: number,
): FetchedPage | null {
  const text = typeof page?.text === "string" ? page.text.trim() : "";
  if (text.length === 0) return null;
  return {
    title: page.title ?? null,
    text: text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text,
    finalUrl: page.final_url ?? fallbackUrl,
    publishedDate: page.published_date ?? null,
  };
}

/**
 * Fetch up to MAX_PARALLEL_PAGES URLs with a single POST. TinyFish reads
 * the batch server-side, so one round trip replaces up to eight sequential
 * calls. A URL that fails is reported in `failures` and never sinks the
 * URLs that succeeded.
 */
export async function fetchPagesContent(
  urls: string[],
  opts: { timeoutMs?: number; maxChars?: number } = {},
): Promise<FetchedPages> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("TINYFISH_MISSING_KEY: set TINYFISH_API_KEY.");
  if (urls.length === 0) {
    throw new Error("INVALID_URL: pass at least one https URL.");
  }
  if (urls.length > MAX_PARALLEL_PAGES) {
    throw new Error(
      `INVALID_URL: at most ${MAX_PARALLEL_PAGES} URLs per call.`,
    );
  }

  const parsed = urls.map((url) => parseHttpsUrl(url).toString());

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxChars = Math.min(opts.maxChars ?? 6000, MAX_PAGE_CHARS);

  const response = await fetch(FETCH_BASE, {
    method: "POST",
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      urls: parsed,
      format: "markdown",
      ttl: 0,
      per_url_timeout_ms: Math.min(timeoutMs, 110000),
    }),
    // The per-URL budget applies server-side; the outer abort only needs
    // headroom for each extra URL in the batch.
    signal: AbortSignal.timeout(
      Math.min(timeoutMs, 110000) + 10000 + (parsed.length - 1) * 5000,
    ),
  });

  if (response.status === 401) {
    throw new Error("TINYFISH_UNAUTHORIZED: API key is missing or invalid.");
  }
  if (response.status === 402) {
    throw new Error(
      "TINYFISH_ALLOWANCE_EXHAUSTED: daily allowance used and wallet is empty.",
    );
  }
  if (response.status === 429) {
    throw new Error("TINYFISH_RATE_LIMITED: retry with backoff.");
  }
  if (!response.ok) {
    throw new Error(`TINYFISH_BAD_RESPONSE: HTTP ${response.status}.`);
  }

  const body = (await response.json()) as FetchApiResponse;
  const failures: PageFetchFailure[] = (body.errors ?? []).map((entry) => ({
    url: entry.url,
    error: entry.error.slice(0, 200),
  }));
  // TinyFish echoes our URLs back, but not always byte-identical
  // (trailing slashes), so match on the normalized form.
  const norm = (u: string) => {
    try {
      return new URL(u).toString();
    } catch {
      return u;
    }
  };
  const byUrl = new Map<string, FetchApiResult>();
  for (const result of body.results ?? []) byUrl.set(norm(result.url), result);
  const failureSeen = new Set(failures.map((failure) => norm(failure.url)));

  // Walk the requested URLs in order so successes stay aligned with input.
  const pages: FetchedPage[] = [];
  for (const requested of parsed) {
    const result = byUrl.get(norm(requested));
    const page = result ? toFetchedPage(result, requested, maxChars) : null;
    if (page) {
      pages.push(page);
      continue;
    }
    if (!failureSeen.has(norm(requested))) {
      failureSeen.add(norm(requested));
      failures.push({
        url: requested,
        error: "TINYFISH_PAGE_ERROR: empty_content",
      });
    }
  }

  return { pages, failures };
}

export async function fetchPageContent(
  url: string,
  opts: { timeoutMs?: number; maxChars?: number } = {},
): Promise<FetchedPage> {
  const { pages, failures } = await fetchPagesContent([url], opts);
  const page = pages[0];
  if (page) return page;
  const reason = failures[0]?.error ?? "empty_content";
  throw new Error(
    reason.startsWith("TINYFISH_PAGE_ERROR")
      ? reason
      : `TINYFISH_PAGE_ERROR: ${reason}`.slice(0, 200),
  );
}
