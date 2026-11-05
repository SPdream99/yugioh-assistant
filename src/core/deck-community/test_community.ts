import { searchYgoproDecks, searchYgoproDecksDetailed, searchMasterDuelDecks, searchKonamiDecks, searchFormatLibraryDecks, findCombos, findCounters } from './community-decks.js';
import { CardDatabase } from '../card-database/ygoprodeck.js';
import { checkDeckLegality } from '../deck-parser/legality.js';
import { parseYdke } from '../deck-parser/ydke.js';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
    throw new Error(message);
  }
  console.log(`ok - ${message}`);
}

async function run() {
  console.log('=== YGOPRODECK COMMUNITY DECKS ===');
  const ygo = await searchYgoproDecks({ archetype: 'Maliss', limit: 3 });
  console.log(ygo.map(d => `${d.name} | ${d.author} | ${d.url} | ${d.counts.main}/${d.counts.extra}/${d.counts.side}`).join('\n'));
  assert(ygo.length > 0, 'YGOPRODeck returns decks');
  assert(ygo.every(d => /^https:\/\/ygoprodeck\.com\/deck\//.test(d.url)), 'every deck carries its canonical page URL');
  assert(ygo.every(d => d.ydke.startsWith('ydke://')), 'every deck carries a ydke link');

  console.log('\n=== ROUND-TRIP INTO THE DECK TOOLS ===');
  const deck = ygo[0];
  const parsed = parseYdke(deck.ydke);
  assert(parsed.main.length === deck.counts.main, 'ydke round-trips the main deck size');
  const legality = await checkDeckLegality(parsed, 'TCG');
  console.log(`legality: valid=${legality.valid}, errors=${legality.errors.length}`);
  assert(typeof legality.valid === 'boolean', 'the community ydke is accepted by ygo_check_legality');

  console.log('\n=== MASTER DUEL META DECKS ===');
  const mdm = await searchMasterDuelDecks({ archetype: 'Maliss', limit: 2 });
  console.log(mdm.map(d => `${d.name} | ${d.url} | unresolved=${d.unresolvedCards ?? 0}`).join('\n'));
  assert(mdm.length > 0, 'Master Duel Meta returns decks');
  assert(mdm.every(d => d.url.startsWith('https://www.masterduelmeta.com/')), 'MDM decks carry absolute URLs');
  assert(mdm.every(d => d.ydke.startsWith('ydke://')), 'MDM decks are converted to ydke');

  console.log('\n=== COMBOS ===');
  const combos = await findCombos({ archetype: 'Dracotail', limit: 2 });
  console.log(`available=${combos.available} archetype=${combos.archetype} corpus=${combos.corpusSize}`);
  console.log(combos.combos[0]?.steps.map(s => `${s.step}. ${s.actions.join(' -> ')}`).join('\n'));
  assert(combos.available, 'combos resolve for a known archetype');
  assert(combos.combos[0].startingCards.length > 0, 'a combo lists its starting cards');
  assert(combos.combos[0].steps.length > 0, 'a combo lists ordered steps');
  assert(combos.combos[0].url.startsWith('https://www.masterduelmeta.com/'), 'a combo carries a source URL');

  const byCard = await findCombos({ card: 'Dracotail Lukias', limit: 3 });
  assert(byCard.available && byCard.combos.length > 0, 'combos can be found by card name');

  const unknown = await findCombos({ archetype: 'ThisArchetypeDoesNotExist', limit: 3 });
  assert(!unknown.available && Array.isArray(unknown.knownArchetypes), 'unknown archetype degrades with a known list, not a fake combo');

  console.log('\n=== KONAMI OFFICIAL DECK RECIPES ===');
  const konamiDecks = (await searchKonamiDecks({ query: 'Maliss', limit: 1 }))[0];
  console.log(konamiDecks?.name, '|', konamiDecks?.url, '|', JSON.stringify(konamiDecks?.counts));
  assert(Boolean(konamiDecks), 'Konami deck search returns a recipe');
  assert(konamiDecks.url.startsWith('https://www.db.yugioh-card.com/'), 'Konami recipe carries an official URL');
  assert(konamiDecks.counts.main >= 40 && konamiDecks.counts.main <= 60, 'Konami main deck size is a real 40-60 list');
  assert(konamiDecks.ydke.startsWith('ydke://'), 'Konami recipe converts to ydke');
  assert((konamiDecks.unresolvedCards ?? 0) === 0, 'Konami card names resolve to passcodes');

  console.log('\n=== FORMAT LIBRARY (retro formats) ===');
  const fl = (await searchFormatLibraryDecks({ query: 'Tomato', limit: 1 }))[0];
  console.log(fl?.name, '|', fl?.format, '|', fl?.url, '|', JSON.stringify(fl?.counts));
  assert(Boolean(fl), 'Format Library returns a retro deck');
  assert(fl.url.startsWith('https://www.formatlibrary.com/decks/'), 'Format Library deck carries a URL');
  assert(fl.counts.main >= 40 && fl.counts.main <= 60, 'Format Library ydk parses into a real main deck');
  assert(fl.ydke.startsWith('ydke://'), 'Format Library deck converts to ydke');

  console.log('\n=== COUNTERS ===');
  const counters = await findCounters({ archetype: 'Evilswarm', limit: 1 });
  console.log(counters.counters[0]?.counterCards, '| chokepoints:', counters.counters[0]?.chokepoints);
  assert(counters.available, 'counters resolve for a known archetype');
  assert((counters.counters[0]?.counterCards.length ?? 0) > 0, 'a counter entry lists counter cards');
  assert(counters.counters[0].url.startsWith('https://www.masterduelmeta.com/'), 'a counter entry carries a source URL');

  const countersByCard = await findCounters({ card: 'Effect Veiler', limit: 3 });
  assert(countersByCard.available, 'counters can be found by counter card name');

  console.log('\n=== CATEGORY TAXONOMY + FILTERS ===');
  const cat = await searchYgoproDecksDetailed({ category: 'type/elfnote', limit: 2 });
  console.log(cat.categoryUrl, '|', cat.decks.map(d => d.name).join(' | '));
  assert(cat.decks.length > 0, '/category/type/<slug> resolves to decks');
  assert(cat.categoryUrl === 'https://ygoprodeck.com/category/type/elfnote', 'the category URL is rebuilt and returned');
  assert(cat.appliedFilters.archetype === 'Elfnote', 'the slug maps to the archetype filter');

  const byPrice = await searchYgoproDecksDetailed({ archetype: 'Maliss', maxPrice: 100, limit: 3 });
  assert(byPrice.decks.length > 0, 'price filter returns decks');
  assert(byPrice.decks.every(d => (d.priceUsd ?? 0) <= 100), 'maxPrice respected on the source data');

  const byDate = await searchYgoproDecksDetailed({ archetype: 'Maliss', from: '2026-10-01', limit: 3 });
  assert(byDate.decks.length > 0, 'date filter returns decks');
  assert(byDate.appliedFilters.from === '2026-10-01', 'applied date filter is echoed back');

  const byContains = await searchYgoproDecksDetailed({ containsCard: 'Droll & Lock Bird', limit: 2 });
  const containsPasscode = (byContains.appliedFilters.containsCard as any)?.passcode;
  console.log('containsCard resolved to passcode', containsPasscode);
  assert(byContains.decks.length > 0, 'containsCard resolves the name to a passcode');
  assert(containsPasscode === 94145021, 'Droll & Lock Bird resolves to 94145021, not a lookalike');

  // YGOPRODeck matches the card entity, which can carry alternate passcodes
  // (94145022 also resolves to Droll & Lock Bird). Resolve names instead of
  // comparing one numeric id.
  const db = CardDatabase.getInstance();
  const ids = [...new Set(byContains.decks.flatMap(d => [...d.cards.main, ...d.cards.extra, ...d.cards.side]))];
  const unresolved = ids.filter(id => !db.getCardById(id));
  if (unresolved.length > 0) {
    const resp = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${unresolved.slice(0, 100).join(',')}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const json: any = await resp.json().catch(() => ({}));
    for (const card of json?.data || []) db.cards.set(card.id, card);
  }
  const deckHasName = (deck: (typeof byContains.decks)[number], name: string) =>
    [...deck.cards.main, ...deck.cards.extra, ...deck.cards.side].some(
      id => (db.getCardById(id)?.name || '').toLowerCase() === name.toLowerCase()
    );
  console.log(byContains.decks.map(d => `${d.name}: ${deckHasName(d, 'Droll & Lock Bird')}`).join(' | '));
  assert(byContains.decks.every(d => deckHasName(d, 'Droll & Lock Bird')), 'every returned deck really contains the card');

  console.log('\nAll community-deck checks passed.');
}

run().catch(err => {
  console.error('Community deck test failed:', err);
  process.exit(1);
});

