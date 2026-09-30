// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

import type Orca from '@runorca/orca-sdk';
import { ExtensionNotAvailableError } from '@runorca/orca-sdk';
import type { EnvironmentConfig } from '@runorca/orca-sdk/resources/environments';
import type { CookbookConfig } from './env.js';

/**
 * One-time setup shared by the recipes.
 *
 * A session needs an environment, so every recipe needs one before it can do
 * anything. Rather than each recipe creating and discarding its own, they share
 * one keyed by `ORCA_RESOURCE_PREFIX` and reuse it across runs.
 *
 * Note what is *not* here. LLM providers are read-only in the SDK
 * (`orca.cloud.agents.providers` exposes `list` and `retrieve` only) and live
 * behind the hosted extension group, which a self-hosted engine does not serve
 * at all. On a hosted workspace, providers are registered by whoever
 * administers it; on a self-hosted engine, the model provider is part of the
 * engine's own configuration. Either way it is set up before a recipe runs,
 * not by one. Vault credentials are per-recipe and belong to the recipes that
 * speak to MCP servers.
 */

export interface BootstrapResult {
  environmentId: string;
  /** True when this run created the environment rather than reusing one. */
  created: boolean;
}

export interface BootstrapOptions {
  /** Overrides the default `{ type: 'cloud' }`. */
  config?: EnvironmentConfig;
  /** Suffix for recipes needing an environment distinct from the shared one. */
  suffix?: string;
}

/** Find an environment by exact name, paging until found or exhausted. */
async function findEnvironmentByName(orca: Orca, name: string): Promise<string | undefined> {
  for await (const environment of orca.environments.list()) {
    if (environment.name === name) return environment.id;
  }
  return undefined;
}

/**
 * Ensure the shared environment exists and return its id.
 *
 * Idempotent: reuses an existing environment with the same name so repeated
 * runs do not accumulate them.
 */
export async function bootstrap(
  orca: Orca,
  config: CookbookConfig,
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const name = options.suffix === undefined ? config.prefix : `${config.prefix}-${options.suffix}`;

  const existing = await findEnvironmentByName(orca, name);
  if (existing !== undefined) {
    return { environmentId: existing, created: false };
  }

  const environment = await orca.environments.create({
    name,
    config: options.config ?? { type: 'cloud' },
  });

  return { environmentId: environment.id, created: true };
}

/**
 * List the model ids this workspace can reach, best effort.
 *
 * Only useful for telling a reader why `ORCA_MODEL` was rejected. Returns an
 * empty list on a self-hosted engine, which does not serve the hosted
 * extension group, rather than throwing, because not having it is normal.
 */
export async function discoverProviders(orca: Orca): Promise<string[]> {
  try {
    const providers = await orca.cloud.agents.providers.list();
    return providers.map((provider) => provider.name).filter((n): n is string => Boolean(n));
  } catch (error) {
    if (error instanceof ExtensionNotAvailableError) return [];
    throw error;
  }
}
