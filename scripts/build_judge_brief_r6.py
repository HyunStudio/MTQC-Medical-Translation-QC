"""Generate the current two-page English judge brief; no provider calls."""
import argparse
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--source-commit', required=True)
parser.add_argument('--source-zip-sha256', required=True)
args = parser.parse_args()
assert len(args.source_commit) == 40 and len(args.source_zip_sha256) == 64
root = Path(__file__).resolve().parents[1]
out = Path(args.output)
out.parent.mkdir(parents=True, exist_ok=True)
navy, teal = colors.HexColor('#123044'), colors.HexColor('#087f83')
body = ParagraphStyle('body', fontName='Helvetica', fontSize=9.4, leading=13, spaceAfter=8)
small = ParagraphStyle('small', parent=body, fontSize=8, leading=10.5, textColor=colors.HexColor('#41586a'))
title = ParagraphStyle('title', parent=body, fontName='Helvetica-Bold', fontSize=24, leading=29, textColor=navy, spaceAfter=12)
head = ParagraphStyle('head', parent=body, fontName='Helvetica-Bold', fontSize=12, leading=16, textColor=teal, spaceBefore=10)
mono = ParagraphStyle('mono', parent=small, fontName='Courier', fontSize=7.1, leading=10)
def p(s, style=body): return Paragraph(s, style)
def link(label, url): return f'<link href="{escape(url, quote=True)}" color="#087f83">{escape(label)}</link>'
def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor('#cbdde3'))
    canvas.line(42, 42, 570, 42)
    canvas.setFillColor(navy)
    canvas.setFont('Helvetica', 8)
    canvas.drawString(42, 29, 'MTQC r6 | October 30, 2026 | Research prototype')
    canvas.drawRightString(570, 29, f'{doc.page} / 2')
    canvas.restoreState()

story = [p('Medical Translation QC', title), p('r6 - live judge access and reproducible web source', head),
    p('A review-first workbench for short medical-document excerpts: source comparison, browser-local PDF/OCR, NVIDIA Nemotron drafting and scoped deterministic checks. No clinical certification is claimed.'),
    p(link('Open the hosted workbench', 'https://mtqc-nebius-2026-hyunstudio.azurewebsites.net/')+' | '+link('Public Apache-2.0 source', 'https://github.com/HyunStudio/MTQC-Medical-Translation-QC'))]
rows = [[p('<b>Current access</b>'), p('Live drafting ON within the owner-authorized budget. Judges need no login, API key or payment.')],
        [p('<b>Software identity</b>'), p('Source and r6 build commit:<br/>'+args.source_commit, mono)],
        [p('<b>Executed evidence</b>'), p('Application producer 7f9b0f27: 150 server tests, including 33 money guards; Windows/Ubuntu CI passed. Two real short requests succeeded. The r6 application src/ tree is unchanged.')]]
t = Table(rows, colWidths=[115, 413], hAlign='LEFT')
t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(0,-1),colors.HexColor('#e8f4f4')),('BOX',(0,0),(-1,-1),.6,colors.HexColor('#cbdde3')),('INNERGRID',(0,0),(-1,-1),.4,colors.HexColor('#cbdde3')),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
story += [t, p('Try it in three steps', head),
    p('<b>1. Immediate demonstration.</b> Select Arterial-venous anatomy / Figure 1, choose Korean, Spanish or Arabic, then click <b>Translate fixed excerpt</b>. Only the caption is drafted; a repeated fixed example may be cached.'),
    p('<b>2. Your own short excerpt.</b> Choose a rights-cleared non-sensitive English PDF (up to two pages) or PNG/JPEG (up to 10 MiB). Verify intended source regions and the derived preview, choose a target, confirm source review/rights, and click <b>Translate and review excerpt</b>. Leave experimental critique unchecked.'),
    p('<b>3. Review evidence.</b> Compare source and draft, model/token metadata and scoped findings. Unassessed categories and unreviewed status are intentional. Supported target selection is not validation in every language. Do not enter patient data.'),
    p('Operating limits', head),
    p('USD 5 total application reservation envelope, USD 0.50/day and USD 0.15/run; historical commitments count. Existing lifetime and hourly limits remain. At current tax1 maximum reservations, at most seven one-call requests fit a KST day, fewer after other use. Normal successful calls need no manual settlement before the next; unknown/failed charges or exhausted limits pause access.'),
    p('No automatic retry, top-up or invented receipt. These controls are not a provider billing hard cap. Operator service end: December 31, 2026 at 23:59 KST, not a promotional-credit expiry claim.', small),
    PageBreak(), p('Evidence, setup and limits', title),
    p('Observed hosted browser result - producer 7f9b0f27', head)]
image = Image(str(root/'docs/web-demo/evidence/live-access-20261030.png'))
image.drawHeight = 528 * image.imageHeight / image.imageWidth
image.drawWidth = 528
story += [image, Spacer(1,5), p('Real Spanish fixed-caption draft, 173 input / 87 output tokens; a separate Korean synthetic excerpt returned 165 / 27. Both full reservations stayed pending and access remained available. No new paid run is claimed for r6.', small),
    p('Source, build and package', head),
    p('Extract MTQC-public-source-20261030-r6.zip and follow its root README with .NET 10 SDK and Node.js 24. Local source builds keep paid/native routes OFF by default. Word and the older Windows installer are not bundled. The package manifest binds current files; r5 is retained as a historical baseline.'),
    p('Nested source archive SHA-256:', small), p(args.source_zip_sha256, mono),
    p('Current deployment and package checks are detailed in DEPLOYMENT-RECORD.json and VALIDATION-REPORT.txt. The 150-test/CI and two-call evidence belongs to the unchanged producer code; r6 packaging is not a new medical evaluation.', small),
    p('Limits and rights', head),
    p('Clinical expert review: <b>0/15</b>. General original-PDF recovery, arbitrary scanned math, figure relationships and accepted translated-figure output remain incomplete. No all-language accuracy, continuous uptime or organizer eligibility is certified. The 2:49 video predates activation and labels historical inference/local artifacts.'),
    p('First-party source: Apache-2.0 with the owner supplemental grant; scientific and third-party rights remain separate. Screenshot caption adapts Mueller et al., Front. Physiol. 14:1162391 (2023), DOI 10.3389/fphys.2023.1162391, CC BY 4.0. The model translation remains unreviewed.', small),
    p(link('Current access record', 'https://github.com/HyunStudio/MTQC-Medical-Translation-QC/blob/main/docs/web-demo/LIVE_ACCESS_20261030.md')+' | '+link('Windows / Ubuntu CI', 'https://github.com/HyunStudio/MTQC-Medical-Translation-QC/actions/runs/41029603359')+' | '+link('Video - 2:49', 'https://youtu.be/954tVuF-6Qw'), small)]
doc = SimpleDocTemplate(str(out), pagesize=(612,792), leftMargin=42, rightMargin=42, topMargin=40, bottomMargin=54, title='MTQC r6 - Judge brief', author='HyunStudio')
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(str(out))
