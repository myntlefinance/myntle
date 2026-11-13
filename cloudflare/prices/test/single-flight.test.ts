import { describe, expect, it } from "vitest";
import { createSingleFlight, drainMisses } from "../src/lib/single-flight";

describe("single flight", () => {
  it("shares one promise between two callers", async () => {
    const flight = createSingleFlight<number>();
    let runs = 0;
    let release: (value: number) => void = () => {};

    const task = (): Promise<number> => {
      runs += 1;
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    };

    const first = flight.run(task);
    const second = flight.run(task);

    expect(second).toBe(first);
    expect(flight.pending).toBe(true);

    release(42);

    await expect(first).resolves.toBe(42);
    await expect(second).resolves.toBe(42);
    expect(runs).toBe(1);
    expect(flight.pending).toBe(false);
  });

  it("starts new work after the previous flight settles", async () => {
    const flight = createSingleFlight<number>();
    let runs = 0;
    const task = async (): Promise<number> => {
      runs += 1;
      return runs;
    };

    await expect(flight.run(task)).resolves.toBe(1);
    expect(flight.pending).toBe(false);

    await expect(flight.run(task)).resolves.toBe(2);
    expect(runs).toBe(2);
  });

  it("clears after a rejection so the next caller retries", async () => {
    const flight = createSingleFlight<number>();
    let runs = 0;

    const failing = async (): Promise<number> => {
      runs += 1;
      throw new Error("upstream down");
    };

    await expect(flight.run(failing)).rejects.toThrow("upstream down");
    expect(flight.pending).toBe(false);

    const result = await flight.run(async () => {
      runs += 1;
      return 7;
    });

    expect(result).toBe(7);
    expect(runs).toBe(2);
  });

  it("clears after a synchronous throw", async () => {
    const flight = createSingleFlight<number>();

    await expect(
      flight.run(() => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(flight.pending).toBe(false);
  });
});

describe("drainMisses", () => {
  it("drains three concurrent callers with different id sets", async () => {
    const flight = createSingleFlight<{ decided: Set<string> }>();
    const batches: string[][] = [];

    const runBatch = async (ids: string[]): Promise<{ decided: Set<string> }> => {
      batches.push([...ids]);
      // Yield so the other callers can join this flight before it settles.
      await Promise.resolve();
      return { decided: new Set(ids) };
    };

    const drain = (ids: string[]) =>
      drainMisses(ids, (missing) => flight.run(() => runBatch(missing)));

    const [ltc, ada, avax] = await Promise.all([
      drain(["ltc"]),
      drain(["ada"]),
      drain(["avax"]),
    ]);

    const decided = new Set<string>();
    for (const outcome of [ltc, ada, avax]) {
      for (const assetId of outcome.result?.decided ?? []) {
        decided.add(assetId);
      }
    }

    // The shared flight can join a caller to someone else's batch; the drain
    // must re-check and run again until every caller's ids are settled.
    expect([...decided].sort()).toEqual(["ada", "avax", "ltc"]);
    expect(batches.map((batch) => batch.join(",")).sort()).toEqual([
      "ada",
      "avax",
      "ltc",
    ]);
  });

  it("drains six concurrent callers with distinct ids", async () => {
    const flight = createSingleFlight<{ decided: Set<string> }>();
    const ids = ["a", "b", "c", "d", "e", "f"];
    const batches: string[][] = [];

    const runBatch = async (batch: string[]): Promise<{ decided: Set<string> }> => {
      batches.push([...batch]);
      await Promise.resolve();
      return { decided: new Set(batch) };
    };

    const drain = (id: string) =>
      drainMisses([id], (missing) => flight.run(() => runBatch(missing)));

    const outcomes = await Promise.all(ids.map((id) => drain(id)));

    const decided = new Set<string>();
    for (const outcome of outcomes) {
      expect(outcome.result).not.toBeNull();
      for (const id of outcome.result?.decided ?? []) decided.add(id);
    }

    // The last caller joins five other callers' flights before it runs its
    // own. The old bound of four cut that off and returned null.
    expect([...decided].sort()).toEqual(ids);
    expect(batches).toHaveLength(6);
  });

  it("keeps two callers on the same first flight", async () => {
    const flight = createSingleFlight<{ decided: Set<string> }>();
    let runs = 0;

    const runBatch = async (ids: string[]): Promise<{ decided: Set<string> }> => {
      runs += 1;
      await Promise.resolve();
      return { decided: new Set(ids) };
    };

    const drain = (ids: string[]) =>
      drainMisses(ids, (missing) => flight.run(() => runBatch(missing)));

    const [btc, eth] = await Promise.all([drain(["btc"]), drain(["eth"])]);

    // The first caller settles btc; the second joins that flight, then runs
    // once more for eth. Exactly two batches, never three.
    expect(runs).toBe(2);
    expect(btc.result?.decided).toEqual(new Set(["btc"]));
    expect(eth.result?.decided).toEqual(new Set(["eth"]));
  });

  it("stops at the round bound when an id is never decided", async () => {
    let runs = 0;

    const outcome = await drainMisses(
      ["stuck"],
      async () => {
        runs += 1;
        return { decided: new Set<string>() };
      },
      3,
    );

    expect(runs).toBe(3);
    expect(outcome.rounds).toBe(3);
  });

  it("does no work when there is nothing to drain", async () => {
    let runs = 0;

    const outcome = await drainMisses([], async () => {
      runs += 1;
      return { decided: new Set<string>() };
    });

    expect(runs).toBe(0);
    expect(outcome.result).toBeNull();
    expect(outcome.rounds).toBe(0);
  });
});
