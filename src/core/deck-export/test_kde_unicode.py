#!/usr/bin/env python3
"""
Regression test: the KDE decklist filler must write Unicode (Vietnamese) names
and must generate Type0 appearance streams for them.

Run: python src/core/deck-export/test_kde_unicode.py
Exit code 0 = pass, 1 = fail.
"""

import json
import os
import sys
import tempfile

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, os.path.join(BASE, "src", "core", "deck-export"))

from fill_kde_decklist_pdf import fill_kde_decklist  # noqa: E402


def main():
    from pypdf import PdfReader

    tmpdir = tempfile.mkdtemp(prefix="kde_unicode_")
    deck_json = os.path.join(tmpdir, "deck.json")
    out_pdf = os.path.join(tmpdir, "out.pdf")

    with open(deck_json, "w", encoding="utf-8") as f:
        json.dump(
            {
                "deckName": "Unicode Test",
                "monsters": [{"count": 3, "name": "Ehther the Heavenly Monarch"}],
                "spells": [{"count": 1, "name": "Domain of the True Monarchs"}],
                "traps": [],
                "extra": [],
                "side": [],
            },
            f,
            ensure_ascii=False,
        )

    result = fill_kde_decklist(
        deck_json,
        out_pdf,
        {
            "duelistName": "Nguyễn Văn A",
            "firstName": "Văn A",
            "lastName": "Nguyễn",
            "country": "Việt Nam",
            "eventName": "Giải Vô Địch Mẫu",
            "eventDate": "2026-11-05",
            "cardGameId": "0000000000",
        },
    )

    assert result["success"], "fill_kde_decklist returned success=false"
    assert os.path.exists(out_pdf), "output PDF was not created"

    expected = {
        "First  Middle Names": "Văn A",
        "Last Names": "Nguyễn",
        "Country of Residency": "Việt Nam",
        "Event Name": "Giải Vô Địch Mẫu",
        "Main Deck Total": "4",
    }

    reader = PdfReader(out_pdf)
    fields = {}
    fonts = {}
    for annot in reader.pages[0]["/Annots"]:
        obj = annot.get_object()
        name = obj.get("/T")
        if not name:
            continue
        fields[name] = str(obj.get("/V", ""))
        try:
            ap_fonts = obj["/AP"]["/N"].get_object()["/Resources"]["/Font"]
            fonts[name] = [ap_fonts[k].get_object().get("/Subtype") for k in ap_fonts]
        except Exception:
            fonts[name] = []

    failures = []
    for key, want in expected.items():
        got = fields.get(key)
        if got != want:
            failures.append(f"{key}: expected {want!r}, got {got!r}")

    for key in ("First  Middle Names", "Last Names", "Country of Residency", "Event Name"):
        subtypes = fonts.get(key, [])
        if "/Type0" not in subtypes:
            failures.append(f"{key}: expected a /Type0 appearance font, got {subtypes}")

    if failures:
        print("FAIL")
        for f in failures:
            print(" -", f)
        return 1

    print("PASS: Unicode values written and rendered with Type0 fonts")
    print("  engine:", result.get("engine"))
    print("  pdf:", out_pdf)
    return 0


if __name__ == "__main__":
    sys.exit(main())
