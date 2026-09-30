// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type Orca from '@runorca/orca-sdk';

import { Cleanup } from './cleanup.js';
import { releaseSession, trackSession } from './session.js';

interface FakeThread {
  id: string;
  parent_thread_id: string | null;
  status: string;
}

/**
 * The slice of the client releaseSession touches, backed by scripted state. An
 * engine is not available offline, so this stands in for one.
 */
function fakeClient(options: {
  statuses: string[];
  threads?: FakeThread[];
  deleteError?: Error;
  /** Reject a send carrying more than one event, as a strict engine might. */
  rejectBatches?: boolean;
}) {
  const log: string[] = [];
  const sent: unknown[] = [];
  let reads = 0;
  const client = {
    sessions: {
      retrieve: async (id: string) => {
        const status = options.statuses[Math.min(reads, options.statuses.length - 1)];
        reads += 1;
        log.push(`retrieve ${status}`);
        return { id, status };
      },
      delete: async (id: string) => {
        log.push(`delete ${id}`);
        if (options.deleteError) throw options.deleteError;
        return { id, type: 'session_deleted' };
      },
      events: {
        send: async (_id: string, body: { events: unknown[] }) => {
          log.push('send');
          if (options.rejectBatches && body.events.length > 1) {
            throw new Error('one of these threads is already idle');
          }
          sent.push(...body.events);
          return {};
        },
      },
      threads: {
        list: (_id: string) =>
          (async function* () {
            for (const thread of options.threads ?? []) yield thread;
          })(),
      },
    },
  };
  return { orca: client as unknown as Orca, log, sent };
}

const fast = { timeoutMs: 200, intervalMs: 5 };

test('an idle session is deleted without an interrupt', async () => {
  const { orca, log, sent } = fakeClient({ statuses: ['idle'] });
  await releaseSession(orca, 'sesn_1', fast);
  assert.deepEqual(sent, []);
  assert.deepEqual(log, ['retrieve idle', 'delete sesn_1']);
});

test('a running session has each working thread interrupted, then is deleted once idle', async () => {
  const { orca, log, sent } = fakeClient({
    statuses: ['running', 'running', 'idle'],
    threads: [
      { id: 'thrd_primary', parent_thread_id: null, status: 'running' },
      { id: 'thrd_child', parent_thread_id: 'thrd_primary', status: 'rescheduling' },
      { id: 'thrd_done', parent_thread_id: 'thrd_primary', status: 'idle' },
    ],
  });
  await releaseSession(orca, 'sesn_1', fast);
  assert.deepEqual(sent, [
    { type: 'user.interrupt' },
    { type: 'user.interrupt', session_thread_id: 'thrd_child' },
  ]);
  assert.equal(log.at(-1), 'delete sesn_1');
  assert.ok(log.indexOf('send') < log.lastIndexOf('retrieve idle'), log.join(', '));
});

test('a rejected batch of interrupts falls back to one interrupt per thread', async () => {
  const { orca, sent } = fakeClient({
    statuses: ['running', 'idle'],
    threads: [
      { id: 'thrd_primary', parent_thread_id: null, status: 'running' },
      { id: 'thrd_child', parent_thread_id: 'thrd_primary', status: 'running' },
    ],
    rejectBatches: true,
  });
  await releaseSession(orca, 'sesn_1', fast);
  assert.deepEqual(sent, [
    { type: 'user.interrupt' },
    { type: 'user.interrupt', session_thread_id: 'thrd_child' },
  ]);
});

test('delete is still attempted when the session never goes idle', async () => {
  const { orca, log } = fakeClient({
    statuses: ['running'],
    threads: [{ id: 'thrd_primary', parent_thread_id: null, status: 'running' }],
    deleteError: new Error('session is still running'),
  });
  await assert.rejects(releaseSession(orca, 'sesn_1', fast), /still running/);
  assert.equal(log.at(-1), 'delete sesn_1');
});

test('a tracked session is released before resources registered earlier', async () => {
  const { orca, log } = fakeClient({ statuses: ['idle'] });
  const cleanup = new Cleanup();
  cleanup.add('file', async () => log.push('release file'));
  trackSession(cleanup, orca, 'sesn_1');
  await cleanup.run();
  assert.deepEqual(log, ['retrieve idle', 'delete sesn_1', 'release file']);
});
