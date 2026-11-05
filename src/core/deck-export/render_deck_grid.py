#!/usr/bin/env python3
"""
Official Konami Neuron-style Visual Deck Grid PNG Generator
Renders a complete deck (Main, Extra, Side) in the standard 10-cards-per-row Konami tournament layout.
"""

import sys
import os
import json
import argparse
import urllib.request
from PIL import Image, ImageDraw, ImageFont

# Constants for layout
CARDS_PER_ROW = 10
CARD_WIDTH = 88
CARD_HEIGHT = 128
GAP_X = 4
GAP_Y = 5
MARGIN_X = 16
MARGIN_TOP = 12
HEADER_HEIGHT = 44
SECTION_HEADER_HEIGHT = 28
FOOTER_HEIGHT = 42

# Color Palette (Matching Konami Neuron dark blue theme)
BG_COLOR = (11, 25, 44)           # #0B192C Deep Navy Blue
BANNER_COLOR = (14, 59, 104)       # #0E3B68 Header Blue
SECTION_BAR_COLOR = (10, 42, 77)   # #0A2A4D Section Dark Blue
BORDER_COLOR = (26, 77, 128)       # #1A4D80 Card Border highlight
TEXT_WHITE = (255, 255, 255)
TEXT_MUTED = (160, 185, 210)
TEXT_GOLD = (235, 195, 80)

# Card Frame Colors for fallback rendering
FRAME_COLORS = {
    "normal": (210, 150, 75),
    "effect": (198, 104, 43),
    "ritual": (100, 136, 190),
    "fusion": (141, 84, 162),
    "synchro": (230, 230, 230),
    "xyz": (35, 35, 35),
    "link": (0, 77, 153),
    "spell": (29, 158, 116),
    "trap": (189, 41, 118)
}

CACHE_DIR = os.path.join(os.getcwd(), "data", "cache", "card_images")
os.makedirs(CACHE_DIR, exist_ok=True)

def get_font(size, bold=False):
    # Prioritize Japanese CJK fonts with full Kanji, Kana, and Latin support
    font_candidates = []
    if bold:
        font_candidates.extend([
            "C:/Windows/Fonts/yugothb.ttc",
            "C:/Windows/Fonts/msgothic.ttc",
            "C:/Windows/Fonts/meiryob.ttc",
            "C:/Windows/Fonts/malgunbd.ttf",
            "C:/Windows/Fonts/arialbd.ttf"
        ])
    else:
        font_candidates.extend([
            "C:/Windows/Fonts/yugothm.ttc",
            "C:/Windows/Fonts/msgothic.ttc",
            "C:/Windows/Fonts/meiryo.ttc",
            "C:/Windows/Fonts/malgun.ttf",
            "C:/Windows/Fonts/arial.ttf"
        ])

    for fpath in font_candidates:
        if os.path.exists(fpath):
            try:
                return ImageFont.truetype(fpath, size)
            except Exception:
                continue
    return ImageFont.load_default()

def fetch_card_thumbnail(card_id, card_info):
    if not card_id or card_id == 0:
        return create_fallback_thumbnail(card_info)

    cached_path = os.path.join(CACHE_DIR, f"{card_id}.jpg")
    if os.path.exists(cached_path):
        try:
            img = Image.open(cached_path).convert("RGB")
            return img.resize((CARD_WIDTH, CARD_HEIGHT), Image.Resampling.LANCZOS)
        except Exception:
            pass

    # Remote fetch from YGOPRODeck CDN
    url = f"https://images.ygoprodeck.com/images/cards_small/{card_id}.jpg"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req, timeout=4) as response:
            with open(cached_path, "wb") as f:
                f.write(response.read())
        img = Image.open(cached_path).convert("RGB")
        return img.resize((CARD_WIDTH, CARD_HEIGHT), Image.Resampling.LANCZOS)
    except Exception:
        return create_fallback_thumbnail(card_info)

def create_fallback_thumbnail(card_info):
    img = Image.new("RGB", (CARD_WIDTH, CARD_HEIGHT), color=(20, 20, 20))
    draw = ImageDraw.Draw(img)

    card_type = (card_info.get("type", "") if card_info else "").lower()
    frame_color = FRAME_COLORS["effect"]

    if "normal" in card_type:
        frame_color = FRAME_COLORS["normal"]
    elif "spell" in card_type:
        frame_color = FRAME_COLORS["spell"]
    elif "trap" in card_type:
        frame_color = FRAME_COLORS["trap"]
    elif "fusion" in card_type:
        frame_color = FRAME_COLORS["fusion"]
    elif "synchro" in card_type:
        frame_color = FRAME_COLORS["synchro"]
    elif "xyz" in card_type:
        frame_color = FRAME_COLORS["xyz"]
    elif "link" in card_type:
        frame_color = FRAME_COLORS["link"]
    elif "ritual" in card_type:
        frame_color = FRAME_COLORS["ritual"]

    # Outer border & background
    draw.rectangle([0, 0, CARD_WIDTH - 1, CARD_HEIGHT - 1], outline=(0, 0, 0), width=1)
    draw.rectangle([2, 2, CARD_WIDTH - 3, CARD_HEIGHT - 3], fill=frame_color)

    # Inner art box
    draw.rectangle([8, 18, CARD_WIDTH - 9, CARD_HEIGHT - 36], fill=(35, 45, 55), outline=(0, 0, 0), width=1)

    # Name text
    font_name = get_font(9, bold=True)
    name = card_info.get("name", "Card") if card_info else "Card"
    text_color = (0, 0, 0) if "synchro" in card_type or "normal" in card_type else (255, 255, 255)
    draw.text((8, 5), name[:14], fill=text_color, font=font_name)

    # Bottom stats or text
    font_sub = get_font(7)
    draw.text((8, CARD_HEIGHT - 22), (card_info.get("type", "") if card_info else "")[:16], fill=text_color, font=font_sub)

    return img

def render_deck_image(deck_json_path, output_png_path, title="Yu-Gi-Oh! Deck", lang="jp"):
    with open(deck_json_path, "r", encoding="utf-8") as f:
        deck_data = json.load(f)

    main_cards = deck_data.get("main", [])
    extra_cards = deck_data.get("extra", [])
    side_cards = deck_data.get("side", [])

    # Calculate grid dimensions
    main_rows = (len(main_cards) + CARDS_PER_ROW - 1) // CARDS_PER_ROW if main_cards else 0
    extra_rows = (len(extra_cards) + CARDS_PER_ROW - 1) // CARDS_PER_ROW if extra_cards else 0
    side_rows = (len(side_cards) + CARDS_PER_ROW - 1) // CARDS_PER_ROW if side_cards else 0

    total_width = (MARGIN_X * 2) + (CARDS_PER_ROW * CARD_WIDTH) + ((CARDS_PER_ROW - 1) * GAP_X)

    total_height = (
        MARGIN_TOP +
        HEADER_HEIGHT +
        SECTION_HEADER_HEIGHT + (main_rows * (CARD_HEIGHT + GAP_Y)) + 8 +
        SECTION_HEADER_HEIGHT + (extra_rows * (CARD_HEIGHT + GAP_Y)) + 8 +
        SECTION_HEADER_HEIGHT + (side_rows * (CARD_HEIGHT + GAP_Y)) + 12 +
        FOOTER_HEIGHT
    )

    img = Image.new("RGB", (total_width, total_height), color=BG_COLOR)
    draw = ImageDraw.Draw(img)

    # 1. Top Banner
    font_title = get_font(18, bold=True)
    draw.rectangle([0, 0, total_width, HEADER_HEIGHT], fill=BANNER_COLOR)
    draw.text((MARGIN_X, 10), title, fill=TEXT_WHITE, font=font_title)

    y_cursor = HEADER_HEIGHT + 6

    font_section = get_font(12, bold=True)

    # 2. Section Helper
    def draw_section(label, count, cards, rows):
        nonlocal y_cursor
        # Section header bar
        draw.rectangle([0, y_cursor, total_width, y_cursor + SECTION_HEADER_HEIGHT], fill=SECTION_BAR_COLOR)
        # Accent left indicator
        draw.rectangle([0, y_cursor, 6, y_cursor + SECTION_HEADER_HEIGHT], fill=(220, 100, 30))

        count_label = f"■ {label} : {count}枚" if lang == "jp" else f"■ {label} : {count} CARDS"
        draw.text((MARGIN_X, y_cursor + 5), count_label, fill=TEXT_WHITE, font=font_section)

        y_cursor += SECTION_HEADER_HEIGHT + 6

        # Draw cards grid
        for idx, card in enumerate(cards):
            r = idx // CARDS_PER_ROW
            c = idx % CARDS_PER_ROW

            card_x = MARGIN_X + c * (CARD_WIDTH + GAP_X)
            card_y = y_cursor + r * (CARD_HEIGHT + GAP_Y)

            card_img = fetch_card_thumbnail(card.get("id", 0), card)
            img.paste(card_img, (card_x, card_y))

            # Border around card
            draw.rectangle([card_x, card_y, card_x + CARD_WIDTH, card_y + CARD_HEIGHT], outline=BORDER_COLOR, width=1)

        y_cursor += rows * (CARD_HEIGHT + GAP_Y) + 8

    # Draw Main Deck
    main_label = "メインデッキ" if lang == "jp" else "MAIN DECK"
    draw_section(main_label, len(main_cards), main_cards, main_rows)

    # Draw Extra Deck
    extra_label = "エクストラデッキ" if lang == "jp" else "EXTRA DECK"
    draw_section(extra_label, len(extra_cards), extra_cards, extra_rows)

    # Draw Side Deck
    side_label = "サイドデッキ" if lang == "jp" else "SIDE DECK"
    draw_section(side_label, len(side_cards), side_cards, side_rows)

    # 3. Footer Copyright Notice (Matching Konami official screenshot)
    draw.rectangle([0, total_height - FOOTER_HEIGHT, total_width, total_height], fill=(4, 10, 18))
    font_footer = get_font(10)
    footer_text1 = "© スタジオ・ダイス／集英社・テレビ東京・KONAMI"
    footer_text2 = "© 2026 Konami Digital Entertainment"

    # Centered footer lines
    bbox1 = font_footer.getbbox(footer_text1)
    text1_width = bbox1[2] - bbox1[0]
    draw.text(((total_width - text1_width) / 2, total_height - FOOTER_HEIGHT + 7), footer_text1, fill=TEXT_MUTED, font=font_footer)

    bbox2 = font_footer.getbbox(footer_text2)
    text2_width = bbox2[2] - bbox2[0]
    draw.text(((total_width - text2_width) / 2, total_height - FOOTER_HEIGHT + 23), footer_text2, fill=TEXT_MUTED, font=font_footer)

    # Save PNG
    os.makedirs(os.path.dirname(output_png_path), exist_ok=True)
    img.save(output_png_path, "PNG", quality=95)

    return {
        "success": True,
        "outputPath": output_png_path,
        "width": total_width,
        "height": total_height,
        "mainCount": len(main_cards),
        "extraCount": len(extra_cards),
        "sideCount": len(side_cards)
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Render Deck Grid Image PNG")
    parser.add_argument("--deck-json", required=True, help="Path to deck JSON")
    parser.add_argument("--output", required=True, help="Path to output PNG")
    parser.add_argument("--title", default="Yu-Gi-Oh! Deck", help="Deck Title")
    parser.add_argument("--lang", default="jp", choices=["jp", "en"], help="Section label language (jp/en)")

    args = parser.parse_args()
    res = render_deck_image(args.deck_json, args.output, args.title, args.lang)
    print(json.dumps(res))
