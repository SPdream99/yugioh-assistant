#!/usr/bin/env python3
"""
Official Konami Tournament Deck Registration Sheet PDF Generator
Generates an official-standard A4 printable decklist PDF for YCS / Regional / National tournaments.
"""

import sys
import os
import json
import argparse
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.pdfgen import canvas

def draw_header(c, width, height, duelist_info):
    # Top banner
    c.setFillColor(colors.HexColor("#C00000")) # Konami Red
    c.rect(20, height - 42, width - 40, 26, fill=True, stroke=False)

    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 14)
    c.drawString(30, height - 34, "KONAMI")
    c.setFont("Helvetica-Bold", 12)
    c.drawRightString(width - 30, height - 34, "OFFICIAL TOURNAMENT DECK REGISTRATION SHEET")

    # Duelist Info Box
    box_top = height - 50
    box_height = 54
    c.setStrokeColor(colors.HexColor("#333333"))
    c.setFillColor(colors.HexColor("#F8F9FA"))
    c.rect(20, box_top - box_height, width - 40, box_height, fill=True, stroke=True)

    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 8)

    # Row 1
    c.drawString(28, box_top - 14, "DUELIST NAME:")
    c.setFont("Helvetica", 9)
    c.drawString(100, box_top - 14, str(duelist_info.get("duelistName", "___________________________")))

    c.setFont("Helvetica-Bold", 8)
    c.drawString(260, box_top - 14, "CARD GAME ID:")
    c.setFont("Helvetica", 9)
    c.drawString(335, box_top - 14, str(duelist_info.get("cardGameId", "_________________")))

    c.setFont("Helvetica-Bold", 8)
    c.drawString(440, box_top - 14, "DATE OF BIRTH:")
    c.setFont("Helvetica", 9)
    c.drawString(515, box_top - 14, str(duelist_info.get("dateOfBirth", "____ / ____ / ________")))

    # Row 2
    c.setFont("Helvetica-Bold", 8)
    c.drawString(28, box_top - 32, "EVENT NAME:")
    c.setFont("Helvetica", 9)
    c.drawString(95, box_top - 32, str(duelist_info.get("eventName", "Regional Qualifier / YCS")))

    c.setFont("Helvetica-Bold", 8)
    c.drawString(260, box_top - 32, "DECK NAME:")
    c.setFont("Helvetica-Bold", 9)
    c.drawString(325, box_top - 32, str(duelist_info.get("deckName", "Competitive Meta Deck")))

    c.setFont("Helvetica-Bold", 8)
    c.drawString(440, box_top - 32, "EVENT DATE:")
    c.setFont("Helvetica", 9)
    c.drawString(505, box_top - 32, str(duelist_info.get("eventDate", "2026-11-03")))

    # Format / Banlist status
    c.setFont("Helvetica-Oblique", 7.5)
    c.setFillColor(colors.HexColor("#666666"))
    fmt = duelist_info.get("format", "TCG")
    c.drawString(28, box_top - 47, f"Format: {fmt} Standard | Main Deck Limit: 40-60 Cards | Extra Deck: 0-15 Cards | Side Deck: 0-15 Cards")


def draw_section_box(c, x, y, w, h, title, count_text, count_bg="#1A365D"):
    # Header bar
    c.setFillColor(colors.HexColor(count_bg))
    c.rect(x, y - 16, w, 16, fill=True, stroke=False)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(x + 6, y - 12, title)
    c.drawRightString(x + w - 6, y - 12, count_text)


def draw_card_rows(c, x, y_start, w, rows, max_rows, line_height=13.2):
    c.setFont("Helvetica", 8)
    for i in range(max_rows):
        y = y_start - (i * line_height)
        # Alternate row backgrounds
        if i % 2 == 1:
            c.setFillColor(colors.HexColor("#F4F6F8"))
            c.rect(x, y - line_height + 2, w, line_height, fill=True, stroke=False)

        # Border box per row
        c.setStrokeColor(colors.HexColor("#E2E8F0"))
        c.setLineWidth(0.5)
        c.line(x, y - line_height + 2, x + w, y - line_height + 2)
        # Divider between quantity and name
        c.line(x + 22, y + 2, x + 22, y - line_height + 2)

        c.setFillColor(colors.black)
        if i < len(rows):
            card = rows[i]
            qty = str(card.get("count", 1))
            name = str(card.get("name", ""))

            c.setFont("Helvetica-Bold", 8.5)
            c.drawCentredString(x + 11, y - line_height + 4.5, qty)

            c.setFont("Helvetica", 8)
            # Truncate card name if too long for box width
            max_chars = int((w - 28) / 4.4)
            if len(name) > max_chars:
                name = name[:max_chars - 2] + "..."
            c.drawString(x + 26, y - line_height + 4.5, name)
        else:
            # Empty row line number
            c.setFillColor(colors.HexColor("#CBD5E1"))
            c.setFont("Helvetica", 7)
            c.drawCentredString(x + 11, y - line_height + 4.5, str(i + 1))


def generate_decklist_pdf(deck_json_path, output_pdf_path, duelist_info=None):
    if duelist_info is None:
        duelist_info = {}

    with open(deck_json_path, "r", encoding="utf-8") as f:
        deck_data = json.load(f)

    c = canvas.Canvas(output_pdf_path, pagesize=A4)
    width, height = A4 # 595.27 x 841.89

    # Set document metadata
    c.setTitle(f"Konami Decklist - {duelist_info.get('deckName', 'Deck')}")
    c.setAuthor("Yu-Gi-Oh! Assistant")

    draw_header(c, width, height, duelist_info)

    # Organize cards into categorized groups
    # Main Deck: Monsters, Spells, Traps
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

    # Layout Coordinates
    # Left Column: Monsters (X: 20, Width: 180)
    # Middle Column: Spells & Traps (X: 206, Width: 180)
    # Right Column: Extra Deck & Side Deck (X: 392, Width: 183)
    col_width = 180
    right_col_width = width - 40 - (col_width * 2) - 12 # ~183

    col1_x = 20
    col2_x = col1_x + col_width + 6
    col3_x = col2_x + col_width + 6

    content_top = height - 114

    # 1. MONSTERS SECTION (Column 1)
    # Allows up to 26 monster entries
    draw_section_box(c, col1_x, content_top, col_width, 0, "MONSTER CARDS", f"Count: {total_monsters}", "#9A3412")
    c.rect(col1_x, content_top - 16 - (26 * 13.2), col_width, (26 * 13.2) + 16, stroke=True, fill=False)
    draw_card_rows(c, col1_x, content_top - 16, col_width, monsters, 26, line_height=13.2)

    # Total Main Deck Box underneath Column 1
    total_box_y = content_top - 16 - (26 * 13.2) - 22
    c.setFillColor(colors.HexColor("#1E293B"))
    c.rect(col1_x, total_box_y, (col_width * 2) + 6, 20, fill=True, stroke=False)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(col1_x + 8, total_box_y + 6, f"TOTAL MAIN DECK CARDS: {total_main}")
    c.drawRightString(col2_x + col_width - 8, total_box_y + 6, "REQUIREMENT: 40 - 60 CARDS")

    # 2. SPELLS & TRAPS SECTION (Column 2)
    # Spells (up to 15 entries)
    draw_section_box(c, col2_x, content_top, col_width, 0, "SPELL CARDS", f"Count: {total_spells}", "#047857")
    c.rect(col2_x, content_top - 16 - (15 * 13.2), col_width, (15 * 13.2) + 16, stroke=True, fill=False)
    draw_card_rows(c, col2_x, content_top - 16, col_width, spells, 15, line_height=13.2)

    # Traps (up to 10 entries)
    trap_top = content_top - 16 - (15 * 13.2) - 8
    draw_section_box(c, col2_x, trap_top, col_width, 0, "TRAP CARDS", f"Count: {total_traps}", "#9D174D")
    c.rect(col2_x, trap_top - 16 - (10 * 13.2), col_width, (10 * 13.2) + 16, stroke=True, fill=False)
    draw_card_rows(c, col2_x, trap_top - 16, col_width, traps, 10, line_height=13.2)

    # 3. EXTRA DECK & SIDE DECK SECTION (Column 3)
    # Extra Deck (up to 15 entries)
    draw_section_box(c, col3_x, content_top, right_col_width, 0, "EXTRA DECK", f"Count: {total_extra} / 15", "#4338CA")
    c.rect(col3_x, content_top - 16 - (15 * 13.2), right_col_width, (15 * 13.2) + 16, stroke=True, fill=False)
    draw_card_rows(c, col3_x, content_top - 16, right_col_width, extra_deck, 15, line_height=13.2)

    # Side Deck (up to 15 entries)
    side_top = content_top - 16 - (15 * 13.2) - 8
    draw_section_box(c, col3_x, side_top, right_col_width, 0, "SIDE DECK", f"Count: {total_side} / 15", "#0F766E")
    c.rect(col3_x, side_top - 16 - (15 * 13.2), right_col_width, (15 * 13.2) + 16, stroke=True, fill=False)
    draw_card_rows(c, col3_x, side_top - 16, right_col_width, side_deck, 15, line_height=13.2)

    # Total Extra + Side Summary Box
    side_summary_y = total_box_y
    c.setFillColor(colors.HexColor("#0F172A"))
    c.rect(col3_x, side_summary_y, right_col_width, 20, fill=True, stroke=False)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(col3_x + 6, side_summary_y + 6, f"EXTRA: {total_extra}  |  SIDE: {total_side}")
    c.drawRightString(col3_x + right_col_width - 6, side_summary_y + 6, "MAX 15 EACH")

    # 4. OFFICIAL TOURNAMENT DECLARATION & SIGNATURE FOOTER
    footer_top = total_box_y - 10
    footer_height = 54
    c.setStrokeColor(colors.HexColor("#475569"))
    c.setFillColor(colors.HexColor("#F8FAFC"))
    c.rect(20, footer_top - footer_height, width - 40, footer_height, fill=True, stroke=True)

    c.setFillColor(colors.HexColor("#0F172A"))
    c.setFont("Helvetica-Bold", 7.5)
    c.drawString(26, footer_top - 12, "DUELIST DECLARATION & TOURNAMENT COMPLIANCE:")
    c.setFont("Helvetica", 6.8)
    c.drawString(
        26,
        footer_top - 22,
        "I declare that this decklist is accurate and reflects the exact cards in my Main, Extra, and Side Deck. I acknowledge that"
    )
    c.drawString(
        26,
        footer_top - 31,
        "discrepancies between this registration sheet and actual deck contents will result in official penalties up to Disqualification."
    )

    # Signature lines
    c.setFont("Helvetica-Bold", 7.5)
    c.drawString(26, footer_top - 46, "DUELIST SIGNATURE: ____________________________________")
    c.drawString(320, footer_top - 46, "JUDGE / STAFF VERIFICATION: _______________________")

    # Bottom copyright notice
    c.setFont("Helvetica", 7)
    c.setFillColor(colors.HexColor("#64748B"))
    c.drawCentredString(width / 2.0, 10, "© Studio Dice / SHUEISHA, TV TOKYO, KONAMI  •  Official Yu-Gi-Oh! Deck Registration Sheet")

    c.save()
    return {
        "success": True,
        "pdfPath": output_pdf_path,
        "totalMain": total_main,
        "totalMonsters": total_monsters,
        "totalSpells": total_spells,
        "totalTraps": total_traps,
        "totalExtra": total_extra,
        "totalSide": total_side
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate Konami Decklist PDF")
    parser.add_argument("--deck-json", required=True, help="Path to deck categorised JSON")
    parser.add_argument("--output", required=True, help="Output PDF file path")
    parser.add_argument("--duelist-name", default="Duelist", help="Duelist Name")
    parser.add_argument("--card-game-id", default="", help="Konami Card Game ID")
    parser.add_argument("--event-name", default="Regional Qualifier", help="Event Name")
    parser.add_argument("--deck-name", default="Meta Deck", help="Deck Name")
    parser.add_argument("--event-date", default="", help="Event Date")
    parser.add_argument("--format", default="TCG", help="Format (TCG/OCG)")

    args = parser.parse_args()

    duelist_info = {
        "duelistName": args.duelist_name,
        "cardGameId": args.card_game_id,
        "eventName": args.event_name,
        "deckName": args.deck_name,
        "eventDate": args.event_date,
        "format": args.format
    }

    res = generate_decklist_pdf(args.deck_json, args.output, duelist_info)
    print(json.dumps(res))
