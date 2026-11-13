import { describe, it, expect } from "vitest";
import {
  shouldShowTimestampPill,
  formatClusterTimestamp,
  getMessageTimestamp,
  computeMessageClusters,
  isSameDay,
} from "./TimestampPill";

describe("Timestamp clustering & formatting", () => {
  it("formats Today, Yesterday, and past dates with 2-digit time", () => {
    const baseDate = new Date(2026, 10, 2, 12, 0, 0);

    const todayMsg = new Date(2026, 10, 2, 9, 53, 0);
    const todayRes = formatClusterTimestamp(todayMsg, baseDate);
    expect(todayRes.day).toBe("Today");
    expect(todayRes.time).toBe("09:53 AM");
    expect(todayRes.label).toBe("Today | 09:53 AM");

    const yesterdayMsg = new Date(2026, 10, 1, 14, 20, 0);
    const yestRes = formatClusterTimestamp(yesterdayMsg, baseDate);
    expect(yestRes.day).toBe("Yesterday");
    expect(yestRes.time).toBe("02:20 PM");
    expect(yestRes.label).toBe("Yesterday | 02:20 PM");
  });

  describe("computeMessageClusters (< 5 chats merge rule)", () => {
    it("returns empty array when no messages", () => {
      expect(computeMessageClusters<{ time: number }>([], (m) => m.time)).toEqual([]);
    });

    it("shows timestamp on first message", () => {
      const msgs = [{ id: 1, time: 1000 }];
      const result = computeMessageClusters(msgs, (m) => m.time);
      expect(result).toHaveLength(1);
      expect(result[0].showTimestamp).toBe(true);
      expect(result[0].timestamp).toBe(1000);
    });

    it("merges clusters if combined count is less than 5 chats, keeping earlier title", () => {
      // Base time: Today 10:00 AM
      const t0 = new Date(2026, 10, 2, 10, 0, 0).getTime();
      const t1 = new Date(2026, 10, 2, 10, 15, 0).getTime(); // 15 mins later (>10m)
      const t2 = new Date(2026, 10, 2, 10, 30, 0).getTime(); // 15 mins later (>10m)
      const t3 = new Date(2026, 10, 2, 10, 45, 0).getTime(); // 15 mins later (>10m)

      const msgs = [
        { id: 1, time: t0 },
        { id: 2, time: t1 },
        { id: 3, time: t2 },
        { id: 4, time: t3 },
      ];

      const result = computeMessageClusters(msgs, (m) => m.time);
      expect(result).toHaveLength(4);

      // Total 4 chats (< 5) -> All merged under earlier title t0
      expect(result[0].showTimestamp).toBe(true);
      expect(result[0].timestamp).toBe(t0);

      expect(result[1].showTimestamp).toBe(false);
      expect(result[1].timestamp).toBe(t0);

      expect(result[2].showTimestamp).toBe(false);
      expect(result[2].timestamp).toBe(t0);

      expect(result[3].showTimestamp).toBe(false);
      expect(result[3].timestamp).toBe(t0);
    });

    it("merges multiple smaller exchanges (e.g. 12:10, 12:55, 01:18) under the initial time title until 5 chats are reached", () => {
      const t1 = new Date("2026-11-02T00:10:00").getTime();
      const t2 = new Date("2026-11-02T00:55:00").getTime(); // 45m later
      const t3 = new Date("2026-11-02T01:18:00").getTime(); // 23m later

      // 3 small exchanges of 2 messages each (total 6 messages)
      const msgs = [
        { id: "1", time: t1 },
        { id: "2", time: t1 + 5000 },
        { id: "3", time: t2 },
        { id: "4", time: t2 + 5000 },
        { id: "5", time: t3 },
        { id: "6", time: t3 + 5000 },
      ];

      const result = computeMessageClusters(msgs, (m) => m.time);
      expect(result).toHaveLength(6);

      // Only the first message at 12:10 AM shows a timestamp!
      // 12:55 AM and 01:18 AM do not show their own timestamps because the cluster was under 5 messages
      expect(result[0].showTimestamp).toBe(true);
      expect(result[0].timestamp).toBe(t1);

      expect(result[1].showTimestamp).toBe(false);
      expect(result[2].showTimestamp).toBe(false); // 12:55 AM merged
      expect(result[3].showTimestamp).toBe(false);
      expect(result[4].showTimestamp).toBe(false); // 01:18 AM merged
      expect(result[5].showTimestamp).toBe(false);

      // If a message arrives at 01:45 AM after the cluster has reached 6 messages (> 5), it splits!
      const t4 = new Date("2026-11-02T01:45:00").getTime();
      const extendedMsgs = [...msgs, { id: "7", time: t4 }];
      const extendedResult = computeMessageClusters(extendedMsgs, (m) => m.time);

      expect(extendedResult[6].showTimestamp).toBe(true);
      expect(extendedResult[6].timestamp).toBe(t4);
    });

    it("splits into a new cluster once total count reaches 5 or more", () => {
      const t0 = new Date(2026, 10, 2, 10, 0, 0).getTime();
      const t1 = new Date(2026, 10, 2, 10, 15, 0).getTime();
      const t2 = new Date(2026, 10, 2, 10, 30, 0).getTime();
      const t3 = new Date(2026, 10, 2, 10, 45, 0).getTime();
      const t4 = new Date(2026, 10, 2, 11, 0, 0).getTime(); // 5th chat arrives >10m later
      const t5 = new Date(2026, 10, 2, 11, 25, 0).getTime(); // 6th chat arrives after cluster reached 5

      const msgs = [
        { id: 1, time: t0 },
        { id: 2, time: t1 },
        { id: 3, time: t2 },
        { id: 4, time: t3 },
        { id: 5, time: t4 },
        { id: 6, time: t5 },
      ];

      const result = computeMessageClusters(msgs, (m) => m.time);
      expect(result).toHaveLength(6);

      // First 5 chats merged under t0 (count reached 5 at msg 5)
      expect(result[0].showTimestamp).toBe(true);
      expect(result[0].timestamp).toBe(t0);
      expect(result[1].showTimestamp).toBe(false);
      expect(result[2].showTimestamp).toBe(false);
      expect(result[3].showTimestamp).toBe(false);
      expect(result[4].showTimestamp).toBe(false);

      // 6th chat arrives >10m later when cluster had 5 chats -> starts new cluster at t5
      expect(result[5].showTimestamp).toBe(true);
      expect(result[5].timestamp).toBe(t5);
    });

    it("preserves calendar day boundary even if count is less than 5", () => {
      const night = new Date(2026, 10, 1, 23, 50, 0).getTime();
      const morning = new Date(2026, 10, 2, 0, 15, 0).getTime(); // next day

      const msgs = [
        { id: 1, time: night },
        { id: 2, time: morning },
      ];

      const result = computeMessageClusters(msgs, (m) => m.time);
      expect(result).toHaveLength(2);

      // Even though total is only 2 (< 5), day boundary prevents merge
      expect(result[0].showTimestamp).toBe(true);
      expect(result[0].timestamp).toBe(night);

      expect(result[1].showTimestamp).toBe(true);
      expect(result[1].timestamp).toBe(morning);
    });

    it("resists out-of-order timestamps and jitter gracefully", () => {
      const t0 = 100000;
      const t1 = 99990; // 10ms jitter / out of order
      const t2 = 100050;

      const msgs = [
        { id: 1, time: t0 },
        { id: 2, time: t1 },
        { id: 3, time: t2 },
      ];

      const result = computeMessageClusters(msgs, (m) => m.time);
      expect(result).toHaveLength(3);
      expect(result[0].showTimestamp).toBe(true);
      expect(result[1].showTimestamp).toBe(false);
      expect(result[2].showTimestamp).toBe(false);
    });

    it("resists invalid or missing timestamps gracefully", () => {
      const msgs = [
        { id: 1, time: NaN },
        { id: 2, time: 0 },
        { id: 3, time: 200000 },
      ];

      const result = computeMessageClusters(msgs, (m) => m.time);
      expect(result).toHaveLength(3);
      expect(result[0].showTimestamp).toBe(true);
      expect(Number.isFinite(result[0].timestamp)).toBe(true);
    });
  });
});
