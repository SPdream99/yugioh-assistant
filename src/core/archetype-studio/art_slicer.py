#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Art Studio & Smart Grid Slicer for Yu-Gi-Oh! Archetype Studio.
Exports ART_PROMPTS.md (with Master Grid Prompt) and slices AI-generated contact sheets into <id>.jpg.
"""

import sys
import os
import json
import math
from PIL import Image

DEFAULT_STYLE_BIBLE = (
    "one cohesive anime card-art set by the same artist: "
    "soft cel-shading, clean uniform lineart, large expressive eyes, "
    "consistent chibi proportions, the same pastel color palette and lighting direction, "
    "matching background rendering, no text, no frame, no card template"
)

def generate_art_prompts(cards, archetype_name, output_md_path, layout="3x3", style_bible=None):
    """
    Generates ART_PROMPTS.md containing individual prompts and a Master Grid Prompt.
    A shared style bible is injected into every prompt so all cards look like one set.
    """
    style_bible = (style_bible or DEFAULT_STYLE_BIBLE).strip()
    out_dir = os.path.dirname(os.path.abspath(output_md_path))
    if not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    n_cards = len(cards)
    if layout == "2x2":
        grid_rows, grid_cols = 2, 2
    elif layout == "4x4":
        grid_rows, grid_cols = 4, 4
    else: # default 3x3
        grid_rows, grid_cols = 3, 3

    # Build Master Grid Prompt
    grid_cells_desc = []
    for idx, card in enumerate(cards[:grid_rows * grid_cols]):
        pos_row = idx // grid_cols + 1
        pos_col = idx % grid_cols + 1
        pos_name = f"Row {pos_row}, Col {pos_col}"
        c_name = card.get("name", f"Card #{card['id']}")
        v_prompt = card.get("visualPrompt", f"Anime official Yu-Gi-Oh artwork of {c_name}")
        grid_cells_desc.append(f"  - Panel {idx+1} ({pos_name}) [{c_name}]: {v_prompt}")

    master_grid_prompt = (
        f"A clean {grid_rows}x{grid_cols} grid sheet containing {len(grid_cells_desc)} distinct square anime Yu-Gi-Oh card artworks for archetype '{archetype_name}' on a dark neutral background, sharp thin dividing borders between cells.\n\n"
        f"Style bible (must be identical across every panel): {style_bible}.\n\n"
        f"Panels:\n" + "\n".join(grid_cells_desc) + "\n\n"
        f"Masterpiece, 8k resolution, perfectly square composition per panel, highly detailed fantasy character & spell illustration in each quadrant."
    )

    md_lines = [
        f"# ART PROMPTS & VISUAL ASSET BIBLE: {archetype_name.upper()}",
        f"",
        f"Art generation guide for the **{archetype_name}** archetype ({n_cards} cards).",
        f"Use the **Master Grid Prompt** to generate every card artwork in a single pass (saving tokens and AI calls), then run the `ygo_slice_art_grid` tool to auto-slice it into `<id>.jpg` files.",
        f"",
        f"## 0. STYLE BIBLE (MUST BE IDENTICAL ACROSS EVERY CARD)",
        f"",
        f"> {style_bible}",
        f"",
        f"Do not change the model, base seed, color palette or lineart thickness between generations. If you create several grids, use exactly the same style bible sentence for each grid.",
        f"",
        f"---",
        f"",
        f"## 1. MASTER GRID PROMPT ({grid_rows}x{grid_cols} Sheet)",
        f"",
        f"> **Instructions:** Copy the entire prompt block below and paste it into an AI Image Generator (Canva Dream Lab, Midjourney `--ar 1:1`, Stable Diffusion).",
        f"",
        f"```text",
        master_grid_prompt,
        f"```",
        f"",
        f"**Suggested Negative Prompt:**",
        f"```text",
        f"nsfw, deformed, blurry, lowres, text, watermark, logo, border, frame, card template, distorted anatomy, duplicate, extra limbs, bad eyes, signature",
        f"```",
        f"",
        f"---",
        f"",
        f"## 2. PER-CARD PROMPT LIST (INDIVIDUAL PROMPTS)",
        f""
    ]

    for idx, card in enumerate(cards):
        c_id = card.get("id")
        c_name = card.get("name")
        c_type = card.get("type", "Effect Monster")
        c_attr = card.get("attribute", "")
        c_race = card.get("race", "")
        c_prompt = card.get("visualPrompt", f"Anime artwork of {c_name}")

        md_lines.extend([
            f"### #{idx+1}. [{c_id}] {c_name}",
            f"- **Classification:** {c_type} | {c_attr} | {c_race}",
            f"- **Prompt:**",
            f"  > `{c_prompt}. Shared style bible: {style_bible}. Square 1:1 composition, full-bleed character art, high resolution.`",
            f"- **Target file after slicing:** `<output_dir>/{c_id}.jpg`",
            f""
        ])

    with open(output_md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))

    return {
        "markdownPath": output_md_path,
        "masterGridPrompt": master_grid_prompt,
        "individualPromptsCount": n_cards,
        "gridLayout": f"{grid_rows}x{grid_cols}"
    }

def slice_grid_image(image_path, card_ids, output_dir, rows=3, cols=3, target_res=1024):
    """
    Slices a grid image into square <id>.jpg files and saves to output_dir.
    """
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Grid image not found: {image_path}")

    if not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    img = Image.open(image_path).convert("RGB")
    width, height = img.size

    cell_width = width / cols
    cell_height = height / rows

    # Padding / margin trim (2% of cell to eliminate grid dividers)
    pad_x = cell_width * 0.02
    pad_y = cell_height * 0.02

    results = []

    for idx, card_id in enumerate(card_ids):
        if idx >= rows * cols:
            break

        r = idx // cols
        c = idx % cols

        left = int(c * cell_width + pad_x)
        top = int(r * cell_height + pad_y)
        right = int((c + 1) * cell_width - pad_x)
        bottom = int((r + 1) * cell_height - pad_y)

        cropped = img.crop((left, top, right, bottom))
        resized = cropped.resize((target_res, target_res), Image.Resampling.LANCZOS)

        out_file = os.path.join(output_dir, f"{card_id}.jpg")
        resized.save(out_file, "JPEG", quality=95)

        results.append({
            "cardId": card_id,
            "imagePath": out_file
        })

    return {
        "success": True,
        "sourceImage": image_path,
        "outputDir": output_dir,
        "slicedCount": len(results),
        "cardsOutput": results,
        "message": f"Successfully sliced {len(results)} card artworks into {output_dir}"
    }

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: art_slicer.py <prompts|slice> [args...]")
        sys.exit(1)

    cmd = sys.argv[1]

    if cmd == "prompts":
        # art_slicer.py prompts <cards.json> <output_md_path> [archetype_name] [layout]
        cards_json = sys.argv[2]
        output_md = sys.argv[3]
        arch_name = sys.argv[4] if len(sys.argv) > 4 else "Custom Archetype"
        layout = sys.argv[5] if len(sys.argv) > 5 else "3x3"
        style_bible = sys.argv[6] if len(sys.argv) > 6 else None

        with open(cards_json, "r", encoding="utf-8") as f:
            data = json.load(f)
        cards = data.get("cards", data) if isinstance(data, dict) else data

        res = generate_art_prompts(cards, arch_name, output_md, layout, style_bible)
        print(json.dumps(res, ensure_ascii=False, indent=2))

    elif cmd == "slice":
        # art_slicer.py slice <image_path> <card_ids_comma_or_json> <output_dir> [rows] [cols]
        img_path = sys.argv[2]
        ids_raw = sys.argv[3]
        out_dir = sys.argv[4]
        rows = int(sys.argv[5]) if len(sys.argv) > 5 else 3
        cols = int(sys.argv[6]) if len(sys.argv) > 6 else 3

        if ids_raw.endswith(".json") and os.path.exists(ids_raw):
            with open(ids_raw, "r", encoding="utf-8") as f:
                data = json.load(f)
            card_items = data.get("cards", data) if isinstance(data, dict) else data
            card_ids = [c["id"] for c in card_items if "id" in c]
        else:
            card_ids = [int(x.strip()) for x in ids_raw.split(",") if x.strip().isdigit()]

        res = slice_grid_image(img_path, card_ids, out_dir, rows, cols)
        print(json.dumps(res, ensure_ascii=False, indent=2))
