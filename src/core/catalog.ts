export type Category =
  | 'ETB'
  | 'BOOSTER_BOX'
  | 'BOOSTER_BUNDLE'
  | 'BOOSTER_PACK'
  | 'TIN'
  | 'COLLECTION'
  | 'DECK'
  | 'OTHER';

export type Language = 'EN' | 'JP' | 'OTHER';

export interface CatalogInput {
  title: string;
  vendor?: string;
  productType?: string;
  tags: readonly string[];
}

export const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

const EXCLUDED_TAGS = new Set([
  'single',
  'singles',
  'pokemon single',
  'pokemon singles',
  'slab',
  'slabs',
  'graded',
  'psa',
  'cgc',
  'bgs',
  'bulk',
  'supplies',
  'accessories',
  'binder',
  'binders',
  'binders and portfolios',
  'sleeves',
  'playmat',
  'playmats',
  'deck boxes',
  'games',
  'video games',
  'nintendo switch',
  'plush',
  'action figures',
  'action battling',
  'figures',
  'figures & playsets',
  'figures and playsets',
]);

const EXCLUDED_PRODUCT_TYPE_WORDS = [
  'single',
  'graded',
  'accessor',
  'supplies',
  'binder',
  'playmat',
  'sleeves',
  'deck box',
  'video game',
  'plush',
];

const EXCLUDED_TITLE_PATTERNS = [
  // Graded cards.
  /\b(psa|cgc|bgs|beckett|pcg|asg)\s*\d{1,2}(\.\d)?\b/,
  /\bgraded\b/,
  /\bslab\b/,
  // Card numbers such as "083/088" only appear on singles.
  /\b\d{1,3}\s*\/\s*\d{2,3}\b/,
  /\bcode cards?\b/,
  // Accessories. "Sleeved booster" packs are sealed, so only plain "sleeves" is excluded.
  /\bdeck box\b/,
  /\bflip box\b/,
  /\balcove\b/,
  /\bbinder\b/,
  /\bportfolio\b/,
  /\bplaymat\b/,
  /\balbum\b/,
  /\bfolder\b/,
  /\btoploaders?\b/,
  /\bsleeves\b/,
  /\bcard file\b/,
  /\bultra pro\b/,
  // Toys, board games and bulk card lots.
  /\bmonopoly\b/,
  /\bguess who\b/,
  /\blego\b/,
  /\bmega (bloks|construx)\b/,
  /\bplush\b/,
  /\b\d+\s+(japanese\s+)?pokemon cards\b/,
];

export interface SealedFilterOptions {
  /** Require "pokemon" somewhere in the listing. Turn off for Pokémon-only collections. */
  requireKeyword: boolean;
}

export function isPokemonSealed(input: CatalogInput, options: SealedFilterOptions): boolean {
  const title = normalize(input.title);
  const productType = normalize(input.productType ?? '');
  const tags = input.tags.map(normalize);

  if (options.requireKeyword) {
    const haystack = [title, normalize(input.vendor ?? ''), productType, ...tags].join(' | ');
    if (!haystack.includes('pokemon')) {
      return false;
    }
  }

  if (tags.some((tag) => EXCLUDED_TAGS.has(tag))) {
    return false;
  }

  if (EXCLUDED_PRODUCT_TYPE_WORDS.some((word) => productType.includes(word))) {
    return false;
  }

  return !EXCLUDED_TITLE_PATTERNS.some((pattern) => pattern.test(title));
}

export function categorize(title: string, productType?: string): Category {
  const text = normalize(`${title} ${productType ?? ''}`);

  if (/elite trainer box|\betb\b/.test(text)) return 'ETB';
  if (/booster bundle/.test(text)) return 'BOOSTER_BUNDLE';
  if (/booster (box|display)|display box|\bcase\b/.test(text)) return 'BOOSTER_BOX';
  if (/build (&|and) battle|battle academy|theme deck|battle deck|starter deck|league battle|\bdecks?\b/.test(text)) {
    return 'DECK';
  }
  if (/\btins?\b/.test(text)) return 'TIN';
  if (/blister|booster pack|sleeved booster|\bboosters?\b|\bpacks?\b/.test(text)) return 'BOOSTER_PACK';
  if (/collection|premium|collector'?s? chest|trainer'?s toolkit|special set|\bbox\b|bundle|gift/.test(text)) {
    return 'COLLECTION';
  }
  return 'OTHER';
}

export function detectLanguage(title: string, tags: readonly string[]): Language {
  const text = normalize([title, ...tags].join(' | '));

  if (/japanese|\bjpn?\b/.test(text)) return 'JP';
  if (/chinese|korean|\bkor\b|\bchn\b/.test(text)) return 'OTHER';
  return 'EN';
}
