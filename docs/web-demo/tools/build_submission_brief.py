"""Build the two-page, evidence-bounded judge brief for the web demo.

Usage: python build_submission_brief.py SCREENSHOT OUTPUT.pdf
The screenshot is captured from the running local demo, not synthesized.
"""

from __future__ import annotations

import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


PAGE_W, PAGE_H = landscape(A4)
NAVY = colors.HexColor("#102C3B")
TEAL = colors.HexColor("#087C7B")
MINT = colors.HexColor("#E8F6F2")
PALE = colors.HexColor("#F4F7F8")
INK = colors.HexColor("#253C47")
MUTED = colors.HexColor("#667C86")
AMBER = colors.HexColor("#A56610")


def register_fonts() -> None:
    font_dir = Path("C:/Windows/Fonts")
    regular = font_dir / "arial.ttf"
    bold = font_dir / "arialbd.ttf"
    if regular.exists() and bold.exists():
        pdfmetrics.registerFont(TTFont("Brief", str(regular)))
        pdfmetrics.registerFont(TTFont("Brief-Bold", str(bold)))
    else:
        pdfmetrics.registerFontFamily("Helvetica", normal="Helvetica", bold="Helvetica-Bold")


FONT = "Brief" if Path("C:/Windows/Fonts/arial.ttf").exists() else "Helvetica"
BOLD = "Brief-Bold" if FONT == "Brief" else "Helvetica-Bold"


def para(c: canvas.Canvas, text: str, x: float, top: float, width: float,
         size: float = 9.6, leading: float = 13.2, color=INK, bold: bool = False) -> float:
    style = ParagraphStyle(
        "inline", fontName=BOLD if bold else FONT, fontSize=size,
        leading=leading, textColor=color, alignment=TA_LEFT, spaceAfter=0,
    )
    item = Paragraph(text, style)
    _, height = item.wrap(width, 1000)
    item.drawOn(c, x, top - height)
    return top - height


def line(c: canvas.Canvas, x1: float, y: float, x2: float, color=colors.HexColor("#D5E1E4")) -> None:
    c.setStrokeColor(color)
    c.setLineWidth(0.8)
    c.line(x1, y, x2, y)


def header(c: canvas.Canvas, page_no: int, title: str, subtitle: str) -> None:
    c.setFillColor(NAVY)
    c.rect(0, PAGE_H - 11, PAGE_W, 11, fill=1, stroke=0)
    c.setFillColor(TEAL)
    c.setFont(BOLD, 9)
    c.drawString(32, PAGE_H - 39, "MEDICAL / QC")
    c.setFillColor(MUTED)
    c.setFont(FONT, 8)
    c.drawRightString(PAGE_W - 32, PAGE_H - 39, "NEBIUS x NVIDIA  |  JUDGE BRIEF  |  29 SEP 2026")
    c.setFillColor(NAVY)
    c.setFont(BOLD, 22)
    c.drawString(32, PAGE_H - 74, title)
    para(c, subtitle, 32, PAGE_H - 82, PAGE_W - 64, size=10, leading=13, color=MUTED)
    line(c, 32, PAGE_H - 110, PAGE_W - 32)
    c.setFillColor(MUTED)
    c.setFont(FONT, 7.4)
    c.drawString(32, 22, "Research prototype - educational demonstration only; not clinical advice or certified translation.")
    c.drawRightString(PAGE_W - 32, 22, f"{page_no} / 2")


def section(c: canvas.Canvas, label: str, text: str, x: float, top: float,
            width: float, size: float = 9.5) -> float:
    c.setFillColor(TEAL)
    c.setFont(BOLD, 10)
    c.drawString(x, top, label.upper())
    return para(c, text, x, top - 9, width, size=size, leading=13.1) - 19


def pill(c: canvas.Canvas, x: float, y: float, width: float, text: str,
         fill=MINT, text_color=TEAL) -> None:
    c.setFillColor(fill)
    c.roundRect(x, y, width, 20, 9, fill=1, stroke=0)
    c.setFillColor(text_color)
    c.setFont(BOLD, 8.3)
    c.drawCentredString(x + width / 2, y + 6.2, text)


def flow_box(c: canvas.Canvas, x: float, y: float, width: float, height: float,
             step: str, caption: str, fill=PALE) -> None:
    c.setFillColor(fill)
    c.roundRect(x, y, width, height, 8, fill=1, stroke=0)
    c.setFillColor(TEAL)
    c.setFont(BOLD, 9.4)
    c.drawString(x + 11, y + height - 21, step)
    para(c, caption, x + 11, y + height - 30, width - 22,
         size=8.2, leading=10.6, color=INK)


def build(screenshot: Path, output: Path) -> None:
    if not screenshot.is_file():
        raise FileNotFoundError(screenshot)
    output.parent.mkdir(parents=True, exist_ok=True)
    register_fonts()
    c = canvas.Canvas(str(output), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    c.setTitle("Medical Translation QC - Nebius x NVIDIA Judge Brief")
    c.setAuthor("Medical Translation QC")

    # Page 1: real visual, product boundary, reviewer value.
    header(c, 1, "Medical translation needs visible evidence",
           "A review workbench for image-rich source material, draft outputs, and explicit QC boundaries.")
    img_x, img_y, img_w, img_h = 32, 73, 491, 376
    c.setFillColor(PALE)
    c.roundRect(img_x - 4, img_y - 4, img_w + 8, img_h + 8, 7, fill=1, stroke=0)
    c.drawImage(str(screenshot), img_x, img_y, width=img_w, height=img_h,
                preserveAspectRatio=True, anchor="c", mask="auto")
    c.setFillColor(MUTED)
    c.setFont(FONT, 7.4)
    c.drawString(img_x, 57, "Actual local browser capture: Müller et al. Figure 1 case, Korean draft.")

    right_x, right_w = 548, PAGE_W - 580
    top = PAGE_H - 128
    top = section(c, "Review the source and the draft",
                  "Open original and translated previews side by side, inspect aligned title, caption, and labels, and follow QC findings back to the content.",
                  right_x, top, right_w)
    top = section(c, "Recorded versus live",
                  "Recorded specimens need no key. A separate <b>fixed-caption</b> option makes a real runtime call to NVIDIA Nemotron on Nebius Token Factory when the server operator enables it.",
                  right_x, top, right_w)
    top = section(c, "19 displayed languages, honestly counted",
                  "The Servier chart has one English source plus 18 saved draft target slides. This does <b>not</b> mean 19 live model calls or a medically validated translation set.",
                  right_x, top, right_w)
    top = section(c, "Scope is explicit",
                  "The Müller article specimen translates only Figure 1's title, caption, and four labels. The two-column article body remains English; medical and native-speaker review remains pending.",
                  right_x, top, right_w)
    pill(c, right_x, max(73, top - 4), right_w, "AI DRAFT - HUMAN REVIEW REQUIRED",
         fill=colors.HexColor("#FFF1D9"), text_color=AMBER)
    c.showPage()

    # Page 2: implementation, evidence, licensing, and limits.
    header(c, 2, "A bounded live path, not a simulated API",
           "Evidence-led design: runtime Nemotron inference is separate from saved multilingual specimens.")
    c.setFillColor(TEAL)
    c.setFont(BOLD, 9.8)
    c.drawString(32, PAGE_H - 133, "RECORDED REVIEW PATH")
    x0, gap = 32, 10
    box_w = (PAGE_W - 64 - 3 * gap) / 4
    for i, (step, caption) in enumerate([
        ("Licensed source", "CC BY figure and anatomy chart with attribution"),
        ("Saved draft", "Editable slides and three Figure 1 comparisons"),
        ("Scoped QC", "Coverage, geometry, numerical and terminology flags"),
        ("Workbench", "Source / target image and linked review evidence"),
    ]):
        flow_box(c, x0 + i * (box_w + gap), 378, box_w, 68, step, caption)

    c.setFillColor(TEAL)
    c.setFont(BOLD, 9.8)
    c.drawString(32, 356, "OPTIONAL LIVE EXCERPT PATH")
    live_gap = 8
    live_w = (PAGE_W - 64 - 4 * live_gap) / 5
    for i, (step, caption) in enumerate([
        ("Fixed source", "Müller Figure 1 caption; no arbitrary upload"),
        ("Server gate", "Key stays server-side; limits and 20s timeout"),
        ("Nebius API", "Token Factory runtime call"),
        ("NVIDIA model", "Nemotron-3_5-Lightning"),
        ("QC + review", "Direction and exact-number warnings"),
    ]):
        flow_box(c, x0 + i * (live_w + live_gap), 280, live_w, 67, step, caption,
                 fill=MINT if i in (2, 3) else PALE)

    col_gap = 14
    col_w = (PAGE_W - 64 - 2 * col_gap) / 3
    col_x = [32, 32 + col_w + col_gap, 32 + 2 * (col_w + col_gap)]
    top = 260
    section(c, "Implementation",
            "ASP.NET Core/.NET 10; server-side API key; 640-character source cap; 256 requested output tokens; three uncached attempts per client and 20 global attempts per hour. In-process limits are <b>not</b> a monetary hard stop.",
            col_x[0], top, col_w, size=8.9)
    section(c, "Verified locally",
            "32/32 .NET checks; 8/8 browser checks; release-publish fixture validation; eight real short Nemotron calls across Korean, Spanish, and Arabic. Token-price estimate: ~$0.00026, <b>not</b> a provider billing statement.",
            col_x[1], top, col_w, size=8.9)
    section(c, "Rights and limitations",
            "Servier Medical Art and Müller et al. source material are attributed under CC BY 4.0 with modifications disclosed in RIGHTS.md. No patient data or textbook pages. Draft translation, not clinical approval. Public hosting and spending control need separate verification.",
            col_x[2], top, col_w, size=8.9)

    c.setFillColor(TEAL)
    c.setFont(BOLD, 9.8)
    c.drawString(32, 163, "OBSERVED LIVE MODEL RISKS - EXPLICITLY LEFT FOR HUMAN REVIEW")
    for i, (step, caption) in enumerate([
        ("Directional drift", "An early Korean call replaced proximal with distal; prompt guidance and QC now flag the substitution."),
        ("Untranslated term", "An Arabic call retained English anatomy wording; glossary guidance and a residual-English warning were added."),
        ("Number formatting", "A later Arabic call changed 2,185 to 2185; exact-format numeric QC still warns rather than silently repairing it."),
    ]):
        flow_box(c, col_x[i], 86, col_w, 64, step, caption,
                 fill=colors.HexColor("#FFF7E9"))

    line(c, 32, 75, PAGE_W - 32)
    para(c, "Sources: smart.servier.com/educational-tools/; doi:10.3389/fphys.2023.1162391; nebiusglobalaihackathon.devpost.com/rules. <b>Product release status:</b> local judge build verified; public URL, repository and video pending.",
         32, 68, PAGE_W - 64, size=7.5, leading=10, color=MUTED)
    c.showPage()
    c.save()


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: build_submission_brief.py SCREENSHOT OUTPUT.pdf")
    build(Path(sys.argv[1]), Path(sys.argv[2]))
