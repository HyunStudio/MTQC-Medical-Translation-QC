"""Create the two-page, English-only hackathon judge brief.

Run with bundled Python after the submission screenshot has been captured.
"""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/pdf/medical-qc-nebius-final-judge-brief.pdf"
SCREENSHOT = ROOT / "output/video/professional-v3/03-document-frame.png"
if not SCREENSHOT.exists():
    raise SystemExit(f"Record the authentic browser demo first: {SCREENSHOT}")
OUT.parent.mkdir(parents=True, exist_ok=True)

NAVY = colors.HexColor("#102f40")
TEAL = colors.HexColor("#0a7890")
PALE = colors.HexColor("#eaf4f6")
MUTED = colors.HexColor("#536b78")
ORANGE = colors.HexColor("#d99536")
WHITE = colors.white

body = ParagraphStyle("body", fontName="Helvetica", fontSize=9.4, leading=14.2, textColor=NAVY, spaceAfter=7)
small = ParagraphStyle("small", parent=body, fontSize=8.1, leading=11.5, textColor=MUTED)
title = ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=23, leading=27, textColor=NAVY, spaceAfter=7)
subtitle = ParagraphStyle("subtitle", parent=body, fontSize=11, leading=15, textColor=MUTED, spaceAfter=13)
section = ParagraphStyle("section", fontName="Helvetica-Bold", fontSize=12, leading=16, textColor=TEAL, spaceBefore=11, spaceAfter=6)
metric_num = ParagraphStyle("metric_num", fontName="Helvetica-Bold", fontSize=17, leading=20, textColor=NAVY, alignment=TA_CENTER)
metric_label = ParagraphStyle("metric_label", fontName="Helvetica", fontSize=7.5, leading=10, textColor=MUTED, alignment=TA_CENTER)
cell = ParagraphStyle("cell", parent=body, fontSize=8.3, leading=11.5, spaceAfter=0)


def para(text, style=body):
    return Paragraph(text, style)


def footer(canvas, doc):
    canvas.saveState()
    width, _ = doc.pagesize
    canvas.setStrokeColor(colors.HexColor("#d7e4e8"))
    canvas.line(42, 43, width - 42, 43)
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 8)
    canvas.drawString(42, 30, "Medical Translation QC  |  Nebius x NVIDIA hackathon submission")
    canvas.drawRightString(width - 42, 30, f"{doc.page} / 2")
    canvas.restoreState()


doc = BaseDocTemplate(str(OUT), pagesize=(612, 792), leftMargin=42, rightMargin=42, topMargin=43, bottomMargin=54)
frame = Frame(42, 54, 528, 695, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates(PageTemplate(id="brief", frames=frame, onPage=footer))
story = []

story += [
    para("Medical Translation QC", title),
    para("A visual, review-first workbench for multilingual medical-document drafts", subtitle),
    para("<b>Problem.</b> A smooth translation can still reverse an anatomical direction, alter a measurement, or detach a label from its figure. Reviewers need to see source, draft, provenance, and the limits of automated checking together."),
]
metrics = Table([
    [para("18", metric_num), para("2", metric_num), para("1", metric_num)],
    [para("live target languages", metric_label), para("local intake types: PDF + image", metric_label), para("server-side NVIDIA model", metric_label)],
], colWidths=[176, 176, 176], rowHeights=[25, 21])
metrics.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), PALE),
    ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#d5e8ed")),
    ("LINEBEFORE", (1, 0), (-1, -1), 0.7, colors.HexColor("#d5e8ed")),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, 0), 5),
    ("BOTTOMPADDING", (0, 1), (-1, 1), 7),
]))
story += [metrics, Spacer(1, 9), para("What a judge can do", section)]
story += [
    para("1. Select a small rights-cleared English PDF (up to two pages) or image. PDF text extraction or English OCR runs locally in the browser; the file is not uploaded."),
    para("2. Correct and approve a bounded source excerpt, choose one of 18 targets, then request a real <b>nvidia/Nemotron-3_5-Lightning</b> draft through the server-side Nebius Token Factory adapter."),
    para("3. Compare source and output, view actual model/token metadata and limited numeric/directional QC flags, or inspect saved editable Servier anatomy slides beside their licensed source."),
    para("Authentic local browser run", section),
]
image = Image(str(SCREENSHOT))
image.drawWidth = 528
image.drawHeight = 528 * ImageReader(str(SCREENSHOT)).getSize()[1] / ImageReader(str(SCREENSHOT)).getSize()[0]
story += [image, Spacer(1, 5), para("Numbered PDF reading-order review and a genuine Arabic Nemotron call. Translation progress is estimated, not provider telemetry.", small)]

story += [PageBreak(), para("Evidence and limits", title), para("Runtime proof, not clinical validation", subtitle)]
evidence = [
    ("Real model path", "The browser sends only reviewed text. ASP.NET Core calls Nebius with a server-held key and returns the model ID, token usage, and draft. No key is shipped to the browser."),
    ("18-language smoke", "One short real request per supported target returned successfully on 2026-09-29: 2,307 input and 501 output tokens total. At listed Lightning rates, this run estimates USD 0.00025866; this is not the provider billing ledger."),
    ("Regression checks", "Latest local checks passed: 46 server, 6 layout, and 22 browser tests. A reproduced PDF fragment-whitespace bug was fixed. QC warnings remain review prompts, not evidence of clinical accuracy."),
    ("Recorded specimens", "The Servier Medical Art slide has English source plus 18 saved AI-draft targets. The Mueller et al. comparison is limited to Figure 1 title, caption, and four labels - not a complete article translation."),
]
rows = [[para(label, cell), para(detail, cell)] for label, detail in evidence]
table = Table(rows, colWidths=[108, 420], hAlign="LEFT")
table.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("BACKGROUND", (0, 0), (0, -1), PALE),
    ("LINEBELOW", (0, 0), (-1, -2), 0.7, colors.HexColor("#dce8ec")),
    ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#dce8ec")),
    ("LEFTPADDING", (0, 0), (-1, -1), 9),
    ("RIGHTPADDING", (0, 0), (-1, -1), 9),
    ("TOPPADDING", (0, 0), (-1, -1), 8),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
]))
story += [table, para("Technical design", section)]
story += [
    para("Browser-local PDF.js/Tesseract extraction  ->  editable excerpt  ->  bounded ASP.NET Core API  ->  Nebius Token Factory / NVIDIA Nemotron  ->  draft plus scoped QC. Requests are disabled by default, serial at the provider boundary, limited per client and globally in-process, and never automatically retried."),
    para("Responsible use", section),
    para("Educational prototype only. No patient data, unlicensed textbook page, or private manuscript is in the release. OCR reading order can be wrong; model fluency is not medical validity. Every draft requires expert linguistic and medical review. Public live hosting also requires an external spend cap and monitoring."),
    para("Rights and reproducibility", section),
    para("Saved Servier and Mueller material is credited under CC BY 4.0 with modification notices. The new video includes credited Servier anatomy and an original synthetic two-column PDF. Source includes setup instructions, tests, asset hashes, and third-party notices. The older Windows engine predates this hackathon and is not presented as the browser runtime."),
    Spacer(1, 10),
    para('<b>Judge walkthrough:</b> Inspect saved cases, then review an excerpt in the Document workbench. The 1080p narrated video shows one authentic live call: <link href="https://youtu.be/WpYR5XfvPic" color="#0a7890">youtu.be/WpYR5XfvPic</link>.', small),
]

doc.build(story)
print(OUT)
