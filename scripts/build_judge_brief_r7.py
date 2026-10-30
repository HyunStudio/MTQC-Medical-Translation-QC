"""Build the dated two-page r7 judge brief. No network, provider or Word use."""
import argparse
from pathlib import Path
from html import escape
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate,Paragraph,Table,TableStyle,PageBreak

p=argparse.ArgumentParser()
p.add_argument('--output',required=True);p.add_argument('--source-commit',required=True)
p.add_argument('--source-zip-sha256',required=True)
p.add_argument('--measure-only',action='store_true')
a=p.parse_args()
assert len(a.source_commit)==40 and len(a.source_zip_sha256)==64
out=Path(a.output)
if not a.measure_only:
 if out.exists():raise SystemExit('Output exists; preserve it and use a distinct correction filename')
 out.parent.mkdir(parents=True,exist_ok=True)
navy=colors.HexColor('#123044');teal=colors.HexColor('#087f83')
body=ParagraphStyle('body',fontName='Helvetica',fontSize=9.3,leading=12.6,spaceAfter=7)
small=ParagraphStyle('small',parent=body,fontSize=8.1,leading=10.6)
title=ParagraphStyle('title',parent=body,fontName='Helvetica-Bold',fontSize=23,leading=27,textColor=navy,spaceAfter=10)
head=ParagraphStyle('head',parent=body,fontName='Helvetica-Bold',fontSize=11.5,leading=15,textColor=teal,spaceBefore=9)
mono=ParagraphStyle('mono',parent=small,fontName='Courier',fontSize=7,leading=10)
def para(text,style=body):return Paragraph(text,style)
def link(label,url):return '<link href="'+escape(url,quote=True)+'" color="#087f83">'+escape(label)+'</link>'
def footer(c,d):
 c.saveState();c.setStrokeColor(colors.HexColor('#cbdde3'));c.line(42,42,570,42)
 c.setFont('Helvetica',8);c.setFillColor(navy);c.drawString(42,29,'MTQC r7 | October 30, 2026 | Research prototype')
 c.drawRightString(570,29,str(d.page)+' / 2');c.restoreState()

story=[para('Medical Translation QC',title),para('r7 - judge access, real-paper tests and honest limits',head),
 para('A source-linked workbench for short English medical excerpts, browser-local PDF/OCR, NVIDIA Nemotron drafting and scoped deterministic checks. A returned draft is not a certified medical translation.'),
 para(link('Open the hosted app','https://mtqc-nebius-2026-hyunstudio.azurewebsites.net/')+' | '+link('Public source and setup','https://github.com/HyunStudio/MTQC-Medical-Translation-QC/tree/r7-20261030-final'))]
rows=[[para('<b>Judge access</b>'),para('No judge account, API key or payment. Saved examples need no model call. Live short-excerpt drafting was available after the final new test.')],
 [para('<b>Runtime</b>'),para('710bb1ac3702df2bd36ff2cf89ddbd2a382e9dca',mono)],
 [para('<b>Current policy</b>'),para('Owner-authorized USD 5/KST day, USD 100 cumulative, USD 0.15/run. Full dispatched maximum reservations remain consumed. No automatic retry or top-up.')]]
t=Table(rows,colWidths=[115,413],hAlign='LEFT')
t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('BACKGROUND',(0,0),(0,-1),colors.HexColor('#e8f4f4')),('BOX',(0,0),(-1,-1),.6,colors.HexColor('#cbdde3')),('INNERGRID',(0,0),(-1,-1),.4,colors.HexColor('#cbdde3')),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),6)]))
story += [t,para('Try it in three steps',head),
 para('1. Select Arterial-venous anatomy / Figure1, a target, then Translate fixed excerpt. A repeated fixed caption may be cached; it is distinct from saved previews.'),
 para('2. For a distinct excerpt, select a rights-cleared non-sensitive English PDF up to 2 pages or PNG/JPEG up to 10 MiB. Compare/correct selected source regions, save, verify, inspect the derived preview and confirm source review/rights.'),
 para('3. Click Translate and review excerpt once, leaving experimental critique unchecked. Compare draft, numbers, warnings, not-assessed categories and token metadata. Do not enter patient information.'),
 para('What the additional three-paper study actually showed',head),
 para('Thirty original pages from three CC BY papers were imported in17 selections and visually compared as source previews. This does not prove translated-layout recovery. Three model requests returned two drafts and one failure, with no retry or critique.'),
 para('<b>Ultrasound:</b> medical phantom became ghost; terminology was not assessed. <b>MRI:</b> request failed with no observed usage; failure retained. <b>Microfluidic:</b> 0.6 s became 10.6 s, and the numeric rule flagged it. Neither draft has independent clinical validation.'),
 para('Access is bounded:3 requests/client/hour,20 global/hour,100 lifetime attempts and single upstream concurrency remain. At tax1 at most78 new one-call dispatches fit an unused KST day. Limits or invalid state can pause access; recorded examples remain available.',small),PageBreak()]
story += [para('Evidence, reproducibility and boundaries',title),
 para('Software changes and verification',head),
 para('Unsaved main source text/type/box now holds excerpt admission and clears consent. Saved corrections need verification again; an exact revert can reuse saved verification with fresh consent. Deployed module versioning/revalidation repairs stale browser code; deployment ZIP timestamps use UTC. Fifty related money tests passed. Runtime 710bb1ac passed Windows and Ubuntu clean-clone CI; earlier tests retain their own producer scope.'),
 para(link('Exact runtime CI','https://github.com/HyunStudio/MTQC-Medical-Translation-QC/actions/runs/41060024476')+' | '+link('Current release guide','https://github.com/HyunStudio/MTQC-Medical-Translation-QC/blob/main/docs/web-demo/RELEASE_R7_20261030.md')),
 para('Financial-state handling',head),
 para('V2 keeps every dispatched maximum reserve, including finished failures. A completed no-observed-usage or valid-priced failure permits another caller only after run ownership releases. Active/orphaned calls, invalid observed usage/model, corrupt state, exhausted limits, expiry and unaccepted legacy failures still block. Actual billing remains unconfirmed without a genuine receipt.'),
 para('The earlier MRI call keeps unknown-cost/failed state and its entire reserve through explicit owner loss acceptance, not a fake bill. Schema 3 rejects historical tools. The deployment controller retained an outer failure on equivalent UTC/KST timestamp text; separate read-only checks verified the actual settings/state. The final test added one pending full reserve; earlier entries remained intact. These are app controls, not a provider billing hard cap. Service ends December 31, 2026 at 23:59 KST, not a claimed credit expiry.',small),
 para('What remains incomplete',head),
 para('Three table titles yielded unresolved1x1 placeholders with zero recovered cells. Figure associations/read order remain unreviewed. Fixed-crop local OCR produced1/82/32 unreviewed candidates with many errors. No accepted translated figure, general original-PDF/math reconstruction, whole-book translation or all-language medical accuracy is claimed. Independent clinical expert review: <b>0/15</b>.'),
 para('Build the source with .NET 10 SDK and Node 24 using the root README. Keep local inference/native features OFF by default. The older Windows Word engine and installer are separate; second-PC installation is unverified. First-party Apache-2.0, the owner five-file grant and distinct third-party/scientific rights are preserved.',small),
 para('New study sources - each CC BY 4.0',head),
 para('Songsaeng et al.(2024), ultrasound, '+link('10.3389/fphy.2024.1456478','https://doi.org/10.3389/fphy.2024.1456478')+'<br/>Kokhanovskyi et al.(2025), cardiac MRI, '+link('10.3389/fcvm.2025.1572318','https://doi.org/10.3389/fcvm.2025.1572318')+'<br/>Pourmostafa et al.(2024), microfluidics, '+link('10.3389/fbioe.2024.1421592','https://doi.org/10.3389/fbioe.2024.1421592'),small),
 para('Source snapshot: '+a.source_commit+'<br/>Nested source SHA-256: '+a.source_zip_sha256,mono),
 para('The 2:49 video predates r7 and distinguishes historical inference from local artifacts. R5/r6 and original failures are preserved. No continuous-uptime, clinical or organizer-eligibility certification.',small)]
if a.measure_only:
 import json
 heights=[0]
 for item in story:
  if isinstance(item,PageBreak):heights.append(0)
  else:heights[-1]+=item.wrap(528,10000)[1]+item.getSpaceBefore()+item.getSpaceAfter()
 print(json.dumps({'flowableHeights':heights,'usableHeight':691,'createsPdf':False}))
 raise SystemExit(0 if len(heights)==2 and max(heights)<=691 else 1)
SimpleDocTemplate(str(out),pagesize=(612,792),leftMargin=42,rightMargin=42,topMargin=36,bottomMargin=53).build(story,onFirstPage=footer,onLaterPages=footer)
print(str(out))
