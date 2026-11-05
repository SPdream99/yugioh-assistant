#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SQLite Database Compiler for Yu-Gi-Oh! Simulators (EDOPro, YGO Omega, ProjectIgnis).

Key rules learned from real Omega testing:
- NEVER delete the target DB. Merge with INSERT OR REPLACE.
- `setcode` is a BLOB (2-byte little-endian), not an INTEGER.
- `ot = 4` for custom cards.
- Spell/Trap cards: race=0, level=0, attribute=0.
- Link monsters need a `linkmarkers` column (added if missing).
"""

import sys
import os
import json
import sqlite3

TYPES = {
    "monster": 0x1, "spell": 0x2, "trap": 0x4, "normal": 0x10, "effect": 0x20,
    "fusion": 0x40, "ritual": 0x80, "trapmonster": 0x100, "spirit": 0x200,
    "union": 0x400, "dual": 0x800, "tuner": 0x1000, "synchro": 0x2000,
    "token": 0x4000, "quickplay": 0x10000, "continuous": 0x20000, "equip": 0x40000,
    "field": 0x80000, "counter": 0x100000, "flip": 0x200000, "toon": 0x400000,
    "xyz": 0x800000, "pendulum": 0x1000000, "special": 0x2000000, "link": 0x4000000
}
ATTRIBUTES = {"earth": 0x01, "water": 0x02, "fire": 0x04, "wind": 0x08,
              "light": 0x10, "dark": 0x20, "divine": 0x40}
RACES = {
    "warrior": 0x1, "spellcaster": 0x2, "fairy": 0x4, "fiend": 0x8, "zombie": 0x10,
    "machine": 0x20, "aqua": 0x40, "pyro": 0x80, "rock": 0x100, "wingedbeast": 0x200,
    "winged-beast": 0x200, "plant": 0x400, "insect": 0x800, "thunder": 0x1000,
    "dragon": 0x2000, "beast": 0x4000, "beastwarrior": 0x8000, "beast-warrior": 0x8000,
    "dinosaur": 0x10000, "fish": 0x20000, "seaserpent": 0x40000, "sea-serpent": 0x40000,
    "reptile": 0x80000, "psychic": 0x100000, "divinebeast": 0x200000,
    "divine-beast": 0x200000, "creatorgod": 0x400000, "wyrm": 0x800000,
    "cyberse": 0x1000000, "illusion": 0x2000000
}
# Link marker bits (Top=1, Bottom=2, Left=4, Right=8, TopLeft=16, TopRight=32, BottomLeft=64, BottomRight=128)
DEFAULT_LINK_MARKERS = 0xC0  # Bottom-Left + Bottom-Right (good for a Link-2)

def parse_setcode(setcode_str):
    if not setcode_str:
        return 0
    s = str(setcode_str).strip()
    try:
        return int(s, 16) if s.lower().startswith("0x") else int(s)
    except ValueError:
        return 0

def setcode_blob(value):
    """2-byte little-endian BLOB, matching existing YGO Omega custom cards."""
    return bytes([value & 0xFF, (value >> 8) & 0xFF])

def calculate_type_bitmask(type_str, has_effect=True):
    tl = type_str.lower()
    mask = 0
    if "monster" in tl: mask |= TYPES["monster"]
    if "spell" in tl: mask |= TYPES["spell"]
    if "trap" in tl: mask |= TYPES["trap"]
    if "effect" in tl: mask |= TYPES["effect"]
    # TYPE_NORMAL (0x10) is for Normal MONSTERS; Normal Spells/Traps use TYPE_SPELL/TYPE_TRAP only.
    if "normal" in tl and "monster" in tl: mask |= TYPES["normal"]
    if "ritual" in tl: mask |= TYPES["ritual"]
    if "fusion" in tl: mask |= TYPES["fusion"]
    if "synchro" in tl: mask |= TYPES["synchro"]
    if "xyz" in tl: mask |= TYPES["xyz"]
    if "link" in tl: mask |= TYPES["link"]
    if "tuner" in tl: mask |= TYPES["tuner"]
    if "pendulum" in tl: mask |= TYPES["pendulum"]
    if "quick-play" in tl or "quickplay" in tl: mask |= TYPES["quickplay"]
    if "continuous" in tl: mask |= TYPES["continuous"]
    if "equip" in tl: mask |= TYPES["equip"]
    if "field" in tl: mask |= TYPES["field"]
    if "counter" in tl: mask |= TYPES["counter"]
    # Extra Deck effect monsters are almost always Effect Monsters.
    if has_effect and (mask & (TYPES["fusion"] | TYPES["synchro"] | TYPES["xyz"] | TYPES["link"])):
        mask |= TYPES["effect"]
    return mask

def is_spell_or_trap(type_str):
    tl = type_str.lower()
    return ("spell" in tl) or ("trap" in tl)

def ensure_schema(cursor):
    # Create tables if the target DB is brand new.
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS datas (
        id INTEGER PRIMARY KEY, ot INTEGER, alias INTEGER, setcode BLOB,
        type INTEGER, atk INTEGER, def INTEGER, level INTEGER, race INTEGER,
        attribute INTEGER, category INTEGER, genre INTEGER, script BLOB, support BLOB
    );
    """)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS texts (
        id INTEGER PRIMARY KEY, name TEXT, desc TEXT,
        str1 TEXT, str2 TEXT, str3 TEXT, str4 TEXT, str5 TEXT, str6 TEXT, str7 TEXT, str8 TEXT,
        str9 TEXT, str10 TEXT, str11 TEXT, str12 TEXT, str13 TEXT, str14 TEXT, str15 TEXT, str16 TEXT
    );
    """)
    # Add optional columns used by Omega/newer engines if they are missing.
    cols = {r[1] for r in cursor.execute("PRAGMA table_info(datas)").fetchall()}
    for name, decl in (("genre", "INTEGER"), ("script", "BLOB"), ("support", "BLOB"), ("linkmarkers", "INTEGER")):
        if name not in cols:
            try:
                cursor.execute(f"ALTER TABLE datas ADD COLUMN {name} {decl} DEFAULT 0")
            except sqlite3.OperationalError:
                pass

def compile_database(cards, setcode, output_db_path, profile="omega"):
    out_dir = os.path.dirname(os.path.abspath(output_db_path))
    os.makedirs(out_dir, exist_ok=True)

    conn = sqlite3.connect(output_db_path)
    cursor = conn.cursor()
    ensure_schema(cursor)

    setcode_val = parse_setcode(setcode)
    setcode_data = setcode_blob(setcode_val)

    for card in cards:
        c_id = int(card["id"])
        c_name = card.get("name", f"Card #{c_id}")
        c_type_str = card.get("type", "Effect Monster")
        c_attr_str = str(card.get("attribute", "")).lower()
        c_race_str = str(card.get("race", "")).lower().replace(" ", "")
        c_level = int(card.get("level", 0) or 0)
        c_atk = int(card.get("atk", 0) or 0)
        c_def = int(card.get("def", 0) or 0)
        c_desc = card.get("desc", "")
        c_strings = card.get("strings", []) or []
        c_lua = card.get("lua", "")

        type_mask = calculate_type_bitmask(c_type_str, has_effect=True)
        spell_trap = is_spell_or_trap(c_type_str)
        attr_mask = 0 if spell_trap else ATTRIBUTES.get(c_attr_str, 0)
        race_mask = 0 if spell_trap else RACES.get(c_race_str, 0)
        level_val = 0 if spell_trap else c_level

        # Pendulum scale encoding
        scale_val = card.get("scale")
        if scale_val is not None and not spell_trap:
            try:
                scale_num = int(scale_val)
                level_val = (scale_num << 24) | (scale_num << 16) | c_level
            except ValueError:
                pass

        # Link markers: use explicit value or a sensible default for Link monsters.
        linkmarkers = int(card.get("linkmarkers", DEFAULT_LINK_MARKERS if (type_mask & TYPES["link"]) else 0) or 0)

        cursor.execute("""
        INSERT OR REPLACE INTO datas
        (id, ot, alias, setcode, type, atk, def, level, race, attribute, category, genre, script, support, linkmarkers)
        VALUES (?, 4, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?);
        """, (
            c_id, int(card.get("alias", 0) or 0), setcode_data, type_mask,
            c_atk, c_def, level_val, race_mask, attr_mask,
            int(card.get("category", 0) or 0), c_lua or None, linkmarkers
        ))

        padded = [""] * 16
        for i, s in enumerate(c_strings[:16]):
            padded[i] = str(s)

        cursor.execute("""
        INSERT OR REPLACE INTO texts
        (id, name, desc, str1, str2, str3, str4, str5, str6, str7, str8,
         str9, str10, str11, str12, str13, str14, str15, str16)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (c_id, c_name, c_desc, *padded))

    conn.commit()
    conn.close()
    return output_db_path

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: sqlite_exporter.py <cards.json> <output_db_path> [setcode] [profile]")
        sys.exit(1)

    cards_json_path = sys.argv[1]
    out_db = sys.argv[2]
    setcode = sys.argv[3] if len(sys.argv) > 3 else "0x99f"
    profile = sys.argv[4] if len(sys.argv) > 4 else "omega"

    with open(cards_json_path, "r", encoding="utf-8") as f:
        cards_data = json.load(f)

    if isinstance(cards_data, dict) and "cards" in cards_data:
        cards_list = cards_data["cards"]
        setcode = cards_data.get("setcode", setcode)
    else:
        cards_list = cards_data

    saved = compile_database(cards_list, setcode, out_db, profile)
    print(json.dumps({"success": True, "databasePath": saved, "cardsCount": len(cards_list)}))
