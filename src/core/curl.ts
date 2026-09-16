import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Some retailers (The Warehouse) sit behind Cloudflare, which rejects undici by its TLS
 * fingerprint even with browser headers: curl and a browser get 200 where undici gets 403.
 * Node's built-in fetch is undici too, so those sources fetch through curl instead.
 */
export interface CurlOptions {
  userAgent: string;
  headers?: Record<string, string>;
  timeoutMs: number;
}

export interface CurlResponse {
  status: number;
  body: string;
}

const STATUS_MARKER = '\n%{http_code}';

/** Splits the body from the trailing status code curl writes with -w. */
export function splitCurlOutput(output: string): CurlResponse {
  const index = output.lastIndexOf('\n');
  if (index === -1) {
    return { status: 0, body: output };
  }

  const status = Number.parseInt(output.slice(index + 1).trim(), 10);
  return { status: Number.isFinite(status) ? status : 0, body: output.slice(0, index) };
}

export async function curlText(url: string, options: CurlOptions): Promise<CurlResponse> {
  const args = [
    '-sS',
    '--compressed',
    '--max-time',
    String(Math.max(1, Math.ceil(options.timeoutMs / 1000))),
    '-A',
    options.userAgent,
  ];

  for (const [name, value] of Object.entries(options.headers ?? {})) {
    args.push('-H', `${name}: ${value}`);
  }

  args.push('-w', STATUS_MARKER, url);

  const { stdout } = await run('curl', args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true });
  return splitCurlOutput(stdout);
}
