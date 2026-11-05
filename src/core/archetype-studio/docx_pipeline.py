#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Master Specification DOCX Builder & Parser for Yu-Gi-Oh! Archetype Studio.
Implements Single Source of Truth (SST) document generation and table extraction.
"""

import sys
import os
import json
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_ALIGN_VERTICAL
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

def set_cell_background(cell, hex_color):
    """Sets background shading of a table cell."""
    tcPr = cell._tc.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>')
    tcPr.append(shd)

def set_cell_margins(cell, top=100, bottom=100, left=150, right=150):
    """Sets inner margins/padding for a cell (in dxa: 20 dxa = 1 pt)."""
    tcPr = cell._tc.get_or_add_tcPr()
    tcMar = parse_xml(f'''
        <w:tcMar {nsdecls("w")}>
            <w:top w:w="{top}" w:type="dxa"/>
            <w:bottom w:w="{bottom}" w:type="dxa"/>
            <w:left w:w="{left}" w:type="dxa"/>
            <w:right w:w="{right}" w:type="dxa"/>
        </w:tcMar>
    ''')
    tcPr.append(tcMar)

def build_spec_docx(data, output_path):
    """
    Builds a professional Yu-Gi-Oh! Archetype Design Bible .docx document.
    """
    doc = Document()

    # Set 0.75-inch page margins for wide master tables
    sections = doc.sections
    for s in sections:
        s.top_margin = Inches(0.75)
        s.bottom_margin = Inches(0.75)
        s.left_margin = Inches(0.75)
        s.right_margin = Inches(0.75)

    archetype_name = data.get("archetypeName", "Custom Archetype")
    setcode = data.get("setcode", "0x99f")
    target_sim = data.get("targetSimulator", "omega").upper()
    lore = data.get("lore", "No lore description provided.")
    playstyle = data.get("playstyle", "No playstyle description provided.")
    author = data.get("author", "Yu-Gi-Oh! Assistant Studio")
    cards = data.get("cards", [])

    # 1. Header / Title Block
    title_p = doc.add_paragraph()
    title_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    title_p.paragraph_format.space_after = Pt(4)
    run_title = title_p.add_run(f"ARCHETYPE DESIGN BIBLE: {archetype_name.upper()}")
    run_title.font.name = "Arial"
    run_title.font.size = Pt(18)
    run_title.font.bold = True
    run_title.font.color.rgb = RGBColor(0x1E, 0x3A, 0x8A)

    subtitle_p = doc.add_paragraph()
    subtitle_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    subtitle_p.paragraph_format.space_after = Pt(14)
    sub_run = subtitle_p.add_run(f"Setcode: {setcode}  |  Target Engine: {target_sim}  |  Total Cards: {len(cards)}  |  Author: {author}")
    sub_run.font.name = "Arial"
    sub_run.font.size = Pt(10)
    sub_run.font.italic = True
    sub_run.font.color.rgb = RGBColor(0x4B, 0x55, 0x63)

    # 2. Section I: Lore & Playstyle
    h1 = doc.add_heading(level=1)
    h1_run = h1.add_run("I. LORE & PLAYSTYLE MECHANICS (LORE & STRATEGY)")
    h1_run.font.name = "Arial"
    h1_run.font.size = Pt(13)
    h1_run.font.bold = True
    h1_run.font.color.rgb = RGBColor(0x1F, 0x29, 0x37)

    lore_box = doc.add_paragraph()
    lore_box.paragraph_format.space_after = Pt(6)
    lore_r = lore_box.add_run(f"• Lore: {lore}")
    lore_r.font.name = "Arial"
    lore_r.font.size = Pt(10.5)

    strat_box = doc.add_paragraph()
    strat_box.paragraph_format.space_after = Pt(14)
    strat_r = strat_box.add_run(f"• Strategy & Mechanics (Playstyle): {playstyle}")
    strat_r.font.name = "Arial"
    strat_r.font.size = Pt(10.5)

    # 3. Section II: Master Card Table
    h2 = doc.add_heading(level=1)
    h2_run = h2.add_run("II. CARD SPECIFICATIONS (MASTER CARD TABLE)")
    h2_run.font.name = "Arial"
    h2_run.font.size = Pt(13)
    h2_run.font.bold = True
    h2_run.font.color.rgb = RGBColor(0x1F, 0x29, 0x37)

    # Table: 6 columns
    # Col 1: ID / No. (0.9 in)
    # Col 2: Name & Typing (1.3 in)
    # Col 3: Stats ATK/DEF (0.9 in)
    # Col 4: Official Card Text (2.4 in)
    # Col 5: Strings (str1..16) (0.9 in)
    # Col 6: Visual Description / Prompt (1.1 in)
    table = doc.add_table(rows=1, cols=6)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False

    col_widths = [Inches(0.85), Inches(1.3), Inches(0.85), Inches(2.2), Inches(0.9), Inches(1.4)]

    # Header Row
    headers = [
        "Passcode (ID)",
        "Card Name & Classification",
        "Stats (ATK/DEF)",
        "Card Text (Effect)",
        "Option Strings (str1..16)",
        "Visual Prompt (AI Art)"
    ]

    header_tr = table.rows[0]._tr.get_or_add_trPr()
    header_tr.append(parse_xml(f'<w:tblHeader {nsdecls("w")}/>'))

    for col_idx, h_text in enumerate(headers):
        cell = table.cell(0, col_idx)
        cell.width = col_widths[col_idx]
        set_cell_background(cell, "1E3A8A") # Navy Blue
        set_cell_margins(cell, top=140, bottom=140, left=100, right=100)
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.space_before = Pt(2)
        r = p.add_run(h_text)
        r.font.name = "Arial"
        r.font.size = Pt(9.5)
        r.font.bold = True
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

    # Data Rows
    for idx, card in enumerate(cards):
        row = table.add_row()
        trPr = row._tr.get_or_add_trPr()
        trPr.append(parse_xml(f'<w:cantSplit {nsdecls("w")}/>'))

        bg_color = "F9FAFB" if idx % 2 == 1 else "FFFFFF"

        c_id = str(card.get("id", f"99{idx+1:06d}"))
        c_name = card.get("name", f"Card #{c_id}")
        c_type = card.get("type", "Effect Monster")
        c_attr = card.get("attribute", "")
        c_race = card.get("race", "")
        c_level = card.get("level", "")
        c_atk = str(card.get("atk", "0"))
        c_def = str(card.get("def", "0"))
        c_scale = str(card.get("scale", ""))
        c_desc = card.get("desc", "")
        c_strings = card.get("strings", [])
        c_prompt = card.get("visualPrompt", f"Anime official art of {c_name}")

        # Cell 0: ID
        cell0 = row.cells[0]
        cell0.width = col_widths[0]
        set_cell_background(cell0, bg_color)
        set_cell_margins(cell0, top=100, bottom=100, left=80, right=80)
        p0 = cell0.paragraphs[0]
        p0.alignment = WD_ALIGN_PARAGRAPH.CENTER
        r0 = p0.add_run(c_id)
        r0.font.name = "Consolas"
        r0.font.size = Pt(9.5)
        r0.font.bold = True

        # Cell 1: Name & Type & Race & Attribute
        cell1 = row.cells[1]
        cell1.width = col_widths[1]
        set_cell_background(cell1, bg_color)
        set_cell_margins(cell1, top=100, bottom=100, left=100, right=80)
        p1 = cell1.paragraphs[0]
        p1.paragraph_format.space_after = Pt(2)
        r1_name = p1.add_run(f"{c_name}\n")
        r1_name.font.name = "Arial"
        r1_name.font.size = Pt(9.5)
        r1_name.font.bold = True
        type_str = f"[{c_type}]"
        if c_attr: type_str += f" / {c_attr}"
        if c_race: type_str += f"\n{c_race}"
        if c_level: type_str += f" (★{c_level})"
        r1_type = p1.add_run(type_str)
        r1_type.font.name = "Arial"
        r1_type.font.size = Pt(8.5)
        r1_type.font.color.rgb = RGBColor(0x4B, 0x55, 0x63)

        # Cell 2: Stats (ATK / DEF / Scale)
        cell2 = row.cells[2]
        cell2.width = col_widths[2]
        set_cell_background(cell2, bg_color)
        set_cell_margins(cell2, top=100, bottom=100, left=80, right=80)
        p2 = cell2.paragraphs[0]
        p2.alignment = WD_ALIGN_PARAGRAPH.CENTER
        if "monster" in c_type.lower():
            stat_text = f"ATK: {c_atk}\nDEF: {c_def}"
            if c_scale: stat_text += f"\nScale: {c_scale}"
        else:
            stat_text = "—"
        r2 = p2.add_run(stat_text)
        r2.font.name = "Arial"
        r2.font.size = Pt(8.5)

        # Cell 3: Card Text
        cell3 = row.cells[3]
        cell3.width = col_widths[3]
        set_cell_background(cell3, bg_color)
        set_cell_margins(cell3, top=100, bottom=100, left=100, right=100)
        p3 = cell3.paragraphs[0]
        p3.paragraph_format.space_after = Pt(2)
        r3 = p3.add_run(c_desc)
        r3.font.name = "Arial"
        r3.font.size = Pt(8.5)

        # Cell 4: Strings (str1..16)
        cell4 = row.cells[4]
        cell4.width = col_widths[4]
        set_cell_background(cell4, bg_color)
        set_cell_margins(cell4, top=100, bottom=100, left=80, right=80)
        p4 = cell4.paragraphs[0]
        p4.paragraph_format.space_after = Pt(2)
        if c_strings and len(c_strings) > 0:
            lines = [f"{i}: {s}" for i, s in enumerate(c_strings)]
            r4 = p4.add_run("\n".join(lines))
        else:
            r4 = p4.add_run("—")
        r4.font.name = "Consolas"
        r4.font.size = Pt(8.0)

        # Cell 5: Visual Description / Prompt
        cell5 = row.cells[5]
        cell5.width = col_widths[5]
        set_cell_background(cell5, bg_color)
        set_cell_margins(cell5, top=100, bottom=100, left=80, right=80)
        p5 = cell5.paragraphs[0]
        p5.paragraph_format.space_after = Pt(2)
        r5 = p5.add_run(c_prompt)
        r5.font.name = "Arial"
        r5.font.size = Pt(8.0)
        r5.font.italic = True
        r5.font.color.rgb = RGBColor(0x37, 0x41, 0x51)

    # Save document
    out_dir = os.path.dirname(os.path.abspath(output_path))
    if not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)
    doc.save(output_path)
    return output_path

def parse_spec_docx(docx_path):
    """
    Parses a Master Specification .docx and extracts metadata and cards array.
    """
    if not os.path.exists(docx_path):
        raise FileNotFoundError(f"DOCX file not found: {docx_path}")

    doc = Document(docx_path)

    # Extract metadata from paragraphs
    archetype_name = "Custom Archetype"
    setcode = "0x99f"
    target_sim = "omega"
    lore = ""
    playstyle = ""

    for p in doc.paragraphs:
        txt = p.text.strip()
        if "ARCHETYPE DESIGN BIBLE:" in txt:
            archetype_name = txt.split("ARCHETYPE DESIGN BIBLE:")[-1].strip()
        elif "Setcode:" in txt:
            parts = txt.split("|")
            for part in parts:
                if "Setcode:" in part:
                    setcode = part.split("Setcode:")[-1].strip()
                elif "Target Engine:" in part:
                    target_sim = part.split("Target Engine:")[-1].strip().lower()
        elif "Lore:" in txt:
            lore = txt.split("Lore:")[-1].strip()
        elif "Strategy & Mechanics (Playstyle):" in txt:
            playstyle = txt.split("Strategy & Mechanics (Playstyle):")[-1].strip()

    cards = []
    # Find Master Card Table
    for table in doc.tables:
        if len(table.columns) >= 6:
            # Table with 6 columns is Master Card Table
            for row_idx, row in enumerate(table.rows[1:]): # skip header
                cells = row.cells
                if len(cells) < 6:
                    continue

                raw_id = cells[0].text.strip()
                try:
                    c_id = int(raw_id)
                except ValueError:
                    c_id = 99000000 + row_idx + 1

                # Cell 1: Name & Type & Race & Attr
                c1_lines = [l.strip() for l in cells[1].text.split("\n") if l.strip()]
                c_name = c1_lines[0] if len(c1_lines) > 0 else f"Card #{c_id}"
                c_type = "Effect Monster"
                c_attr = "DARK"
                c_race = "Spellcaster"
                c_level = 4

                if len(c1_lines) > 1:
                    line2 = c1_lines[1]
                    # Parse [Effect Monster] / LIGHT
                    if "[" in line2 and "]" in line2:
                        c_type = line2[line2.find("[")+1:line2.find("]")]
                    if "/" in line2:
                        c_attr = line2.split("/")[-1].strip()
                if len(c1_lines) > 2:
                    line3 = c1_lines[2]
                    if "(" in line3 and "★" in line3:
                        c_race = line3.split("(")[0].strip()
                        lvl_str = line3[line3.find("★")+1:line3.find(")")]
                        try:
                            c_level = int(lvl_str)
                        except ValueError:
                            c_level = 4
                    else:
                        c_race = line3

                # Cell 2: Stats
                c2_text = cells[2].text.strip()
                c_atk = 0
                c_def = 0
                c_scale = None
                for line in c2_text.split("\n"):
                    line = line.strip().upper()
                    if "ATK:" in line:
                        try:
                            c_atk = int(line.split("ATK:")[-1].strip())
                        except ValueError: pass
                    elif "DEF:" in line:
                        try:
                            c_def = int(line.split("DEF:")[-1].strip())
                        except ValueError: pass
                    elif "SCALE:" in line:
                        try:
                            c_scale = int(line.split("SCALE:")[-1].strip())
                        except ValueError: pass

                # Cell 3: Card text
                c_desc = cells[3].text.strip()

                # Cell 4: Strings
                c4_text = cells[4].text.strip()
                c_strings = []
                if c4_text and c4_text != "—":
                    for s_line in c4_text.split("\n"):
                        s_line = s_line.strip()
                        if ":" in s_line:
                            c_strings.append(s_line.split(":", 1)[1].strip())
                        elif s_line:
                            c_strings.append(s_line)

                # Cell 5: Visual Prompt
                c_prompt = cells[5].text.strip()

                cards.append({
                    "id": c_id,
                    "name": c_name,
                    "type": c_type,
                    "attribute": c_attr,
                    "race": c_race,
                    "level": c_level,
                    "atk": c_atk,
                    "def": c_def,
                    "scale": c_scale,
                    "desc": c_desc,
                    "strings": c_strings,
                    "visualPrompt": c_prompt
                })
            break

    return {
        "archetypeName": archetype_name,
        "setcode": setcode,
        "targetSimulator": target_sim,
        "lore": lore,
        "playstyle": playstyle,
        "cards": cards
    }

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: docx_pipeline.py <build|parse> <spec.json|spec.docx> [output_path]")
        sys.exit(1)

    cmd = sys.argv[1]
    input_file = sys.argv[2]

    if cmd == "build":
        out_file = sys.argv[3] if len(sys.argv) > 3 else "Archetype_Spec.docx"
        with open(input_file, "r", encoding="utf-8") as f:
            spec_data = json.load(f)
        saved = build_spec_docx(spec_data, out_file)
        print(json.dumps({"success": True, "savedPath": saved}))

    elif cmd == "parse":
        parsed = parse_spec_docx(input_file)
        print(json.dumps(parsed, ensure_ascii=False, indent=2))
