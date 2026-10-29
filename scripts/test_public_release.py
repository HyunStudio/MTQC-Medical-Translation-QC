"""Execute the release producer and inspect its actual judge/source archives."""
from __future__ import annotations

import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import subprocess
import unittest
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]


class PublicReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        env = dict(os.environ, DEMO_LIVE_ENABLED="false", MTQC_LOCAL_DOCUMENTS="false")
        for key in ("NEBIUS_API_KEY", "MTQC_WORD_LAYOUT_MANIFEST", "MTQC_VISUAL_AUDIT_MANIFEST"):
            env.pop(key, None)
        seeds = [ROOT / "src/web_demo/.env.release-test", ROOT / "src/web_demo/private-release-test.key"]
        marker = b"Non-secret archive exclusion test marker."
        if any(file.exists() for file in seeds):
            raise AssertionError("Refusing to overwrite existing exclusion-test files")
        try:
            for file in seeds:
                file.write_bytes(marker)
            result = subprocess.run(["pwsh", "-NoProfile", "-File", str(ROOT / "scripts/web_demo_release.ps1")],
                                    cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    encoding="utf-8", errors="replace", timeout=600)
        finally:
            for file in seeds:
                if file.exists() and file.read_bytes() == marker:
                    file.unlink()
        evidence = os.environ.get("MTQC_RELEASE_TEST_LOG_DIR")
        if evidence:
            Path(evidence).mkdir(parents=True, exist_ok=True)
            (Path(evidence) / "release-producer.log").write_text(result.stdout, encoding="utf-8")
        if result.returncode:
            raise AssertionError(f"Release producer failed ({result.returncode}):\n{result.stdout[-5000:]}")
        cls.source = Path(re.search(r"^Public source export: (.+)$", result.stdout, re.M)[1].strip())
        cls.judge = Path(re.search(r"^Judge build: (.+)$", result.stdout, re.M)[1].strip())
        print(f"Actual source ZIP: {cls.source}\nActual judge ZIP: {cls.judge}")

    def test_source_contains_all_shared_project_and_compile_dependencies(self):
        with zipfile.ZipFile(self.source) as archive:
            names = set(archive.namelist())
            self.assertIn("src/document_core/MedicalQcDocumentCore.csproj", names)
            self.assertIn("src/status_dashboard/SiblingTempPath.cs", names)
            for name in names:
                if not name.endswith(".csproj"):
                    continue
                root = ET.fromstring(archive.read(name))
                for item in list(root.iter("ProjectReference")) + list(root.iter("Compile")):
                    relative = item.get("Include")
                    if relative and "*" not in relative:
                        target = posixpath.normpath(str(PurePosixPath(name).parent / relative.replace("\\", "/")))
                        self.assertIn(target, names, f"Unresolved dependency of {name}: {relative}")

    def test_source_contains_registered_jszip_bytes_and_current_root_rights_and_readme(self):
        with zipfile.ZipFile(self.source) as archive:
            for name in ("README.md", "LICENSE", "LICENSE-SCOPE.txt",
                         "src/web_demo/wwwroot/vendor/jszip/jszip.min.mjs",
                         "src/web_demo/wwwroot/vendor/jszip/LICENSE.markdown",
                         "src/web_demo/wwwroot/vendor/jszip/manifest.json"):
                self.assertEqual(archive.read(name), (ROOT / name).read_bytes(), name)

    def test_archives_are_intact_and_exclude_runtime_state_and_debug_symbols(self):
        for file in (self.source, self.judge):
            with zipfile.ZipFile(file) as archive:
                self.assertIsNone(archive.testzip())
                for name in archive.namelist():
                    self.assertNotIn("node_modules", PurePosixPath(name).parts)
                    self.assertFalse(name.endswith((".pdb", ".log", ".pfx", ".key")), name)
                    self.assertFalse(PurePosixPath(name).name.startswith(".env"), name)
        with zipfile.ZipFile(self.judge) as archive:
            for name in ("MedicalQcWebDemo.dll", "MedicalQcDocumentCore.dll"):
                data = archive.read(name)
                self.assertNotIn(b".pdb", data.lower(), f"Embedded local symbol path: {name}")


if __name__ == "__main__":
    unittest.main()
