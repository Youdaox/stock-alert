import type { StockStatus } from '../adapters/types.js';
import type { EventKind } from '../core/differ.js';
import type { HttpPolicy } from '../core/http.js';
import { requestWithPolicy } from '../core/http.js';

export interface AlertDetails {
  kind: EventKind;
  title: string;
  url: string;
  imageUrl: string | null;
  storeName: string;
  locationName: string | null;
  status: StockStatus;
  priceCents: number | null;
  prevPriceCents: number | null;
  occurredAt: Date;
}

interface DiscordEmbed {
  title: string;
  url: string;
  color: number;
  fields: { name: string; value: string; inline: boolean }[];
  thumbnail?: { url: string };
  timestamp: string;
}

const KIND_STYLE: Record<EventKind, { label: string; color: number }> = {
  NEW_PRODUCT: { label: 'New listing', color: 0x5865f2 },
  RESTOCK: { label: 'Back in stock', color: 0x2ecc71 },
  PRICE_DROP: { label: 'Price drop', color: 0xf1c40f },
  SOLD_OUT: { label: 'Sold out', color: 0x95a5a6 },
};

const nzd = new Intl.NumberFormat('en-NZ', { style: 'currency', currency: 'NZD' });

export const formatNzd = (cents: number | null): string => (cents === null ? 'Unknown' : nzd.format(cents / 100));

export function formatEmbed(alert: AlertDetails): DiscordEmbed {
  const style = KIND_STYLE[alert.kind];
  const store =
    alert.locationName && alert.locationName !== 'Online'
      ? `${alert.storeName} — ${alert.locationName}`
      : alert.storeName;
  // Show the old price on any alert where it dropped, so a restock needs no separate price message.
  const dropped =
    alert.prevPriceCents !== null && alert.priceCents !== null && alert.prevPriceCents > alert.priceCents;
  const price = dropped
    ? `~~${formatNzd(alert.prevPriceCents)}~~ → **${formatNzd(alert.priceCents)}**`
    : formatNzd(alert.priceCents);

  return {
    title: `${style.label}: ${alert.title}`.slice(0, 256),
    url: alert.url,
    color: style.color,
    fields: [
      { name: 'Store', value: store, inline: true },
      { name: 'Price', value: price, inline: true },
      { name: 'Status', value: alert.status === 'IN_STOCK' ? 'In stock' : 'Out of stock', inline: true },
    ],
    ...(alert.imageUrl ? { thumbnail: { url: alert.imageUrl } } : {}),
    timestamp: alert.occurredAt.toISOString(),
  };
}

export async function sendDiscordWebhook(url: string, alert: AlertDetails, http: HttpPolicy): Promise<void> {
  const response = await requestWithPolicy(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [formatEmbed(alert)] }),
    },
    http,
  );

  if (!response.ok) {
    throw new Error(`Discord webhook failed with status ${response.status}`);
  }
}
