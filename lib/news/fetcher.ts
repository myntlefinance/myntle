/**
 * Prepaid fetcher.sh client (Google News + Reddit).
 *
 * No SDK, no x402 signing in the server. Every call is a plain GET with
 * `Authorization: Bearer <FETCHER_API_KEY>`. The key is topped up once at
 * https://fetcher.sh/topup and reused; the balance is the only rate limit.
 *
 * Costs: Google News search $0.005, Reddit search $0.002 per call.
 * Upstream payloads arrive untouched inside `data`, so normalization below
 * is defensive by design — fetcher does not publish a response schema.
 */

export type NewsSource = "google-news" | "reddit" | "x";

export type NormalizedNewsItem = {
  title: string;
  snippet: string;
  url: string;
  source: NewsSource;
  publisher: string | null;
  publishedAt: string | null;
};

type FetcherEnvelope<T = unknown> = {
  status: number;
  message: string;
  data: T;
};

const GOOGLE_NEWS_BASE =
  process.env.FETCHER_GOOGLE_NEWS_BASE_URL ??
  "https://google-news.fetcher.sh";
const REDDIT_BASE =
  process.env.FETCHER_REDDIT_BASE_URL ?? "https://reddit.fetcher.sh";

const DEFAULT_TIMEOUT_MS = 8000;

function getApiKey(): string | null {
  return process.env.FETCHER_API_KEY?.trim() || null;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1)}…`;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function pickFirst(...values: unknown[]): string | null {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return null;
}

function pickUrl(record: Record<string, unknown>): string | null {
  const url = pickFirst(
    record.url,
    record.link,
    record.articleUrl,
    record.article_url,
    record.permalink,
  );
  if (!url) return null;
  // The Reddit upstream returns relative paths ("/r/..."). Resolve them so
  // downstream readers (e.g. the page-content tool, which requires https)
  // receive a usable link.
  if (url.startsWith("/")) return `https://www.reddit.com${url}`;
  return url;
}

function pickPublisher(record: Record<string, unknown>): string | null {
  const direct = pickFirst(record.publisher, record.source, record.site_name);
  if (direct) return direct;
  // The Reddit upstream nests these as objects ({ name } / { username }).
  const subName = asString(asObject(record.subreddit)?.name);
  if (subName) return subName.startsWith("r/") ? subName : `r/${subName}`;
  if (asString(record.subreddit)) return asString(record.subreddit);
  const username = asString(asObject(record.author)?.username);
  if (username) return `u/${username}`;
  return asString(record.author);
}

function pickPublishedAt(record: Record<string, unknown>): string | null {
  const direct = pickFirst(
    record.publishedAt,
    record.published_date,
    record.date,
    record.datetime,
    record.created_at,
    record.createdAt,
  );
  if (direct) return direct;
  // The Reddit upstream reports `created` as unix seconds (a number, not a
  // string), which the string-only check above rejects.
  const created = record.created;
  if (typeof created === "number" && Number.isFinite(created) && created > 0) {
    const date = new Date(created > 1e12 ? created : created * 1000);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return null;
}

/** Extract a list of raw records from an undocumented upstream payload. */
function toRecordList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null,
    );
  }
  if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    for (const key of [
      "articles",
      "results",
      "items",
      "posts",
      "news",
      "data",
    ]) {
      const nested = record[key];
      if (Array.isArray(nested)) {
        return nested.filter(
          (entry): entry is Record<string, unknown> =>
            typeof entry === "object" && entry !== null,
        );
      }
    }
  }
  return [];
}

function normalizeRecord(
  record: Record<string, unknown>,
  source: NewsSource,
): NormalizedNewsItem | null {
  const title = pickFirst(
    record.title,
    record.headline,
    record.name,
    record.text,
  );
  const url = pickUrl(record);
  if (!title || !url) return null;

  const snippet =
    pickFirst(
      record.snippet,
      record.description,
      record.summary,
      record.selftext,
      record.text,
      record.body,
      record.excerpt,
    ) ?? "";
  const publisher = pickPublisher(record);
  const publishedAt = pickPublishedAt(record);

  return {
    title: truncate(title, 180),
    snippet: truncate(snippet, 400),
    url,
    source,
    publisher,
    publishedAt,
  };
}

async function fetcherGet<T>(
  url: string,
  apiKey: string,
  timeoutMs: number,
): Promise<FetcherEnvelope<T>> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (response.status === 401) {
    throw new Error("FETCHER_UNAUTHORIZED: API key is unknown or rotated.");
  }
  if (response.status === 402) {
    throw new Error(
      "FETCHER_TOPUP_REQUIRED: prepaid balance cannot cover this call.",
    );
  }
  if (response.status === 404) {
    throw new Error("FETCHER_NOT_FOUND: path is not a priced endpoint.");
  }

  let envelope: FetcherEnvelope<T>;
  try {
    envelope = (await response.json()) as FetcherEnvelope<T>;
  } catch {
    throw new Error(`FETCHER_BAD_RESPONSE: HTTP ${response.status}.`);
  }

  if (!response.ok || envelope.status !== 200) {
    // 502 means the upstream source failed and is not refunded. The caller
    // treats it as "this source is down, use the other one".
    throw new Error(
      `FETCHER_UPSTREAM: ${envelope.message || `HTTP ${response.status}`}`.slice(
        0,
        200,
      ),
    );
  }
  return envelope;
}

export async function searchGoogleNews(
  keyword: string,
  opts: { languageCode?: string; timeoutMs?: number } = {},
): Promise<NormalizedNewsItem[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("FETCHER_MISSING_KEY: set FETCHER_API_KEY.");
  const params = new URLSearchParams({
    keyword,
    languageCode: opts.languageCode ?? "US:en",
  });
  const envelope = await fetcherGet<unknown>(
    `${GOOGLE_NEWS_BASE}/api/search?${params.toString()}`,
    apiKey,
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  return toRecordList(envelope.data)
    .map((record) => normalizeRecord(record, "google-news"))
    .filter((item): item is NormalizedNewsItem => item !== null);
}

export async function searchRedditPosts(
  keyword: string,
  opts: { sort?: string; timeoutMs?: number } = {},
): Promise<NormalizedNewsItem[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("FETCHER_MISSING_KEY: set FETCHER_API_KEY.");
  const params = new URLSearchParams({
    keyword,
    sort: opts.sort ?? "hot",
  });
  const envelope = await fetcherGet<unknown>(
    `${REDDIT_BASE}/api/search/post?${params.toString()}`,
    apiKey,
    opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  return toRecordList(envelope.data)
    .map((record) => normalizeRecord(record, "reddit"))
    .filter((item): item is NormalizedNewsItem => item !== null);
}

export async function getFetcherBalance(): Promise<{
  balanceUsd: number | null;
} | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const response = await fetch(`${GOOGLE_NEWS_BASE}/api/credits/balance`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      data?: { balance_usd?: number };
    };
    return {
      balanceUsd:
        typeof body.data?.balance_usd === "number"
          ? body.data.balance_usd
          : null,
    };
  } catch {
    return null;
  }
}
