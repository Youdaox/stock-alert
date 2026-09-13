import { fetch, type RequestInit, type Response } from 'undici';

export interface HttpPolicy {
  userAgent: string;
  delayMs: number;
  maxRetries: number;
  backoffBaseMs: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function requestWithPolicy(
  url: string,
  init: RequestInit = {},
  policy: HttpPolicy,
): Promise<Response> {
  let attempt = 0;

  while (true) {
    await sleep(policy.delayMs);

    const headers = {
      ...(init.headers ?? {}),
      'User-Agent': policy.userAgent,
    };

    const response = await fetch(url, {
      ...init,
      headers,
    });

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt >= policy.maxRetries) {
      return response;
    }

    attempt += 1;
    await sleep(policy.backoffBaseMs * 2 ** (attempt - 1));
  }
}
