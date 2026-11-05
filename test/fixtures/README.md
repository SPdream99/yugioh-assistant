# Test fixtures

These files are **synthetic**. They mirror the markup/JSON shape each parser
reads, but contain neutral names (`Alpha`, `Beta`, `Archetype A`) and no real card
data, usernames or captured pages. Nothing here is copied from Yuyu-tei, Konami,
TCGCSV, TCGCorner, Format Library or Master Duel Meta.

| File | Shape |
| --- | --- |
| `yuyutei-alpha.html` | Yuyu-tei `card-product` blocks (set code, rarity, yen) |
| `konami-recipe.html` | deck tables (`monster_list`, `extra_list`, `side_list`) |
| `tcgcsv-alpha.json` | per-product Number/Rarity + market price |
| `tcgcorner-suggest.json` | Shopify suggest products (one match, one unrelated) |
| `formatlibrary-deck.json` | deck metadata + a generated `ydk` |
| `mdm-combos.json`, `mdm-counters.json` | combo steps and counter structure |

Regenerate with:

```bash
npm run fixtures:refresh
```

If you need to debug against a real response, keep that file **out of the
repository** — do not commit captured third-party content.
