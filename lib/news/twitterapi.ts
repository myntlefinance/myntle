/**
 * Minimal twitterapi.io client (X search).
 *
 * One GET with `X-API-Key`, no SDK. Server-only; the key never reaches
 * the browser. Response shapes drift, so normalization below is defensive.
 */

import type { NormalizedNewsItem } from "./fetcher";

const API_BASE =
  process.env.TWITTERAPI_IO_BASE_URL ?? "https://api.twitterapi.io";

const DEFAULT_TIMEOUT_MS = 15000;

function getApiKey(): string | null {
  return process.env.TWITTERAPI_IO_API_KEY?.trim() || null;
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

function pickFirst(...values: unknown[]): string | null {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toTweetList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null,
    );
  }
  if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    for (const key of ["tweets", "results", "items", "data", "list"]) {
      const nested = record[key];
      if (Array.isArray(nested)) {
        return nested.filter(
          (entry): entry is Record<string, unknown> =>
            typeof entry === "object" && entry !== null,
        );
      }
      if (typeof nested === "object" && nested !== null) {
        const inner = nested as Record<string, unknown>;
        for (const innerKey of ["tweets", "results", "items"]) {
          const innerNested = inner[innerKey];
          if (Array.isArray(innerNested)) {
            return innerNested.filter(
              (entry): entry is Record<string, unknown> =>
                typeof entry === "object" && entry !== null,
            );
          }
        }
      }
    }
  }
  return [];
}

function normalizeTweet(record: Record<string, unknown>): NormalizedNewsItem | null {
  const text = pickFirst(record.text, record.fullText, record.content);
  if (!text) return null;

  const id = pickFirst(record.id_str, record.rest_id) ?? String(record.id ?? "");
  const author =
    typeof record.author === "object" && record.author !== null
      ? (record.author as Record<string, unknown>)
      : typeof record.user === "object" && record.user !== null
        ? (record.user as Record<string, unknown>)
        : null;
  const userName =
    pickFirst(record.userName, author?.userName, author?.screen_name) ?? "";
  const url =
    pickFirst(
      record.url,
      record.expanded_url,
      id && userName ? `https://x.com/${userName}/status/${id}` : null,
      id ? `https://x.com/i/status/${id}` : null,
    ) ?? "";
  if (!url) return null;

  const likes = toNumber(record.likeCount ?? record.like_count ?? record.likes);
  const reposts = toNumber(
    record.retweetCount ?? record.retweet_count ?? record.retweets,
  );
  const views = toNumber(record.viewCount ?? record.view_count ?? record.views);
  const stats = [likes !== null ? `${likes} likes` : null,
    reposts !== null ? `${reposts} reposts` : null,
    views !== null ? `${views} views` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // `text` from advanced_search is already the full post (280 chars standard,
  // up to ~4k for Premium). Keep up to 2000 so the model sees the whole post;
  // the card UI shows the first lines and the detail holds the rest.
  // Quoted / retweeted context is appended so a bare "RT" still carries meaning.
  const quoted =
    typeof record.quoted_tweet === "object" && record.quoted_tweet !== null
      ? pickFirst(
          (record.quoted_tweet as Record<string, unknown>).text,
          (record.quoted_tweet as Record<string, unknown>).fullText,
        )
      : null;
  const retweeted =
    typeof record.retweeted_tweet === "object" && record.retweeted_tweet !== null
      ? pickFirst(
          (record.retweeted_tweet as Record<string, unknown>).text,
          (record.retweeted_tweet as Record<string, unknown>).fullText,
        )
      : null;
  const fullText = [
    text,
    quoted ? `Quoting: ${quoted}` : null,
    retweeted ? `Reposting: ${retweeted}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    title: truncate(fullText, 2000),
    snippet: truncate(
      userName && stats ? `@${userName} · ${stats}` : userName ? `@${userName}` : stats,
      400,
    ),
    url,
    source: "x",
    publisher: userName ? `@${userName}` : null,
    publishedAt: pickFirst(
      record.createdAt,
      record.created_at,
      record.date,
      record.datetime,
    ),
  };
}

export type XPage = {
  items: NormalizedNewsItem[];
  nextCursor: string | null;
  hasNextPage: boolean;
};

function pageInfo(body: unknown): { nextCursor: string | null; hasNextPage: boolean } {
  const record =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const nextCursor =
    typeof record.next_cursor === "string" && record.next_cursor.length > 0
      ? record.next_cursor
      : typeof record.nextCursor === "string" && record.nextCursor.length > 0
        ? (record.nextCursor as string)
        : null;
  return {
    nextCursor,
    hasNextPage:
      (typeof record.has_next_page === "boolean"
        ? record.has_next_page
        : typeof record.hasNextPage === "boolean"
          ? record.hasNextPage
          : null) ?? nextCursor !== null,
  };
}

export async function searchXPage(
  keyword: string,
  opts: {
    queryType?: "Latest" | "Top";
    timeoutMs?: number;
    cursor?: string;
  } = {},
): Promise<XPage> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("TWITTERAPI_MISSING_KEY: set TWITTERAPI_IO_API_KEY.");

  const params = new URLSearchParams({
    query: keyword,
    queryType: opts.queryType ?? "Latest",
  });
  if (opts.cursor) params.set("cursor", opts.cursor);
  const response = await fetch(
    `${API_BASE}/twitter/tweet/advanced_search?${params.toString()}`,
    {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    },
  );

  if (response.status === 401 || response.status === 403) {
    throw new Error("TWITTERAPI_UNAUTHORIZED: API key is missing or invalid.");
  }
  if (response.status === 402) {
    throw new Error("TWITTERAPI_TOPUP_REQUIRED: credits cannot cover this call.");
  }
  if (response.status === 429) {
    throw new Error("TWITTERAPI_RATE_LIMITED: retry with backoff.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`TWITTERAPI_BAD_RESPONSE: HTTP ${response.status}.`);
  }

  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null
        ? ((body as Record<string, unknown>).msg ??
          (body as Record<string, unknown>).message)
        : null;
    throw new Error(
      `TWITTERAPI_UPSTREAM: ${typeof message === "string" ? message : `HTTP ${response.status}`}`.slice(
        0,
        200,
      ),
    );
  }

  const { nextCursor, hasNextPage } = pageInfo(body);
  const items = toTweetList(body)
    .map(normalizeTweet)
    .filter((item): item is NormalizedNewsItem => item !== null);
  return {
    items,
    nextCursor,
    hasNextPage,
  };
}

export type XUserPageOpts = {
  userName?: string;
  userId?: string;
  cursor?: string;
  includeReplies?: boolean;
  timeoutMs?: number;
};

/**
 * Latest tweets by username or user ID, newest first, up to 20 per page.
 * Note: built on X search — accounts hidden from search return empty even
 * with tweets on their profile. Response nests tweets under data.tweets.
 */
export async function searchXUserPage(opts: XUserPageOpts): Promise<XPage> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("TWITTERAPI_MISSING_KEY: set TWITTERAPI_IO_API_KEY.");
  const cleanName = opts.userName?.trim().replace(/^@/, "");
  if (!cleanName && !opts.userId?.trim()) {
    throw new Error("TWITTERAPI_BAD_REQUEST: pass userName or userId.");
  }

  const params = new URLSearchParams();
  if (opts.userId?.trim()) params.set("userId", opts.userId.trim());
  else if (cleanName) params.set("userName", cleanName);
  if (opts.cursor) params.set("cursor", opts.cursor);
  if (opts.includeReplies) params.set("includeReplies", "true");
  const response = await fetch(
    `${API_BASE}/twitter/user/last_tweets?${params.toString()}`,
    {
      headers: { "X-API-Key": apiKey },
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    },
  );

  if (response.status === 401 || response.status === 403) {
    throw new Error("TWITTERAPI_UNAUTHORIZED: API key is missing or invalid.");
  }
  if (response.status === 402) {
    throw new Error("TWITTERAPI_TOPUP_REQUIRED: credits cannot cover this call.");
  }
  if (response.status === 429) {
    throw new Error("TWITTERAPI_RATE_LIMITED: retry with backoff.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(`TWITTERAPI_BAD_RESPONSE: HTTP ${response.status}.`);
  }

  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null
        ? ((body as Record<string, unknown>).msg ??
          (body as Record<string, unknown>).message)
        : null;
    throw new Error(
      `TWITTERAPI_UPSTREAM: ${typeof message === "string" ? message : `HTTP ${response.status}`}`.slice(
        0,
        200,
      ),
    );
  }

  const data =
    typeof body === "object" && body !== null
      ? ((body as Record<string, unknown>).data as Record<string, unknown> | undefined)
      : undefined;
  const rawTweets = Array.isArray(data?.tweets) ? data.tweets : [];
  const rawPinned =
    data?.pin_tweet && typeof data.pin_tweet === "object" ? [data.pin_tweet] : [];
  const items = [...rawPinned, ...rawTweets]
    .filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === "object" && entry !== null,
    )
    .map(normalizeTweet)
    .filter((item): item is NormalizedNewsItem => item !== null);
  const { nextCursor, hasNextPage } = pageInfo(body);
  return { items, nextCursor, hasNextPage };
}

export async function searchXPosts(
  keyword: string,
  opts: {
    queryType?: "Latest" | "Top";
    timeoutMs?: number;
    cursor?: string;
  } = {},
): Promise<NormalizedNewsItem[]> {
  return (await searchXPage(keyword, opts)).items;
}
