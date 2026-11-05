#!/usr/bin/env python3
"""
slice_grid.py: Standalone Python 3 script using Pillow to slice an image grid into square cells.
"""

import argparse
import json
import os
import sys
from PIL import Image


def slice_grid(input_path: str, rows: int, cols: int, output_dir: str, margin_percent: float, card_ids_raw: str):
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input image not found: {input_path}")

    os.makedirs(output_dir, exist_ok=True)

    card_ids = [cid.strip() for cid in card_ids_raw.split(",") if cid.strip()] if card_ids_raw else []

    img = Image.open(input_path)
    # Convert RGBA or Palette to RGB/RGBA if needed
    img_w, img_h = img.size

    cell_w = img_w / cols
    cell_h = img_h / rows

    margin_x = cell_w * (margin_percent / 100.0)
    margin_y = cell_h * (margin_percent / 100.0)

    cells = []

    for r in range(rows):
        for c in range(cols):
            idx = r * cols + c
            card_id = card_ids[idx] if idx < len(card_ids) else f"cell_{idx}"

            left = int(round(c * cell_w + margin_x))
            top = int(round(r * cell_h + margin_y))
            right = int(round((c + 1) * cell_w - margin_x))
            bottom = int(round((r + 1) * cell_h - margin_y))

            # Clamp boundaries
            left = max(0, min(left, img_w - 1))
            top = max(0, min(top, img_h - 1))
            right = max(left + 1, min(right, img_w))
            bottom = max(top + 1, min(bottom, img_h))

            cropped = img.crop((left, top, right, bottom))

            out_filename = f"{card_id}_art.png"
            out_filepath = os.path.join(output_dir, out_filename)
            cropped.save(out_filepath, "PNG")

            abs_path = os.path.abspath(out_filepath).replace("\\", "/")

            cells.append({
                "index": idx,
                "cardId": card_id,
                "path": abs_path,
                "width": cropped.width,
                "height": cropped.height
            })

    return cells


def main():
    parser = argparse.ArgumentParser(description="Slice a grid image into individual card artworks.")
    parser.add_argument("--input", required=True, help="Path to input grid image.")
    parser.add_argument("--rows", type=int, required=True, help="Number of rows in the grid.")
    parser.add_argument("--cols", type=int, required=True, help="Number of columns in the grid.")
    parser.add_argument("--output-dir", required=True, help="Directory to save cropped cells.")
    parser.add_argument("--margin-percent", type=float, default=1.5, help="Margin trim percentage (default: 1.5%%).")
    parser.add_argument("--card-ids", default="", help="Comma-separated card IDs in reading order.")

    args = parser.parse_args()

    try:
        cells = slice_grid(
            input_path=args.input,
            rows=args.rows,
            cols=args.cols,
            output_dir=args.output_dir,
            margin_percent=args.margin_percent,
            card_ids_raw=args.card_ids
        )
        print(json.dumps({"success": True, "cells": cells}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
