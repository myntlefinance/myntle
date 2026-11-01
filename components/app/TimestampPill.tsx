import { memo } from "react";

const TEN_MINUTES_MS = 10 * 60 * 1000;

export function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export function isYesterday(target: Date, base: Date): boolean {
  const yesterday = new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1);
  return isSameDay(target, yesterday);
}

/**
 * Extracts a numeric epoch timestamp from a message object,
 * whether it carries metadata.createdAt, top-level createdAt, or fallback.
 */
export function getMessageTimestamp(
  message: {
    metadata?: unknown;
    createdAt?: unknown;
    timestamp?: unknown;
  },
  fallback?: number,
): number {
  if (message.metadata && typeof message.metadata === "object") {
    const meta = message.metadata as Record<string, unknown>;
    if (typeof meta.createdAt === "string" || typeof meta.createdAt === "number") {
      const parsed = new Date(meta.createdAt).getTime();
      if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }
  }

  if (typeof message.createdAt === "string" || typeof message.createdAt === "number") {
    const parsed = new Date(message.createdAt).getTime();
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }

  if (typeof message.timestamp === "number" && !Number.isNaN(message.timestamp)) {
    return message.timestamp;
  }

  return fallback ?? Date.now();
}

/**
 * Determines whether a message starts a new time cluster:
 * 1. The first message always shows a title.
 * 2. Crossing a calendar day boundary always shows a title.
 * 3. A gap of more than 10 minutes between messages shows a title.
 * 4. Otherwise, messages within 10 minutes on the same day are clustered together.
 */
export function shouldShowTimestampPill(
  currTime: number,
  prevTime?: number,
  thresholdMs: number = TEN_MINUTES_MS,
): boolean {
  if (prevTime === undefined) return true;

  const currDate = new Date(currTime);
  const prevDate = new Date(prevTime);

  // Crossing a calendar day boundary always triggers a new timestamp title
  if (!isSameDay(currDate, prevDate)) {
    return true;
  }

  // Clustered if gap is strictly greater than the threshold (10 minutes)
  return Math.abs(currTime - prevTime) > thresholdMs;
}

export type ClusteredMessage<T> = {
  message: T;
  showTimestamp: boolean;
  timestamp: number;
};

/**
 * Robust message clustering algorithm resistant to clock skew and missing timestamps:
 * 1. Sanitizes timestamps to ensure monotonicity.
 * 2. Enforces the 10-minute + 5-chat clustering rule:
 *    A cluster NEVER splits into a new timestamp header on the same day unless
 *    the active cluster has accumulated AT LEAST five chats (count >= 5) and
 *    there is a time gap > 10 minutes.
 *    Any messages arriving before the 5-chat threshold is met are merged into
 *    the earlier cluster under the earlier time title.
 * 3. Calendar day boundaries (e.g. crossing midnight) strictly trigger a new header.
 */
export function computeMessageClusters<T>(
  messages: T[],
  getTimestamp: (msg: T) => number,
  thresholdMs: number = TEN_MINUTES_MS,
  minClusterSize: number = 5,
): ClusteredMessage<T>[] {
  if (messages.length === 0) return [];

  // Step 1: Sanitize timestamps monotonically to resist clock skew / network arrival jitter
  const sanitizedTimestamps: number[] = new Array(messages.length);
  let lastValidTime = 0;

  for (let i = 0; i < messages.length; i++) {
    const raw = getTimestamp(messages[i]);
    const valid =
      Number.isFinite(raw) && raw > 0 ? raw : lastValidTime || Date.now();
    const monotonic = lastValidTime > 0 ? Math.max(valid, lastValidTime) : valid;
    sanitizedTimestamps[i] = monotonic;
    lastValidTime = monotonic;
  }

  // Step 2: Form clusters in a single pass.
  // A new cluster starts ONLY when:
  // - It is the very first message (i === 0), OR
  // - A calendar day boundary is crossed, OR
  // - There is a gap > thresholdMs (10 min) AND the active cluster already has >= minClusterSize chats.
  type Cluster = {
    indices: number[];
    timestamp: number;
    count: number;
  };

  const clusters: Cluster[] = [];
  let currentCluster: Cluster | null = null;

  for (let i = 0; i < messages.length; i++) {
    const time = sanitizedTimestamps[i];
    const prevTime = i > 0 ? sanitizedTimestamps[i - 1] : undefined;

    const isDifferentDay =
      prevTime !== undefined &&
      !isSameDay(new Date(time), new Date(prevTime));

    const isTimeGap =
      prevTime !== undefined && time - prevTime > thresholdMs;

    // Must have at least minClusterSize (5) chats before a time gap can split a new cluster
    if (
      !currentCluster ||
      isDifferentDay ||
      (isTimeGap && currentCluster.count >= minClusterSize)
    ) {
      currentCluster = {
        indices: [i],
        timestamp: time,
        count: 1,
      };
      clusters.push(currentCluster);
    } else {
      currentCluster.indices.push(i);
      currentCluster.count += 1;
    }
  }

  // Step 3: Map back to clustered message structure
  const showTimestampIndices = new Set(clusters.map((c) => c.indices[0]));
  const clusterTimestampMap = new Map<number, number>();
  for (const c of clusters) {
    for (const idx of c.indices) {
      clusterTimestampMap.set(idx, c.timestamp);
    }
  }

  return messages.map((message, i) => ({
    message,
    showTimestamp: showTimestampIndices.has(i),
    timestamp: clusterTimestampMap.get(i) ?? sanitizedTimestamps[i],
  }));
}

/**
 * Formats a timestamp into human-calm date and time components:
 * - "Today | 09:53 PM"
 * - "Yesterday | 04:12 PM"
 * - "Oct 24 | 11:30 AM" (or "Oct 24, 2025 | 11:30 AM" if different year)
 */
export function formatClusterTimestamp(
  timestamp: number | Date | string,
  baseDate: Date = new Date(),
): {
  day: string;
  time: string;
  label: string;
} {
  const date =
    typeof timestamp === "object" && timestamp instanceof Date
      ? timestamp
      : new Date(timestamp);

  let day: string;
  if (isSameDay(date, baseDate)) {
    day = "Today";
  } else if (isYesterday(date, baseDate)) {
    day = "Yesterday";
  } else {
    const sameYear = date.getFullYear() === baseDate.getFullYear();
    day = new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    }).format(date);
  }

  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);

  return {
    day,
    time,
    label: `${day} | ${time}`,
  };
}

/**
 * Clean unadorned text divider: "xyz | time"
 * Removed round pill background and border per request.
 */
export const TimestampPill = memo(function TimestampPill({
  timestamp,
  className = "",
}: {
  timestamp: number | Date | string;
  className?: string;
}) {
  const { day, time } = formatClusterTimestamp(timestamp);

  return (
    <div
      className={`flex items-center justify-center select-none py-2 ${className}`}
      style={{ animation: "fade-in 300ms cubic-bezier(0.23,1,0.32,1) both" }}
      aria-label={`${day} at ${time}`}
      role="separator"
    >
      <div className="flex items-center gap-2 text-[12px] font-medium tracking-normal text-ink-2">
        <span className="font-semibold text-ink">{day}</span>
        <span className="text-ink-3">|</span>
        <span>{time}</span>
      </div>
    </div>
  );
});
