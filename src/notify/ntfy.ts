import type { EventKind } from '../core/differ.js';
import type { HttpPolicy } from '../core/http.js';
import { requestWithPolicy } from '../core/http.js';
import { formatNzd, formatStoreList, formatStores, type AlertDetails } from './discord.js';

/**
 * Push to a phone via ntfy. A drop window is minutes, and a Discord message in a busy client is
 * easy to miss, so restocks go out at high priority with the product link attached.
 */
export interface NtfyMessage {
  title: string;
  body: string;
  priority: string;
  tags: string;
  click: string;
}

const KIND_LABEL: Record<EventKind, string> = {
  RESTOCK: 'Back in stock',
  NEW_PRODUCT: 'New listing',
  PRICE_DROP: 'Price drop',
  SOLD_OUT: 'Sold out',
};

// ntfy priorities: 5 max, 4 high, 3 default, 2 low.
const KIND_PRIORITY: Record<EventKind, string> = {
  RESTOCK: '5',
  NEW_PRODUCT: '4',
  PRICE_DROP: '3',
  SOLD_OUT: '2',
};

const KIND_TAGS: Record<EventKind, string> = {
  RESTOCK: 'rotating_light',
  NEW_PRODUCT: 'sparkles',
  PRICE_DROP: 'chart_with_downwards_trend',
  SOLD_OUT: 'x',
};

const MAX_TITLE = 120;

export function formatNtfy(alert: AlertDetails): NtfyMessage {
  const dropped =
    alert.prevPriceCents !== null && alert.priceCents !== null && alert.prevPriceCents > alert.priceCents;
  const price = dropped
    ? `${formatNzd(alert.prevPriceCents)} → ${formatNzd(alert.priceCents)}`
    : formatNzd(alert.priceCents);

  const lines = [`${price} · ${formatStores(alert.storeName, alert.locationNames)}`];
  if (alert.locationNames.length > 1) {
    lines.push(formatStoreList(alert.locationNames));
  }

  return {
    title: `${KIND_LABEL[alert.kind]}: ${alert.title}`.slice(0, MAX_TITLE),
    body: lines.join('\n'),
    priority: KIND_PRIORITY[alert.kind],
    tags: KIND_TAGS[alert.kind],
    click: alert.url,
  };
}

export async function sendNtfy(topicUrl: string, alert: AlertDetails, http: HttpPolicy): Promise<void> {
  const message = formatNtfy(alert);

  const response = await requestWithPolicy(
    topicUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        Title: message.title,
        Priority: message.priority,
        Tags: message.tags,
        Click: message.click,
      },
      body: message.body,
    },
    http,
  );

  if (!response.ok) {
    throw new Error(`ntfy push failed with status ${response.status}`);
  }
}
