"""Regression checks for the public editable anatomy slide specimens."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from build_servier_fixture import polished_asset_path


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "fixtures" / "assets"
CASE = json.loads((ROOT / "fixtures" / "servier-visual.json").read_text(encoding="utf-8"))
NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
}


def read_part(deck: Path, name: str) -> ET.Element:
    with zipfile.ZipFile(deck) as archive:
        return ET.fromstring(archive.read(name))


class ServierFixtureTests(unittest.TestCase):
    def test_public_fixture_verifies_in_clean_clone_without_private_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            project = Path(folder)
            tools = project / "src" / "web_demo" / "tools"
            fixtures = project / "src" / "web_demo" / "fixtures"
            tools.mkdir(parents=True)
            (fixtures / "assets").mkdir(parents=True)
            shutil.copy2(Path(__file__).with_name("build_servier_fixture.py"), tools)
            shutil.copy2(ROOT / "fixtures" / "servier-visual.json", fixtures)
            shutil.copy2(ROOT / "fixtures" / "assets.sha256", fixtures)
            for asset in ASSETS.iterdir():
                shutil.copy2(asset, fixtures / "assets" / asset.name)
            result = subprocess.run([sys.executable, str(tools / "build_servier_fixture.py")],
                                    capture_output=True, text=True, check=False)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertIn("Verified 18 target languages", result.stdout)

    def test_generator_refuses_raw_branding_assets(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "qa" / "renders").mkdir(parents=True)
            (root / "qa" / "renders" / "en_Servier_Visual_System.png").write_bytes(b"raw")
            with self.assertRaises(FileNotFoundError):
                polished_asset_path(root, "servier-visual-en.png")

    def test_public_decks_exclude_unlicensed_master_logos(self) -> None:
        for item in CASE["translations"]:
            with self.subTest(language=item["language"]):
                deck = ASSETS / Path(item["download"]).name
                master = read_part(deck, "ppt/slideMasters/slideMaster1.xml")
                self.assertEqual([], master.findall(".//p:pic", NS))
                footer = " ".join(node.text or "" for node in master.findall(".//a:t", NS))
                self.assertIn("Servier Medical Art", footer)
                self.assertIn("creativecommons.org/licenses/by/4.0", footer)

    def test_slide_titles_have_safe_top_margin(self) -> None:
        for item in CASE["translations"]:
            with self.subTest(language=item["language"]):
                deck = ASSETS / Path(item["download"]).name
                slide = read_part(deck, "ppt/slides/slide1.xml")
                title = next(shape for shape in slide.findall(".//p:sp", NS)
                             if shape.find("./p:nvSpPr/p:cNvPr", NS).get("name") == "ZoneTexte 2")
                top = title.find("./p:spPr/a:xfrm/a:off", NS)
                self.assertIsNotNone(top)
                self.assertGreaterEqual(int(top.get("y")), 76200)  # 8 px at 96 dpi

    def test_caption_font_is_capped_for_cloud_clearance(self) -> None:
        for item in CASE["translations"]:
            with self.subTest(language=item["language"]):
                slide = read_part(ASSETS / Path(item["download"]).name, "ppt/slides/slide1.xml")
                caption = next(shape for shape in slide.findall(".//p:sp", NS)
                               if shape.find("./p:nvSpPr/p:cNvPr", NS).get("name") == "ZoneTexte 3")
                sizes = [int(run.get("sz")) for run in caption.findall(".//a:rPr", NS) if run.get("sz")]
                self.assertTrue(sizes)
                self.assertLessEqual(max(sizes), 1100)

    def test_long_compound_labels_fit_without_arbitrary_word_break(self) -> None:
        targeted = {"de": ("NETZHAUTGEFÄSSE", 700), "pl": ("TWARDÓWKA", 750)}
        for language, (word, maximum) in targeted.items():
            with self.subTest(language=language):
                slide = read_part(ASSETS / f"servier-visual-{language}.pptx", "ppt/slides/slide1.xml")
                label = next(shape for shape in slide.findall(".//p:sp", NS)
                             if "".join(node.text or "" for node in shape.findall(".//a:t", NS)) == word)
                sizes = [int(run.get("sz")) for run in label.findall(".//a:rPr", NS) if run.get("sz")]
                self.assertTrue(sizes)
                self.assertLessEqual(max(sizes), maximum)


if __name__ == "__main__":
    unittest.main()
