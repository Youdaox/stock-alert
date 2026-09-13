import type { Event } from '../core/differ.js';
import type { HttpPolicy } from '../core/http.js';
import { requestWithPolicy } from '../core/http.js';

interface DiscordEmbed {
  title: string;
  description: string;
  url: string;
}

export function formatEmbed(event: Event): DiscordEmbed {
  return {
    title: `[${event.kind}] ${event.product.title}`,
    description: `Price: $${(event.product.priceCents / 100).toFixed(2)} | Available: ${event.product.available}`,
    url: event.product.url,
  };
}

export async function sendDiscordWebhook(url: string, event: Event, http: HttpPolicy): Promise<void> {
  const response = await requestWithPolicy(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [formatEmbed(event)],
      }),
    },
    http,
  );

  if (!response.ok) {
    throw new Error(`Discord webhook failed with status ${response.status}`);
  }
}
