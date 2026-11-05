#!/usr/bin/env python3
"""
Official Konami Decklist PDF Form Filler
Fills the official KDE_DeckList.pdf AcroForm template directly, preserving authentic Konami branding and layout.

Unicode / Vietnamese support
----------------------------
PyMuPDF is used to fill the fields. It regenerates every field's appearance
stream with an embedded Type0 (Identity-H) font, and automatically falls back
to a Unicode font for glyphs Helvetica does not contain (ậ, ễ, ữ, ơ, ư, đ, ...).
That keeps the Vietnamese text correct in Adobe Acrobat, Chrome/Edge, Foxit and
PyMuPDF itself instead of writing 2-byte text into a 1-byte Helvetica field.

A pypdf fallback is kept for environments without PyMuPDF, but it is only
allowed for pure-ASCII data (pypdf would corrupt non-ASCII glyphs).
"""

import sys
import os
import json
import argparse
from datetime import datetime

DEFAULT_TEMPLATE_PATH = os.path.join(os.getcwd(), "data", "templates", "KDE_DeckList.pdf")
PACKAGE_TEMPLATE_PATH = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "data", "templates", "KDE_DeckList.pdf")
)


def get_template_path(override=None):
    candidates = [
        override,
        os.environ.get("YGO_KDE_TEMPLATE"),
        DEFAULT_TEMPLATE_PATH,
        PACKAGE_TEMPLATE_PATH,
    ]
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    raise FileNotFoundError(
        "KDE_DeckList.pdf not found. Put it in data/templates/ or set YGO_KDE_TEMPLATE."
    )


def _has_non_ascii(value):
    try:
        str(value).encode("ascii")
        return False
    except UnicodeEncodeError:
        return True


def _ensure_parent(path):
    parent = os.path.dirname(os.path.abspath(path))
    if parent:
        os.makedirs(parent, exist_ok=True)


def _measurement_font():
    """A font with Vietnamese glyphs, used to estimate text width before rendering."""
    import pymupdf

    for candidate in (
        r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\tahoma.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ):
        if os.path.exists(candidate):
            try:
                return pymupdf.Font(fontfile=candidate)
            except Exception:
                pass
    try:
        return pymupdf.Font("helv")
    except Exception:
        return None


def _fitted_font_size(widget, text, cap=18.88):
    """Shrink the font until the text fits the widget width (prevents clipping)."""
    avail = max(10.0, float(widget.rect.width) - 4.0)
    default = min(cap, max(6.0, float(widget.rect.height) - 2.0))
    font = _measurement_font()
    if font is None:
        return default
    size = default
    try:
        while size > 6.0 and font.text_length(str(text), fontsize=size) * 1.05 > avail:
            size -= 0.25
    except Exception:
        return default
    return round(size, 2)


def _fill_with_pymupdf(template_path, field_values, output_pdf_path):
    """Fill the AcroForm with PyMuPDF so Unicode glyphs get a proper font."""
    import pymupdf  # imported lazily so ASCII-only users can run without it

    doc = pymupdf.open(template_path)
    filled = 0
    for page in doc:
        for widget in page.widgets():
            name = widget.field_name
            if name is None or name not in field_values:
                continue
            value = field_values[name]
            text = "" if value is None else str(value)
            try:
                widget.field_value = text
                if text:
                    try:
                        widget.text_fontsize = _fitted_font_size(widget, text)
                    except Exception:
                        pass
                widget.update()
                filled += 1
            except Exception:
                # Non-text widgets (buttons) reject string values; leave them alone.
                continue
    _ensure_parent(output_pdf_path)
    doc.save(output_pdf_path, garbage=3, deflate=True)
    doc.close()
    return filled


def _fill_with_pypdf(template_path, field_values, output_pdf_path):
    """Legacy fallback. Only safe for ASCII text."""
    import pypdf
    from pypdf.generic import BooleanObject, NameObject

    reader = pypdf.PdfReader(template_path)
    writer = pypdf.PdfWriter()
    writer.append(reader)

    writer.update_page_form_field_values(writer.pages[0], field_values)

    # Force PDF viewers to render form appearance
    try:
        catalog = writer._root_object
        if "/AcroForm" in catalog:
            catalog["/AcroForm"].update({NameObject("/NeedAppearances"): BooleanObject(True)})
    except Exception:
        pass

    _ensure_parent(output_pdf_path)
    with open(output_pdf_path, "wb") as f:
        writer.write(f)


def fill_kde_decklist(deck_json_path, output_pdf_path, duelist_info=None, template_path=None):
    if duelist_info is None:
        duelist_info = {}

    template_path = get_template_path(template_path)

    with open(deck_json_path, "r", encoding="utf-8") as f:
        deck_data = json.load(f)

    monsters = deck_data.get("monsters", [])
    spells = deck_data.get("spells", [])
    traps = deck_data.get("traps", [])
    extra_deck = deck_data.get("extra", [])
    side_deck = deck_data.get("side", [])

    total_monsters = sum(c.get("count", 1) for c in monsters)
    total_spells = sum(c.get("count", 1) for c in spells)
    total_traps = sum(c.get("count", 1) for c in traps)
    total_main = total_monsters + total_spells + total_traps
    total_extra = sum(c.get("count", 1) for c in extra_deck)
    total_side = sum(c.get("count", 1) for c in side_deck)

    # Date parsing
    event_date_str = duelist_info.get("eventDate", "")
    month, day, year = "", "", ""
    if event_date_str:
        try:
            parts = event_date_str.replace("/", "-").split("-")
            if len(parts) == 3:
                if len(parts[0]) == 4:  # YYYY-MM-DD
                    year, month, day = parts[0], parts[1], parts[2]
                else:  # MM-DD-YYYY
                    month, day, year = parts[0], parts[1], parts[2]
        except Exception:
            pass
    if not month:
        now = datetime.now()
        month = f"{now.month:02d}"
        day = f"{now.day:02d}"
        year = str(now.year)

    # Name parsing: explicit firstName/lastName always win over the auto split.
    full_name = duelist_info.get("duelistName", "Duelist")
    first_middle = duelist_info.get("firstName", "") or ""
    last_name = duelist_info.get("lastName", "") or ""
    last_initial = ""

    if not first_middle and not last_name:
        parts = full_name.strip().split()
        if len(parts) == 1:
            first_middle = parts[0]
            last_name = parts[0]
            last_initial = parts[0][0].upper()
        else:
            first_middle = " ".join(parts[:-1])
            last_name = parts[-1]
            last_initial = last_name[0].upper()
    else:
        # Only one half was supplied: keep the other half empty instead of guessing.
        last_initial = last_name[0].upper() if last_name else (first_middle[0].upper() if first_middle else "D")

    field_values = {
        "First  Middle Names": first_middle,
        "Last Names": last_name,
        "Last Name Initial": last_initial or "D",
        "Country of Residency": duelist_info.get("country", "Vietnam"),
        "CARD GAME ID": str(duelist_info.get("cardGameId", "")),
        "Event Name": str(duelist_info.get("eventName", "Regional Qualifier / YCS")),
        "Event Date - Month": str(month),
        "Event Date - Day": str(day),
        "Event Date - Year": str(year),
        "Total Monster Cards": str(total_monsters),
        "Total Spell Cards": str(total_spells),
        "Total Trap Cards": str(total_traps),
        "Main Deck Total": str(total_main),
        "Total Extra Deck": str(total_extra),
        "Total Side Deck": str(total_side),
    }

    # Fill Monsters (up to 18 rows)
    for i in range(18):
        idx = i + 1
        name_key = f"Monster {idx}"
        count_key = f"Monster Card {idx} Count"
        if i < len(monsters):
            c = monsters[i]
            field_values[name_key] = c.get("name", "")
            field_values[count_key] = str(c.get("count", 1))
        else:
            field_values[name_key] = ""
            field_values[count_key] = ""

    # Fill Spells (up to 18 rows)
    for i in range(18):
        idx = i + 1
        name_key = f"Spell {idx}"
        count_key = f"Spell Card {idx} Count"
        if i < len(spells):
            c = spells[i]
            field_values[name_key] = c.get("name", "")
            field_values[count_key] = str(c.get("count", 1))
        else:
            field_values[name_key] = ""
            field_values[count_key] = ""

    # Fill Traps (up to 18 rows)
    for i in range(18):
        idx = i + 1
        name_key = f"Trap {idx}"
        count_key = f"Trap Card {idx} Count"
        if i < len(traps):
            c = traps[i]
            field_values[name_key] = c.get("name", "")
            field_values[count_key] = str(c.get("count", 1))
        else:
            field_values[name_key] = ""
            field_values[count_key] = ""

    # Fill Extra Deck (up to 15 rows)
    for i in range(15):
        idx = i + 1
        name_key = f"Extra Deck {idx}"
        count_key = f"Extra Deck {idx} Count"
        if i < len(extra_deck):
            c = extra_deck[i]
            field_values[name_key] = c.get("name", "")
            field_values[count_key] = str(c.get("count", 1))
        else:
            field_values[name_key] = ""
            field_values[count_key] = ""

    # Fill Side Deck (up to 15 rows)
    for i in range(15):
        idx = i + 1
        name_key = f"Side Deck {idx}"
        count_key = f"Side Deck {idx} Count"
        if i < len(side_deck):
            c = side_deck[i]
            field_values[name_key] = c.get("name", "")
            field_values[count_key] = str(c.get("count", 1))
        else:
            field_values[name_key] = ""
            field_values[count_key] = ""

    # --- Write the form -----------------------------------------------------
    try:
        _fill_with_pymupdf(template_path, field_values, output_pdf_path)
        engine = "pymupdf"
    except ImportError:
        if any(_has_non_ascii(v) for v in field_values.values()):
            raise RuntimeError(
                "PyMuPDF is required to render non-ASCII text (Vietnamese, etc.) "
                "correctly. Install it with: pip install pymupdf"
            )
        _fill_with_pypdf(template_path, field_values, output_pdf_path)
        engine = "pypdf"

    return {
        "success": True,
        "pdfPath": output_pdf_path,
        "engine": engine,
        "totalMain": total_main,
        "totalMonsters": total_monsters,
        "totalSpells": total_spells,
        "totalTraps": total_traps,
        "totalExtra": total_extra,
        "totalSide": total_side,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fill official KDE_DeckList.pdf form")
    parser.add_argument("--deck-json", required=True, help="Path to deck categorised JSON")
    parser.add_argument("--output", required=True, help="Output PDF file path")
    parser.add_argument("--template", default=None, help="Path to a local KDE_DeckList.pdf copy")
    parser.add_argument("--duelist-name", default="Duelist", help="Duelist Name")
    parser.add_argument("--first-name", default="", help="First and Middle Name")
    parser.add_argument("--last-name", default="", help="Last Name")
    parser.add_argument("--card-game-id", default="", help="Konami Card Game ID")
    parser.add_argument("--event-name", default="Regional Qualifier / YCS", help="Event Name")
    parser.add_argument("--deck-name", default="Meta Deck", help="Deck Name")
    parser.add_argument("--event-date", default="", help="Event Date")
    parser.add_argument("--country", default="Vietnam", help="Country of Residency")

    args = parser.parse_args()

    duelist_info = {
        "duelistName": args.duelist_name,
        "firstName": args.first_name,
        "lastName": args.last_name,
        "cardGameId": args.card_game_id,
        "eventName": args.event_name,
        "deckName": args.deck_name,
        "eventDate": args.event_date,
        "country": args.country,
    }

    res = fill_kde_decklist(args.deck_json, args.output, duelist_info, args.template)
    print(json.dumps(res, ensure_ascii=False))
