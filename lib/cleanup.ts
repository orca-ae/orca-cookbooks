// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Teardown for resources a recipe creates.
 *
 * Recipes are meant to be run repeatedly. Anything created gets registered here
 * and released in reverse order at the end, including on failure and on
 * Ctrl-C, so a rerun starts from the same state as the first run.
 */

type Release = () => Promise<unknown>;

interface Registered {
  label: string;
  release: Release;
}

export class Cleanup {
  readonly #first: Registered[] = [];
  readonly #stack: Registered[] = [];
  #running: Promise<void> | undefined;

  /** Register a resource. Released in reverse order of registration. */
  add(label: string, release: Release): void {
    this.#stack.push({ label, release });
  }

  /**
   * Register a resource that must go before everything added with `add`,
   * whenever those were registered.
   *
   * Sessions go here. A session holds the files, agents and stores it uses, and
   * a file added to a session that is already running is registered after it,
   * so plain reverse order would delete that file while it is still mounted.
   */
  addFirst(label: string, release: Release): void {
    this.#first.push({ label, release });
  }

  /**
   * Release everything: `addFirst` entries, then the rest, each most recent
   * first.
   *
   * A failure to release one resource is reported and does not stop the rest —
   * a half-cleaned workspace is worse than a noisy one. A second call while a
   * run is in progress waits for that run rather than starting another.
   */
  run(): Promise<void> {
    this.#running ??= this.#drain().finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }

  async #drain(): Promise<void> {
    // Keep going until both stacks are empty: a create call that was in flight
    // when cleanup started can register its resource while this runs.
    for (;;) {
      const entry = this.#first.pop() ?? this.#stack.pop();
      if (entry === undefined) return;
      try {
        await entry.release();
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`  ! could not release ${entry.label}: ${reason}`);
      }
    }
  }
}

/** Set once a signal has asked the recipe to stop. */
let stopping = false;

/** Thrown at a turn boundary after a signal has asked the recipe to stop. */
export class StoppedError extends Error {
  constructor() {
    super('stopped by a signal');
    this.name = 'StoppedError';
  }
}

/**
 * Throw if a signal has asked the recipe to stop.
 *
 * Interrupting a session ends its current turn normally, so without this a
 * recipe would carry on into its next turn while cleanup tries to delete the
 * session underneath it. The streaming helpers call it at every turn boundary.
 */
export function throwIfStopped(): void {
  if (stopping) throw new StoppedError();
}

/** Repeats inside this window are one Ctrl-C relayed by a wrapper, not a second one. */
const RELAY_WINDOW_MS = 1_000;

/**
 * Run a recipe body with guaranteed teardown.
 *
 * Cleanup runs whether the body succeeds or throws; the original error is
 * rethrown after teardown so the failure is what surfaces. Ctrl-C (or SIGTERM)
 * also runs cleanup before the process exits, since Node would otherwise exit
 * without running `finally` and leave a live session behind; the body stops at
 * its next turn boundary. `pnpm recipe` and the tsx wrapper each relay a
 * Ctrl-C, so repeats within a second count as the same one. A second Ctrl-C
 * after that exits at once.
 */
export async function withCleanup<T>(body: (cleanup: Cleanup) => Promise<T>): Promise<T> {
  const cleanup = new Cleanup();
  let firstSignalAt: number | undefined;

  const onSignal = (signal: NodeJS.Signals): void => {
    // 128 + the signal number, as a shell reports it: 130 for SIGINT, 143 for SIGTERM.
    const code = signal === 'SIGTERM' ? 143 : 130;
    if (firstSignalAt !== undefined) {
      if (Date.now() - firstSignalAt < RELAY_WINDOW_MS) return;
      console.warn(`\n${signal} again: exiting without finishing cleanup.`);
      process.exit(code);
    }
    firstSignalAt = Date.now();
    stopping = true;
    console.warn(`\n${signal}: releasing what this recipe created. Send it again to skip.`);
    void cleanup.run().finally(() => process.exit(code));
  };
  // `on`, not `once`: a relayed repeat that found no listener would end the
  // process mid-cleanup. The listeners stay until cleanup has finished.
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    return await body(cleanup);
  } finally {
    await cleanup.run();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
