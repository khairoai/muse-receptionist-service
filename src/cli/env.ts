import { existsSync } from "node:fs";

/** Reads .env when there is one, and returns the Meta key or exits with how to get one. */
export function metaApiKey(): string {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const key = process.env.META_MODEL_API_KEY;
  if (!key) {
    console.error("META_MODEL_API_KEY is not set. Copy .env.example to .env and add a key from https://dev.meta.ai.");
    process.exit(1);
  }
  return key;
}

export function sparkModel(): string | undefined {
  return process.env.MUSE_SPARK_MODEL || undefined;
}
