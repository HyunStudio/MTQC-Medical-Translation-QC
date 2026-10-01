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
OUT = ROOT / "output/pdf/medical-qc-nebius-judge-brief-final-20261002.pdf"
SCREENSHOT = ROOT / "output/video/professional-v4/03-document-frame.png"
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
doc.title = "MTQC - Nebius x NVIDIA judge brief"
doc.author = "HyunStudio"
frame = Frame(42, 54, 528, 695, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates(PageTemplate(id="brief", frames=frame, onPage=footer))
story = []

story += [
    para("Medical Translation QC", title),
    para("A visual, review-first workbench for multilingual medical-document drafts", subtitle),
    para("<b>Problem.</b> A smooth translation can still reverse an anatomical direction, alter a measurement, or detach a label from its figure. Reviewers need to see source, draft, provenance, and the limits of automated checking together."),
]
metrics = Table([
    [para("18", metric_num), para("2", metric_num), para("2", metric_num)],
    [para("live target languages", metric_label), para("local intake types: PDF + image", metric_label), para("separate model stages", metric_label)],
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
    para("2. Correct and approve a bounded source excerpt, choose one of 18 targets, then request a real <b>nvidia/Nemotron-3_5-Lightning</b> draft and a separate critique through the server-side Nebius Token Factory adapter."),
    para("3. Compare source and output, inspect quoted source-to-draft evidence, model/token metadata, deterministic checks and clearly unverified model suggestions; or inspect saved Servier anatomy drafts beside their licensed source."),
    para("Authentic local browser run", section),
]
image = Image(str(SCREENSHOT))
image.drawWidth = 528
image.drawHeight = 528 * ImageReader(str(SCREENSHOT)).getSize()[1] / ImageReader(str(SCREENSHOT)).getSize()[0]
story += [image, Spacer(1, 5), para("Reviewer-approved English source, genuine Arabic draft and separate model critique. Progress is estimated, not provider telemetry.", small)]

story += [PageBreak(), para("Evidence and limits", title), para("Runtime proof, not clinical validation", subtitle)]
evidence = [
    ("Real model path", "The browser sends only reviewer-approved text. ASP.NET Core makes sequential draft and critique calls to Nebius with a server-held key; a critique failure remains an incomplete draft, never a passed review."),
    ("18-language smoke", "One short real request per supported target returned successfully on 2026-09-29: 2,307 input and 501 output tokens total. At listed Lightning rates, this run estimates USD 0.00025866; this is not the provider billing ledger."),
    ("Regression + corpus", "66 server, 33 browser, and 18 evaluation/release/video contract checks pass. A 22-input intake pilot covers twelve medical-paper pages and three anatomy charts. Selected PDF anchors are 52/54; order edges 25/26. Mixed-PDF anchors improved 5/9 to 8/9. Known table/OCR failures remain."),
    ("Paired critique pilot", "On three frozen Korean, Spanish and Arabic drafts, rules alone and rules plus a second model call each localized all three controlled numeric/direction seeds. The second call added zero localized detections; warning count rose 7 to 22, including three adjudicated false positives. A two-seed negation retest localized zero in both arms. This is a negative small-sample result, not a quality benchmark."),
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
    para("Browser-local extraction -> editable excerpt -> bounded server API -> Nemotron draft -> separate Nemotron critique -> deterministic checks and unverified suggestions. The server atomically reserves two provider attempts. OCR replacement resets approval; duplicate submits are locked. Cancel, source edits and approval withdrawal invalidate drafts; usage may already have occurred. Calls are serial and never automatically retried."),
    para("Responsible use", section),
    para("Educational prototype only. No patient data or private manuscript. Complex table cells and OCR still require correction; raster labels in searchable PDFs are not extracted automatically. Document/diagram OCR profiles are reviewer choices. Model suggestions are not verified findings. Every draft requires expert linguistic and medical review. Hosting needs spend monitoring."),
    para("Rights and reproducibility", section),
    para("Saved Servier and Mueller material is credited under CC BY 4.0. The intake pilot uses Liu et al. (10.3389/fmed.2024.1403423), Xue et al. (10.3389/fbioe.2024.1439499), Jansen et al. (10.1371/journal.pone.0242596) and Servier charts. Source includes licenses, hashes, test code and <link href=\"https://github.com/HyunStudio/MTQC-Medical-Translation-QC/blob/main/docs/web-demo/CORPUS_EVALUATION_20260930.md\" color=\"#0a7890\">full corpus results and limitations</link>. The older Windows engine is separate."),
    Spacer(1, 10),
    para('<b>Current demo:</b> The 2:19 narrated video shows the genuine two-stage Arabic run, test evidence and limits: <link href="https://youtu.be/FE4t_vn89X8" color="#0a7890">youtu.be/FE4t_vn89X8</link>. Third-party logos in the licensed anatomy comparison are obscured; Servier attribution is retained. <link href="https://mtqc-nebius-2026-hyunstudio.azurewebsites.net/" color="#0a7890">Live workbench</link> | <link href="https://github.com/HyunStudio/MTQC-Medical-Translation-QC" color="#0a7890">Apache-2.0 code</link> | <link href="https://github.com/HyunStudio/MTQC-Medical-Translation-QC/blob/main/docs/web-demo/REVIEW_EVALUATION_20261001.md" color="#0a7890">Paired pilot</link>. Configured live mode does not prove current provider credit or entitlement.', small),
]

doc.build(story)
print(OUT)
