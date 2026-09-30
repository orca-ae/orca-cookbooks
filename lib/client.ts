// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

import Orca from '@runorca/orca-sdk';
import { loadConfig, type CookbookConfig } from './env.js';

export interface CookbookClient {
  orca: Orca;
  config: CookbookConfig;
}

/**
 * Build the client every recipe uses.
 *
 * `baseURL` is the host root; the SDK prefixes `/v1` on each call. Workspace
 * API keys use `x-api-key`, not the SDK's default bearer authentication.
 */
export function createClient(): CookbookClient {
  const config = loadConfig();

  const orca = new Orca({
    apiKey: null,
    defaultHeaders: { 'x-api-key': config.apiKey },
    baseURL: config.baseURL,
    // Recipes drive agent sessions, which think for a while before the first
    // byte. The SDK default is already generous; this makes it explicit so a
    // slow first turn is not mistaken for a hang.
    timeout: 600_000,
  });

  return { orca, config };
}
