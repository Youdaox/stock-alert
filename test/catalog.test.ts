import { describe, expect, it } from 'vitest';

import { categorize, detectLanguage, isPokemonSealed } from '../src/core/catalog.js';

const collection = { requireKeyword: false };
const keyword = { requireKeyword: true };

describe('isPokemonSealed', () => {
  it('keeps sealed products', () => {
    expect(
      isPokemonSealed(
        { title: 'Mega Evolution Elite Trainer Box', productType: 'Elite Trainer Box', tags: ['Mega Evolution'] },
        collection,
      ),
    ).toBe(true);
  });

  it('keeps sleeved boosters even though they mention sleeves', () => {
    expect(
      isPokemonSealed({ title: 'Chaos Rising Sleeved Booster', tags: ['Pokemon', 'Booster Pack'] }, collection),
    ).toBe(true);
  });

  it('drops singles by tag and by card number', () => {
    expect(
      isPokemonSealed({ title: 'Potion - Perfect Order - 083/088 - Common', tags: ['Pokemon', 'Single'] }, collection),
    ).toBe(false);
    expect(isPokemonSealed({ title: "Iris's Fighting Spirit - 190/217", tags: ['Pokemon'] }, collection)).toBe(false);
  });

  it('drops graded slabs and accessories', () => {
    expect(isPokemonSealed({ title: 'PSA 9 MINT Mew EX Gold Promo', tags: ['Pokemon', 'Slab'] }, collection)).toBe(
      false,
    );
    expect(isPokemonSealed({ title: 'Charizard', productType: 'Graded Pokemon Card', tags: [] }, collection)).toBe(
      false,
    );
    expect(
      isPokemonSealed({ title: 'Ultra Pro Greninja Binder', tags: ['Binders', 'Pokemon', 'Supplies'] }, collection),
    ).toBe(false);
  });

  it.each([
    'ULTRA PRO Pokémon - Togepi Holiday Alcove Flip Deck Box',
    'ULTRA PRO Pokémon Elite Series - Lucario 9-Pocket PRO Binder Folder',
    'ULTRA PRO Pokémon - Playmat - Gallery Series: Seaside',
    'POKEMON PORTFOLIO 9 POCKET PIKACHU & MIMIKYU',
    'Pokemon Go Card File Set *Japanese*',
    'LEGO Pokémon Eevee',
    'MEGA BLOKS - Pokemon: Kanto Region Team, 130 Piece Building Toy Set',
    '100 Pokemon Cards + Bonus',
    '50 Japanese Pokémon Cards',
    'Charizard Metal - PCG 9',
    '**CLEARANCE** Monopoly: Pokémon Edition',
    'Guess Who? Pokemon Edition',
    'Pokemon Trainer Guess - Kanto Edition',
    'Pokemon Trainer Guess Electronic Guessing Game Sinnoh Edition',
  ])('drops accessories, toys, bulk lots and graded cards: %s', (title) => {
    expect(isPokemonSealed({ title, tags: [] }, collection)).toBe(false);
  });

  it('drops video games', () => {
    expect(
      isPokemonSealed({ title: 'Mario Kart World', tags: ['Games', 'Nintendo Switch', 'Pokemon'] }, collection),
    ).toBe(false);
  });

  it('requires the keyword only when asked to, accent-insensitively', () => {
    const gundam = { title: 'Resource Token Set', productType: 'Gundam Card Game', tags: [] };
    expect(isPokemonSealed(gundam, keyword)).toBe(false);
    expect(isPokemonSealed({ title: 'Pokémon TCG Prismatic Evolutions Booster Bundle', tags: [] }, keyword)).toBe(true);
  });
});

describe('categorize', () => {
  it.each([
    ['Prismatic Evolutions Elite Trainer Box', 'ETB'],
    ['Mega Evolution Booster Bundle', 'BOOSTER_BUNDLE'],
    ['Surging Sparks Booster Box (36 packs)', 'BOOSTER_BOX'],
    ['Build & Battle Box', 'DECK'],
    ['Pokemon Stacking Tin', 'TIN'],
    ['Chaos Rising Sleeved Booster', 'BOOSTER_PACK'],
    ['Charizard ex Premium Collection', 'COLLECTION'],
    ['POKÉMON TCG 2022 Collectors Chest', 'COLLECTION'],
    ["Battle Styles Collector's Chest", 'COLLECTION'],
    ["POKÉMON TCG 2024 Trainer's Toolkit", 'COLLECTION'],
    ['Pokemon Battle Academy Board Game 2024', 'DECK'],
    ['Pikachu Poster', 'OTHER'],
  ])('%s -> %s', (title, expected) => {
    expect(categorize(title)).toBe(expected);
  });
});

describe('detectLanguage', () => {
  it('detects Japanese products from the title or tags', () => {
    expect(detectLanguage('Terastal Festival Booster Box (Japanese)', [])).toBe('JP');
    expect(detectLanguage('Terastal Festival Booster Box', ['JP'])).toBe('JP');
    expect(detectLanguage('Surging Sparks Booster Box', ['English'])).toBe('EN');
  });
});
