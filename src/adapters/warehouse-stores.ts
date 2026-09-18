import { parse } from 'node-html-parser';

/**
 * The Warehouse's PDP "Find in-store" panel calls Stores-PDPStoreAvailability, which answers
 * JSON whose `stores` field is an HTML fragment: one panel per store carrying a status class
 * such as store-availability__IN_STOCK.
 */
export interface StoreAvailability {
  storeId: string;
  name: string;
  /** The raw status token, e.g. IN_STOCK, LOW_STOCK, OUT_OF_STOCK. */
  status: string;
  inStock: boolean;
  address?: string;
  phone?: string;
}

const STATUS_CLASS = /store-availability__([A-Z_]+)/;
const STORE_ID = /c-full-store-details-(\d+)/;

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim();

export function parseStoreAvailability(html: string): StoreAvailability[] {
  const root = parse(html);
  const stores: StoreAvailability[] = [];

  for (const panel of root.querySelectorAll('div.store.panel')) {
    const name = clean(panel.querySelector('.store-details-title h6')?.text ?? '');
    const statusNode = panel.querySelector('.store-availability');
    const status = STATUS_CLASS.exec(statusNode?.getAttribute('class') ?? '')?.[1];

    const idSource =
      panel.querySelector('[data-target^="#c-full-store-details-"]')?.getAttribute('data-target') ??
      panel.querySelector('[id^="c-full-store-details-"]')?.getAttribute('id') ??
      '';
    const storeId = STORE_ID.exec(idSource)?.[1];

    if (!name || !status || !storeId) {
      continue;
    }

    const details = panel.querySelectorAll('.expanded-store-details p').map((node) => clean(node.text));
    const address = details.find((line) => /,/.test(line) && !/^phone/i.test(line));
    const phone = details.find((line) => /^phone/i.test(line))?.replace(/^phone:\s*/i, '');

    stores.push({
      storeId,
      name,
      status,
      inStock: status === 'IN_STOCK',
      ...(address ? { address } : {}),
      ...(phone ? { phone } : {}),
    });
  }

  return stores;
}
