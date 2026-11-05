import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Generates the synthetic fixtures used by `npm run test:fixtures`.
 *
 * They are deliberately synthetic: the committed repository must not contain
 * captured third-party pages. Each file mirrors the markup/JSON shape the parser
 * reads, with neutral names ("Alpha", "Beta") and no real card data.
 *
 *   node scripts/make-fixtures.mjs
 */

const DIR = path.join(process.cwd(), 'test', 'fixtures');

const yuyu = `<!doctype html>
<html><body>
<div class="card-product position-relative mt-4">
  <a href="https://yuyu-tei.jp/sell/ygo/card/test/1"><h4>Alpha</h4></a>
  <span class="d-block border border-dark p-1 w-100 text-center my-2">TST-JP001</span>
  <img src="https://cdn.example/test1.jpg" alt="TST-JP001 UR Alpha" />
  <strong class="d-block text-end">1,200 円</strong>
</div>
<div class="card-product position-relative mt-4">
  <a href="https://yuyu-tei.jp/sell/ygo/card/test/2"><h4>Alpha</h4></a>
  <span class="d-block border border-dark p-1 w-100 text-center my-2">TST-JP002</span>
  <img src="https://cdn.example/test2.jpg" alt="TST-JP002 SR Alpha" />
  <strong class="d-block text-end">2,400 円</strong>
</div>
<div class="card-product position-relative mt-4">
  <a href="https://yuyu-tei.jp/sell/ygo/card/test/3"><h4>Alpha</h4></a>
  <span class="d-block border border-dark p-1 w-100 text-center my-2">TST-JP003</span>
  <img src="https://cdn.example/test3.jpg" alt="TST-JP003 P-HR Alpha" />
  <strong class="d-block text-end">3,600 円</strong>
</div>
</body></html>
`;

function konamiTable(id, rowCount, count, header) {
  const body = Array.from({ length: rowCount })
    .map(
      (_, index) =>
        `<tr><td class="row_num">${index + 1}</td><td class="card_name"><div class="icon"><span>Alpha</span></div></td><td class="num"><span>${count}</span></td></tr>`
    )
    .join('\n');
  return `<table id="${id}"><tr><th colspan="3">${header}</th><th class="num"><span>${rowCount * count}</span></th></tr>${body}</table>`;
}

const konami = `<html><body>
${konamiTable('monster_list', 20, 2, 'Monster Cards')}
${konamiTable('extra_list', 15, 1, 'Extra Deck')}
${konamiTable('side_list', 7, 1, 'Side Deck')}
</body></html>
`;

const tcgcsv = {
  groupId: 1,
  products: [
    { productId: 1, name: 'Alpha', url: 'https://example.test/alpha', extendedData: [{ name: 'Number', value: 'TST-001' }, { name: 'Rarity', value: 'Super Rare' }] },
    { productId: 2, name: 'Alpha (UR)', url: 'https://example.test/alpha-ur', extendedData: [{ name: 'Number', value: 'TST-002' }, { name: 'Rarity', value: 'Ultra Rare' }] },
    { productId: 3, name: 'Alpha (Secret Rare)', url: 'https://example.test/alpha-scr', extendedData: [{ name: 'Number', value: 'TST-003' }, { name: 'Rarity', value: 'Secret Rare' }] }
  ],
  prices: [
    { productId: 1, marketPrice: 1.5 },
    { productId: 2, marketPrice: 2.5 },
    { productId: 3, marketPrice: 6.0 }
  ]
};

const tcgcorner = {
  products: [
    { title: 'Alpha (TST-001)', price: '12.00', available: true, url: '/products/alpha' },
    { title: 'Plush Toy', price: '9.99', available: true, url: '/products/plush' }
  ]
};

const formatlibrary = {
  deck: { id: 1, deckTypeName: 'Archetype A', formatName: 'Test Format', builderName: 'fixture-builder' },
  ydk: ['#created by fixture', '#main', ...Array(40).fill('990000001'), '#extra', ...Array(10).fill('990000002'), '!side', ...Array(5).fill('990000003')].join('\n')
};

const combos = [
  {
    _id: 'combo-a',
    title: 'Combo A',
    deckType: { _id: 'dt-a', name: 'Archetype A' },
    startingCards: [{ card: { name: 'Alpha' } }],
    steps: [{ entries: [{ card: { name: 'Alpha' }, label: 'Summon' }, { card: { name: 'Beta' }, label: 'Add to hand' }] }],
    notes: 'Line A',
    upvotes: 3
  }
];

const counters = [
  {
    _id: 'counter-a',
    author: { username: 'fixture-user' },
    deckType: { _id: 'dt-a', name: 'Archetype A' },
    counterCards: [{ card: { name: 'Beta' }, impact: 'High' }],
    chokepoints: [{ card: { name: 'Alpha' } }],
    chokepointExplanation: 'Stop Alpha.',
    explanation: 'Use Beta.',
    upvotes: ['user-1', 'user-2']
  }
];

async function main() {
  await fs.mkdir(DIR, { recursive: true });
  const write = async (name, content) => {
    await fs.writeFile(path.join(DIR, name), content, 'utf8');
    console.log(name);
  };
  await write('yuyutei-alpha.html', yuyu);
  await write('konami-recipe.html', konami);
  await write('tcgcsv-alpha.json', JSON.stringify(tcgcsv, null, 1));
  await write('tcgcorner-suggest.json', JSON.stringify(tcgcorner, null, 1));
  await write('formatlibrary-deck.json', JSON.stringify(formatlibrary, null, 1));
  await write('mdm-combos.json', JSON.stringify(combos, null, 1));
  await write('mdm-counters.json', JSON.stringify(counters, null, 1));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
