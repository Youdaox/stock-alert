import { fetch, type RequestInit, type Response } from 'undici';

export interface HttpPolicy {
  userAgent: string;
  delayMs: number;
  maxRetries: number;
  backoffBaseMs: number;
  timeoutMs: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// 430 is Shopify's storefront "security rejection" rate limit.
const RETRYABLE_STATUS = new Set([429, 430, 500, 502, 503, 504]);

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get('retry-after');
  if (!header) {
    return undefined;
  }

  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return seconds * 1000;
  }

  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export async function requestWithPolicy(
  url: string,
  init: RequestInit = {},
  policy: HttpPolicy,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    await sleep(policy.delayMs);
    const backoffMs = policy.backoffBaseMs * 2 ** attempt;

    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          'User-Agent': policy.userAgent,
        },
        signal: AbortSignal.timeout(policy.timeoutMs),
      });

      if (!RETRYABLE_STATUS.has(response.status) || attempt >= policy.maxRetries) {
        return response;
      }

      await response.arrayBuffer();
      await sleep(retryAfterMs(response) ?? backoffMs);
    } catch (error) {
      if (attempt >= policy.maxRetries) {
        throw error;
      }

      await sleep(backoffMs);
    }
  }
}
