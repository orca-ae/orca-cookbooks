// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import { test } from 'node:test';

import { createClient } from './client.js';

test('workspace API keys use x-api-key, not bearer authentication', async (t) => {
  let headers: IncomingHttpHeaders | undefined;
  let path: string | undefined;
  const server = createServer((request, response) => {
    headers = request.headers;
    path = request.url;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: [], next_page: null }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address !== null && typeof address !== 'string');

  const env = {
    ORCA_BASE_URL: `http://127.0.0.1:${address.port}`,
    ORCA_API_KEY: 'test-workspace-key',
    ORCA_MODEL: 'test-model',
  };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }

  const { orca } = createClient();
  await orca.environments.list();
  assert.equal(path, '/v1/environments');
  assert.equal(headers?.['x-api-key'], env.ORCA_API_KEY);
  assert.equal(headers?.authorization, undefined);
});
