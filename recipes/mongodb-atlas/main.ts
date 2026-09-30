// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Give an agent a database without giving it the database.
 *
 * The agent gets two custom tools - one that runs a read-only query, one that
 * flags a transaction for review. Both execute in this process, against a
 * connection the sandbox has no route to. The agent composes queries; it never
 * holds a credential, and it cannot reach the cluster if it tried.
 *
 * The query tool is where the work is. Accepting a filter document from a model
 * and passing it to a driver is how you end up running `$where`, so the tool
 * validates the shape before it executes anything.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  bootstrap,
  createClient,
  runToolLoop,
  trackSession,
  waitForIdle,
  withCleanup,
  type ToolHandlers,
} from '../../lib/index.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const COLLECTION = 'transactions';

const SYSTEM = `You are reviewing card transactions for fraud.

You cannot see the database directly. Use find_transactions() to query it and
flag_transaction() to mark something for human review.

Query deliberately. Look at the shape of normal activity before deciding what
is abnormal, and prefer a few well-aimed queries to many broad ones. A single
unusual transaction is weak evidence; a pattern is strong evidence.

When you flag something, say what makes it anomalous relative to the account's
own history, not relative to your intuition.`;

const TASK = `Review the recent transactions and flag anything that looks like
card fraud. Explain the pattern you found.`;

/** Minimal document shape the recipe needs. */
interface Txn {
  _id: string;
  account: string;
  merchant: string;
  city: string;
  amount_eur: number;
  ts: string;
  flagged: boolean;
}

/**
 * The store the tools run against.
 *
 * Backed by Atlas when a URI is configured, and by the local fixture otherwise,
 * so the recipe demonstrates the pattern without requiring a cluster. The agent
 * cannot tell the difference, which is the point - it only ever sees the tool.
 */
interface Store {
  describe(): string;
  find(filter: Record<string, unknown>, limit: number): Promise<Txn[]>;
  flag(id: string, reason: string): Promise<boolean>;
  /** Release the connection, if there is one. */
  close(): Promise<void>;
}

export default async function run(): Promise<void> {
  const { orca, config } = createClient();

  await withCleanup(async (cleanup) => {
    // An open driver connection keeps the process alive, so it is released
    // like everything else the recipe creates.
    const store = await openStore();
    cleanup.add('store connection', () => store.close());
    console.log(store.describe());

    const { environmentId } = await bootstrap(orca, config);

    const agent = await orca.agents.create({
      name: `${config.prefix}-fraud-review`,
      model: config.model,
      system: SYSTEM,
      tools: [
        {
          type: 'custom',
          name: 'find_transactions',
          description:
            'Run a read-only query against the transactions collection. ' +
            'The filter uses MongoDB query syntax and may only reference the fields ' +
            'account, merchant, city, amount_eur, ts and flagged.',
          input_schema: {
            type: 'object',
            properties: {
              filter: {
                type: 'object',
                description: 'A MongoDB filter document. Pass {} to sample everything.',
              },
              limit: { type: 'integer', description: 'Maximum documents to return, up to 50.' },
            },
            required: ['filter'],
          },
        },
        {
          type: 'custom',
          name: 'flag_transaction',
          description: 'Mark one transaction for human review.',
          input_schema: {
            type: 'object',
            properties: {
              transaction_id: { type: 'string' },
              reason: { type: 'string', description: 'What makes this anomalous.' },
            },
            required: ['transaction_id', 'reason'],
          },
        },
      ],
    });
    cleanup.add(`agent ${agent.id}`, () => orca.agents.archive(agent.id));

    const session = await orca.sessions.create({
      agent: agent.id,
      environment_id: environmentId,
      title: 'fraud review',
      initial_events: [{ type: 'user.message', content: [{ type: 'text', text: TASK }] }],
    });
    trackSession(cleanup, orca, session.id);
    console.log(`session ${session.id}\n`);

    const flagged: { id: string; reason: string }[] = [];
    const handlers: ToolHandlers = {
      async find_transactions(input) {
        const filter = assertSafeFilter(input['filter']);
        const limit = Math.min(Number(input['limit'] ?? 20) || 20, 50);
        const rows = await store.find(filter, limit);
        console.log(`  query ${JSON.stringify(filter)} -> ${rows.length} row(s)`);
        return { count: rows.length, transactions: rows };
      },
      async flag_transaction(input) {
        const id = String(input['transaction_id'] ?? '');
        const reason = String(input['reason'] ?? '');
        const ok = await store.flag(id, reason);
        if (!ok) throw new Error(`no such transaction: ${id}`);
        flagged.push({ id, reason });
        console.log(`  flagged ${id}`);
        return { flagged: true, transaction_id: id };
      },
    };

    const result = await runToolLoop(orca, session.id, handlers);
    if (result.stopReason !== 'end_turn') {
      throw new Error(`agent stopped with "${result.stopReason}"`);
    }

    await waitForIdle(orca, session.id);
    review(flagged);
  });
}

/**
 * Reject operators that execute rather than match.
 *
 * A filter document from a model is untrusted input. `$where` and `$function`
 * run server-side JavaScript; `$expr` and `$accumulator` widen the surface
 * further. None of them are needed to match on six scalar fields.
 */
const FORBIDDEN = new Set(['$where', '$function', '$accumulator', '$expr', '$javascript']);
const ALLOWED_FIELDS = new Set(['_id', 'account', 'merchant', 'city', 'amount_eur', 'ts', 'flagged']);

function assertSafeFilter(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('filter must be an object');
  }

  const walk = (node: unknown, depth: number): void => {
    if (depth > 6) throw new Error('filter is nested too deeply');
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== 'object' || node === null) return;

    for (const [key, value] of Object.entries(node)) {
      if (FORBIDDEN.has(key)) {
        throw new Error(`operator ${key} is not permitted - it executes rather than matches`);
      }
      if (!key.startsWith('$') && !ALLOWED_FIELDS.has(key)) {
        throw new Error(
          `field "${key}" is not queryable. Allowed: ${[...ALLOWED_FIELDS].join(', ')}`,
        );
      }
      walk(value, depth + 1);
    }
  };

  walk(raw, 0);
  return raw as Record<string, unknown>;
}

/** Atlas when configured, fixture otherwise. */
async function openStore(): Promise<Store> {
  const uri = process.env['MONGODB_URI'];
  const dbName = process.env['MONGODB_DB'] ?? 'cookbooks';

  if (uri === undefined || uri.trim() === '') {
    return fixtureStore();
  }

  type Client = {
    connect: () => Promise<void>;
    db: (n: string) => unknown;
    close: () => Promise<void>;
  };
  let mongodb: { MongoClient: new (uri: string) => Client };
  try {
    // Typed as a plain string so the compiler does not try to resolve the
    // module: mongodb is an optional extra, and the repo typechecks without it.
    const specifier: string = 'mongodb';
    mongodb = (await import(specifier)) as typeof mongodb;
  } catch {
    console.warn('MONGODB_URI is set but the mongodb driver is not installed.');
    console.warn('Install it with `pnpm add mongodb`, or unset MONGODB_URI to use the fixture.\n');
    return fixtureStore();
  }

  // A bad URI or an unreachable cluster fails here, loudly: MONGODB_URI says
  // Atlas was wanted, so quietly using the fixture instead would mislead.
  const client = new mongodb.MongoClient(uri);
  await client.connect();

  const collection = (
    client.db(dbName) as { collection: (n: string) => Record<string, (...a: never[]) => unknown> }
  ).collection(COLLECTION);

  return {
    describe: () => `store: MongoDB at ${dbName}.${COLLECTION}`,
    async find(filter, limit) {
      const cursor = (collection['find'] as (f: unknown) => { limit: (n: number) => { toArray: () => Promise<Txn[]> } })(filter);
      return cursor.limit(limit).toArray();
    },
    async flag(id, reason) {
      const update = collection['updateOne'] as (
        f: unknown,
        u: unknown,
      ) => Promise<{ matchedCount: number }>;
      const res = await update({ _id: id }, { $set: { flagged: true, flag_reason: reason } });
      return res.matchedCount > 0;
    },
    close: () => client.close(),
  };
}

/** In-memory store over the fixture, with enough operator support to be useful. */
function fixtureStore(): Store {
  const rows = JSON.parse(
    readFileSync(join(FIXTURES, 'transactions.json'), 'utf8'),
  ) as Txn[];

  const matches = (doc: Txn, filter: Record<string, unknown>): boolean =>
    Object.entries(filter).every(([field, condition]) => {
      if (field === '$and') return (condition as Record<string, unknown>[]).every((c) => matches(doc, c));
      if (field === '$or') return (condition as Record<string, unknown>[]).some((c) => matches(doc, c));

      const actual = (doc as unknown as Record<string, unknown>)[field];
      if (typeof condition !== 'object' || condition === null) return actual === condition;

      return Object.entries(condition as Record<string, unknown>).every(([op, operand]) => {
        switch (op) {
          case '$gt': return Number(actual) > Number(operand);
          case '$gte': return Number(actual) >= Number(operand);
          case '$lt': return Number(actual) < Number(operand);
          case '$lte': return Number(actual) <= Number(operand);
          case '$ne': return actual !== operand;
          case '$in': return Array.isArray(operand) && operand.includes(actual);
          case '$regex': return new RegExp(String(operand), 'i').test(String(actual));
          default: return false;
        }
      });
    });

  return {
    describe: () => `store: local fixture (${rows.length} transactions). Set MONGODB_URI to use Atlas.`,
    async find(filter, limit) {
      return rows.filter((row) => matches(row, filter)).slice(0, limit);
    },
    async flag(id, reason) {
      const row = rows.find((r) => r._id === id);
      if (row === undefined) return false;
      row.flagged = true;
      (row as unknown as Record<string, unknown>)['flag_reason'] = reason;
      return true;
    },
    close: async () => {},
  };
}

function review(flagged: { id: string; reason: string }[]): void {
  console.log('\n--- flagged for review ---');
  for (const item of flagged) console.log(`  ${item.id}: ${item.reason}`);

  if (flagged.length === 0) {
    throw new Error('nothing was flagged; the planted pattern went unnoticed');
  }

  // Three transactions on acct-03, far from its other activity, minutes apart.
  const planted = flagged.filter((f) => f.id.startsWith('txn-9'));
  if (planted.length === 0) {
    throw new Error('flagged something, but not the planted burst on acct-03');
  }
  console.log(`\nfound ${planted.length}/3 of the planted pattern`);
}
