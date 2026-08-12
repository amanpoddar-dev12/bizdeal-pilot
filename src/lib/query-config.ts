import type { QueryClient } from "@tanstack/react-query";
import { STALE_TIMES } from "./query-keys";

/** Errors that will never succeed on retry (auth / permission / validation). */
export function isNonRetryableError(error: unknown): boolean {
  const msg = String((error as { message?: string } | null)?.message ?? error ?? "").toLowerCase();
  const status = (error as { status?: number; statusCode?: number } | null)?.status
    ?? (error as { statusCode?: number } | null)?.statusCode;
  if (status && [400, 401, 403, 404, 409, 422].includes(status)) return true;
  return [
    "unauthorized",
    "forbidden",
    "not authorized",
    "permission",
    "authorization header",
    "invalid input",
    "validation",
    "row-level security",
    "jwt",
  ].some((m) => msg.includes(m));
}

/** Exponential backoff with jitter, capped at 8s. */
export function retryDelay(attempt: number): number {
  return Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250;
}

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (isNonRetryableError(error)) return false;
  return failureCount < 3;
}

/** Register per-resource cache policies on the query client. */
export function applyQueryDefaults(qc: QueryClient) {
  for (const [key, staleTime] of STALE_TIMES) {
    qc.setQueryDefaults(key as unknown[], { staleTime });
  }
}
