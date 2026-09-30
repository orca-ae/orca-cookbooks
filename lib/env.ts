// Copyright The Orca Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Environment configuration shared by every recipe.
 *
 * Recipes never hardcode a base URL, key, model id, or resource id. Everything
 * comes through here so one `.env` switches the whole corpus between a
 * self-hosted engine and a hosted workspace.
 */

/** Thrown when a required variable is missing, with the fix in the message. */
export class MissingConfigError extends Error {
  constructor(name: string, hint: string) {
    super(`${name} is not set.\n\n  ${hint}\n\nCopy .env.example to .env and fill it in.`);
    this.name = 'MissingConfigError';
  }
}

function required(name: string, hint: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === '') {
    throw new MissingConfigError(name, hint);
  }
  return value.trim();
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

export interface CookbookConfig {
  /** Host root of the deployment. Excludes /v1 — the SDK appends it. */
  baseURL: string;
  apiKey: string;
  /** Model id for the primary agent in a recipe. */
  model: string;
  /** Cheaper model for delegated work. Falls back to `model`. */
  fastModel: string;
  /** Prefix for shared resources so parallel checkouts do not collide. */
  prefix: string;
}

/**
 * Read and validate configuration.
 *
 * `ORCA_BASE_URL` is normalized by stripping a trailing `/v1`, `/v1/registry`,
 * or `/api/v1`. The SDK warns and strips these itself, but doing it here keeps
 * the warning out of every recipe's output for what is a very easy mistake.
 */
export function loadConfig(): CookbookConfig {
  const rawBaseURL = required(
    'ORCA_BASE_URL',
    'Set it to the host root of your deployment, e.g. http://localhost:8080',
  );

  const model = required(
    'ORCA_MODEL',
    'Model ids are deployment-specific: use one your model provider accepts. On a hosted workspace, `ork agent providers list` shows them.',
  );

  return {
    baseURL: stripAPISuffix(rawBaseURL),
    apiKey: required('ORCA_API_KEY', 'Use a workspace API key for your deployment.'),
    model,
    fastModel: optional('ORCA_MODEL_FAST') ?? model,
    prefix: optional('ORCA_RESOURCE_PREFIX') ?? 'cookbooks',
  };
}

const API_SUFFIXES = ['/v1/registry', '/api/v1', '/v1'];

/** Remove an API path suffix a caller may have copied from a curl example. */
export function stripAPISuffix(url: string): string {
  const trimmed = url.replace(/\/+$/, '');
  for (const suffix of API_SUFFIXES) {
    if (trimmed.endsWith(suffix)) {
      return trimmed.slice(0, -suffix.length);
    }
  }
  return trimmed;
}
