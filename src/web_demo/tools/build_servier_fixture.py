"""Export the rights-cleared, refitted SMART visual-system batch as a public fixture.

This is an offline, mechanical export. It never calls an AI provider. The raw
Servier decks must not be copied into a public release: their master contains
brand logos and their narrow original labels can clip translated words.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[3]
INPUT = PROJECT / "output" / "univabio2026"
OUTPUT = Path(__file__).resolve().parents[1] / "fixtures"
ASSETS = OUTPUT / "assets"
DECK = "Servier_Visual_System"
LANGUAGES = ("ko", "es", "ar", "zh-CN", "zh-TW", "ja", "fr", "de", "it", "pt",
             "ru", "hi", "id", "nl", "pl", "th", "tr", "vi")


def polished_asset_path(project: Path, name: str) -> Path:
    path = project / "output" / "servier-rights-fit-20261002-v3" / "final" / name
    if not path.is_file():
        raise FileNotFoundError(f"Rights-cleared, layout-checked asset missing: {path}")
    return path


def section_data(values: dict[str, str]) -> list[dict[str, str]]:
    return [
        {"id": "title", "label": "Diagram title", "text": values["pkg_00000003"]},
        {"id": "caption", "label": "System overview", "text": values["pkg_00000004"]},
        {"id": "labels", "label": "Anatomical labels", "text": " · ".join(values[f"pkg_{i:08d}"] for i in range(5, 17))},
    ]


def findings(language: str) -> list[dict[str, str]]:
    return [
        {"id": "coverage", "title": "All 14 visible strings accounted for", "status": "passed",
         "basis": f"The {language} package audit records 14 visible slide strings for this diagram; all have output IDs.",
         "sourceSection": "labels", "targetSection": "labels"},
        {"id": "geometry", "title": "Anatomy art retained; labels refitted", "status": "passed",
         "basis": "The anatomical art and connector endpoints remain in the editable deck. Label clouds were widened, title clearance increased, and master logos removed; exact slide geometry is not identical to the original.",
         "sourceSection": "caption", "targetSection": "caption"},
        {"id": "medical-review", "title": "Independent terminology review pending", "status": "needs-review",
         "basis": "Automated structure checks and rendered-slide review do not establish medical or native-speaker correctness.",
         "sourceSection": "labels", "targetSection": "labels"},
    ]


def main() -> None:
    source_units = json.loads((INPUT / "work" / f"{DECK}.units.json").read_text(encoding="utf-8"))
    source_map = {unit["Id"]: unit["Text"] for unit in source_units["units"]}
    report = json.loads((INPUT / "qa" / "structure_report.json").read_text(encoding="utf-8"))
    ASSETS.mkdir(parents=True, exist_ok=True)
    shutil.copy2(polished_asset_path(PROJECT, "servier-visual-en.png"), ASSETS / "servier-visual-en.png")
    translations = []
    for language in LANGUAGES:
        checkpoint = json.loads((INPUT / "languages" / language / f"{DECK}.checkpoint.json").read_text(encoding="utf-8"))
        manifest = json.loads((INPUT / "languages" / language / "manifest.json").read_text(encoding="utf-8"))
        audit = next(row for row in report["results"] if row["language"] == language and row["deck"] == DECK)
        assert manifest["model"] == "gpt-6-sol" and audit["visible_text_count"] == 14
        assert audit["geometry_identical"] and audit["non_slide_parts_identical"]
        preview_name = f"servier-visual-{language}.png"
        deck_name = f"servier-visual-{language}.pptx"
        shutil.copy2(polished_asset_path(PROJECT, preview_name), ASSETS / preview_name)
        shutil.copy2(polished_asset_path(PROJECT, deck_name), ASSETS / deck_name)
        translations.append({
            "language": language,
            "status": "AI_DRAFT_UNREVIEWED",
            "preview": f"/assets/{preview_name}",
            "download": f"/assets/{deck_name}",
            "sections": section_data(checkpoint["translations"]),
            "findings": findings(language),
        })

    case = {
        "id": "servier-visual",
        "title": "Visual system · anatomical chart",
        "mode": "recorded",
        "generatedUtc": "2026-09-28T02:57:35Z",
        "generator": "Recorded gpt-6-sol Codex CLI batch; structure/package validation and native PowerPoint visual review completed. No independent medical review.",
        "scope": "One editable anatomical PowerPoint chart, 14 visible strings, 18 translated target languages.",
        "source": {
            "citation": "Servier Medical Art (SMART), Educational Tools: Visual System. © Les Laboratoires Servier.",
            "url": "https://smart.servier.com/educational-tools/",
            "license": "CC BY 4.0",
            "modifications": "Diagram text translated into 18 languages. The anatomy art and connectors remain; titles and label clouds were refitted, master logos removed, and plain-text attribution retained in each PowerPoint.",
            "preview": "/assets/servier-visual-en.png",
            "sections": section_data(source_map),
        },
        "translations": translations,
    }
    (OUTPUT / "servier-visual.json").write_text(json.dumps(case, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {len(translations)} target languages to {OUTPUT}")


if __name__ == "__main__":
    main()
