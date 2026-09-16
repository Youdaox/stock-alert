import { describe, expect, it } from 'vitest';

import { splitCurlOutput } from '../src/core/curl.js';

describe('splitCurlOutput', () => {
  it('separates the body from the trailing status code', () => {
    expect(splitCurlOutput('<html>\n<body>hi</body>\n200')).toEqual({
      status: 200,
      body: '<html>\n<body>hi</body>',
    });
  });

  it('reports the status even when the body is empty', () => {
    expect(splitCurlOutput('\n403')).toEqual({ status: 403, body: '' });
  });

  it('falls back to status 0 when curl printed no status', () => {
    expect(splitCurlOutput('no newline here')).toEqual({ status: 0, body: 'no newline here' });
    expect(splitCurlOutput('body\nnot-a-number')).toEqual({ status: 0, body: 'body' });
  });
});
