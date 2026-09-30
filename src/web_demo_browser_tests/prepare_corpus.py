"""Prepare ignored, local corpus inputs. Originals and derivatives are never committed."""
import argparse
import hashlib
import json
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFilter


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads(Path(__file__).with_name("corpus.sources.json").read_text(encoding="utf-8"))
    args.output.mkdir(parents=True, exist_ok=True)
    cases, inventory, thumbs = [], [], []
    for source in manifest["documents"]:
        original = args.source_root / source["file"]
        doc = fitz.open(original)
        inventory.append({**source, "sha256": hashlib.sha256(original.read_bytes()).hexdigest(), "pageCount": len(doc)})
        for page_number in source["pages"]:
            case_id = f'{source["id"]}-p{page_number:02}'
            target = args.output / f"{case_id}.pdf"
            excerpt = fitz.open()
            excerpt.insert_pdf(doc, from_page=page_number - 1, to_page=page_number - 1)
            excerpt.save(target)
            page = doc[page_number - 1]
            page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(args.output / f"{case_id}-source.png")
            (args.output / f"{case_id}-reference.txt").write_text(page.get_text(sort=True), encoding="utf-8")
            cases.append({"id": case_id, "file": target.name, "kind": "text-pdf", "source": source["id"], "pages": [page_number]})
            thumb = Image.open(args.output / f"{case_id}-source.png").convert("RGB")
            thumb.thumbnail((280, 370))
            thumbs.append((case_id, thumb))
        target = args.output / f'{source["id"]}-pair.pdf'
        excerpt = fitz.open()
        for n in source["pair"]:
            excerpt.insert_pdf(doc, from_page=n - 1, to_page=n - 1)
        excerpt.save(target)
        cases.append({"id": source["id"] + "-pair", "file": target.name, "kind": "text-pdf", "source": source["id"], "pages": source["pair"]})
        doc.close()
    for source_id, n in [("spine", 2), ("ear", 3)]:
        case_id = f"{source_id}-p{n:02}"
        img = Image.open(args.output / f"{case_id}-source.png").convert("RGB")
        target = args.output / f"{case_id}-scan.png"
        img.save(target)
        cases.append({"id": case_id + "-scan", "file": target.name, "kind": "image-ocr", "source": source_id, "pages": [n]})
    img = Image.open(args.output / "spine-p02-source.png").convert("L")
    img.thumbnail((750, 1100))
    img.filter(ImageFilter.GaussianBlur(.4)).save(args.output / "spine-p02-lowres.jpg", quality=65)
    cases.append({"id":"spine-p02-lowres","file":"spine-p02-lowres.jpg","kind":"image-ocr","source":"spine","pages":[2]})
    mixed = fitz.open(args.output / "spine-p02.pdf")
    image = Image.open(args.output / "spine-p03-source.png")
    page = mixed.new_page(width=595.276, height=841.89)
    page.insert_image(page.rect, filename=str(args.output / "spine-p03-source.png"))
    mixed.save(args.output / "spine-mixed.pdf")
    cases.append({"id":"spine-mixed","file":"spine-mixed.pdf","kind":"mixed-pdf","source":"spine","pages":[2,3]})
    for entry in manifest["images"]:
        original = args.source_root / entry["file"]
        Image.open(original).save(args.output / entry["file"])
        cases.append({**entry, "kind":"image-ocr", "source":"servier", "pages":[]})
        inventory.append({**entry,"sha256":hashlib.sha256(original.read_bytes()).hexdigest()})
    sheet = Image.new("RGB", (4 * 300, 3 * 405), "#e6edf1")
    draw = ImageDraw.Draw(sheet)
    for i, (label, thumb) in enumerate(thumbs):
        x, y = (i % 4) * 300, (i // 4) * 405
        sheet.paste(thumb, (x + 10, y + 26))
        draw.text((x + 10, y + 5), label, fill="#153e4b")
    sheet.save(args.output / "sources-contact-sheet.jpg", quality=90)
    (args.output / "cases.json").write_text(json.dumps({"cases":cases,"inventory":inventory},ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"Prepared {len(cases)} cases across 12 unique paper pages and 3 anatomy charts.")


if __name__ == "__main__":
    main()
