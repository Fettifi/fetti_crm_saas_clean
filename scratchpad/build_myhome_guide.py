# Fetti-branded borrower guide: CalHFA MyHome Assistance Program.
# Every program fact verified against CalHFA primary sources (July 2026):
#   - MyHome Program Handbook (rev. 2/28/2022) - calhfa.ca.gov/homeownership/programs/myhome.pdf
#   - Program Bulletin #2021-03 (1.00% simple interest, eff. 4/19/2021)
#   - Program Bulletin #2022-03 (cap eliminated, eff. 2/28/2022)
#   - Live MyHome program page + CalHFA Homeowner FAQ (silent second, prepayment, assumability)
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor, white
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
                                Table, TableStyle, KeepTogether, HRFlowable, PageBreak)

GREEN = HexColor("#0c7a52")
DARK = HexColor("#0f172a")
GRAY = HexColor("#475569")
LIGHT = HexColor("#f1f7f4")
BORDER = HexColor("#d7e5de")
GOLD = HexColor("#b98a00")

EMBLEM = "/Users/fetti/Desktop/fetti_crm_saas_clean_fresh/public/fetti-emblem.png"
OUT = "/Users/fetti/Desktop/CalHFA-MyHome-Borrower-Guide.pdf"

styles = getSampleStyleSheet()
def st(name, **kw):
    base = kw.pop("base", "Normal")
    s = ParagraphStyle(name, parent=styles[base], **kw)
    return s

TITLE   = st("T", base="Title", fontName="Helvetica-Bold", fontSize=19, leading=23, textColor=DARK, alignment=TA_LEFT, spaceAfter=2)
SUB     = st("S", fontSize=10.5, leading=14, textColor=GRAY, spaceAfter=8)
H2      = st("H2", fontName="Helvetica-Bold", fontSize=12.5, leading=15, textColor=GREEN, spaceBefore=7, spaceAfter=3)
BODY    = st("B", fontSize=9.4, leading=12.9, textColor=DARK, spaceAfter=4)
BULLET  = st("BU", base="Normal", fontSize=9.4, leading=12.7, textColor=DARK, leftIndent=14, bulletIndent=4, spaceAfter=2)
SMALL   = st("SM", fontSize=8, leading=11, textColor=GRAY)
CELL    = st("C", fontSize=9.3, leading=12.5, textColor=DARK)
CELLB   = st("CB", fontSize=9.3, leading=12.5, textColor=DARK, fontName="Helvetica-Bold")
CELLW   = st("CW", fontSize=9.3, leading=12.5, textColor=white, fontName="Helvetica-Bold")
BOXH    = st("BH", fontName="Helvetica-Bold", fontSize=10.5, leading=13, textColor=GREEN, spaceAfter=4)

def bullet(text):
    return Paragraph(text, BULLET, bulletText="•")

def header_footer(canvas, doc):
    canvas.saveState()
    w, h = letter
    # letterhead: emblem + firm block
    canvas.drawImage(EMBLEM, 0.75*inch, h-1.05*inch, width=0.52*inch, height=0.52*inch,
                     preserveAspectRatio=True, mask="auto")
    canvas.setFont("Helvetica-Bold", 11); canvas.setFillColor(DARK)
    canvas.drawString(1.42*inch, h-0.72*inch, "FETTI FINANCIAL SERVICES LLC")
    canvas.setFont("Helvetica", 8); canvas.setFillColor(GRAY)
    canvas.drawString(1.42*inch, h-0.86*inch, "WE DO MONEY!")
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(w-0.75*inch, h-0.66*inch, "NMLS #2267023  ·  CA DFPI #60DBO-153798")
    canvas.drawRightString(w-0.75*inch, h-0.78*inch, "5777 W Century Blvd, Suite 1435, Los Angeles, CA 90045")
    canvas.drawRightString(w-0.75*inch, h-0.90*inch, "Office: +1 424.675.6295  ·  fettifi.com")
    canvas.setStrokeColor(GREEN); canvas.setLineWidth(1.5)
    canvas.line(0.75*inch, h-1.16*inch, w-0.75*inch, h-1.16*inch)
    # footer
    canvas.setFont("Helvetica", 7); canvas.setFillColor(GRAY)
    canvas.drawString(0.75*inch, 0.42*inch,
        "Equal Housing Opportunity. Informational only — not a commitment to lend, a rate quote, or an offer to extend credit.")
    canvas.drawString(0.75*inch, 0.31*inch,
        "All MyHome terms are set by the California Housing Finance Agency (CalHFA) and are subject to change without notice. Verified against CalHFA")
    canvas.drawString(0.75*inch, 0.20*inch,
        "program handbook, bulletins #2021-03 / #2022-03, and calhfa.ca.gov as of July 2026. Fetti Financial Services LLC · NMLS #2267023 · CA #60DBO-153798.")
    canvas.setFont("Helvetica", 8)
    canvas.drawRightString(w-0.75*inch, 0.31*inch, f"Page {doc.page} of 2")
    canvas.restoreState()

doc = BaseDocTemplate(OUT, pagesize=letter,
                      leftMargin=0.75*inch, rightMargin=0.75*inch,
                      topMargin=1.28*inch, bottomMargin=0.58*inch)
frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="f")
doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=header_footer)])

story = []

# ---------- PAGE 1 ----------
story.append(Paragraph("CalHFA MyHome Assistance Program", TITLE))
story.append(Paragraph("A borrower's plain-English guide to California's down payment assistance — and exactly how the deferred second loan behind it works.", SUB))

story.append(Paragraph("What MyHome is", H2))
story.append(Paragraph(
    "MyHome is a down payment assistance program from the <b>California Housing Finance Agency (CalHFA)</b>, the state's "
    "affordable-housing lender. It gives eligible first-time homebuyers a <b>second loan</b> that covers some or all of the "
    "down payment and/or closing costs on a home anywhere in California. It can only be used together with a CalHFA first "
    "mortgage (CalHFA FHA, CalPLUS FHA, CalHFA/CalPLUS Conventional, CalHFA VA, or CalHFA USDA), arranged through a "
    "CalHFA-approved lender.", BODY))
story.append(Paragraph(
    "The key feature: <b>you make no monthly payments on it.</b> The industry calls it a “silent second” — it sits quietly "
    "behind your main mortgage until you sell, refinance, or pay the home off.", BODY))

story.append(Paragraph("How much help you can get", H2))
amounts = Table([
    [Paragraph("Your CalHFA first mortgage", CELLW), Paragraph("Maximum MyHome loan", CELLW), Paragraph("Example on a $500,000 home", CELLW)],
    [Paragraph("CalHFA FHA or CalPLUS FHA", CELL), Paragraph("<b>3.50%</b> of the purchase price or appraised value, whichever is less", CELL), Paragraph("up to <b>$17,500</b>", CELL)],
    [Paragraph("CalHFA / CalPLUS Conventional, CalHFA VA, CalHFA USDA", CELL), Paragraph("<b>3.00%</b> of the purchase price or appraised value, whichever is less", CELL), Paragraph("up to <b>$15,000</b>", CELL)],
], colWidths=[2.35*inch, 2.75*inch, 1.9*inch])
amounts.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,0), GREEN),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [white, LIGHT]),
    ("GRID", (0,0), (-1,-1), 0.6, BORDER),
    ("VALIGN", (0,0), (-1,-1), "MIDDLE"),
    ("TOPPADDING", (0,0), (-1,-1), 4), ("BOTTOMPADDING", (0,0), (-1,-1), 4),
    ("LEFTPADDING", (0,0), (-1,-1), 7), ("RIGHTPADDING", (0,0), (-1,-1), 7),
]))
story.append(amounts)
story.append(Paragraph(
    "There is <b>no dollar cap</b> — the old $15,000 limit was eliminated by CalHFA in February 2022, so the full percentage "
    "applies at any price point. Funds can be split between down payment and closing costs however your file needs.", BODY))

story.append(Paragraph("How the 1% deferred second loan actually works", H2))
story.append(Paragraph(
    "This is the part to understand before you sign. MyHome is <b>not a grant and it is never forgiven</b> — it's a real loan, "
    "secured by a recorded second lien on your home, and it works like this:", BODY))
for b in [
    "<b>No monthly payments — ever.</b> Payments are deferred for the entire life of your first mortgage. It never shows up in your monthly budget.",
    "<b>1.00% simple interest per year.</b> Interest accrues at 1% annually on the outstanding principal (the original amount, if you never make a payment) — <b>simple</b>, not compounding, so the interest itself never earns interest. On a $17,500 MyHome loan, that's $175 per year.",
    "<b>The term matches your first mortgage</b> — up to 30 years.",
    "<b>You can pay it down (or off) early, any time.</b> Voluntary payments reduce the accrued interest and principal. (CalHFA requires certified funds for payments over $1,000 and for payoffs.)",
]:
    story.append(bullet(b))

example = Table([[
    Paragraph("Worked example — what you'd actually repay", BOXH),
], [
    Paragraph(
        "You buy a $500,000 home with a CalHFA FHA first mortgage and take the full <b>$17,500</b> MyHome loan. "
        "Interest accrues at $175/year (1% simple). You sell the home 8 years later:", CELL),
], [
    Paragraph("$17,500 principal  +  8 × $175 interest ($1,400)  =  <b>$18,900 repaid from your sale proceeds</b>", CELLB),
], [
    Paragraph("Interest stops the day the loan is repaid — sell in year 5 instead and the accrued interest is $875, not $1,400. "
              "Pay it off early and it's less still.", CELL),
]], colWidths=[7.0*inch])
example.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,-1), LIGHT),
    ("BOX", (0,0), (-1,-1), 1, GREEN),
    ("TOPPADDING", (0,0), (-1,0), 8), ("TOPPADDING", (0,1), (-1,-1), 2),
    ("BOTTOMPADDING", (0,-1), (-1,-1), 8), ("BOTTOMPADDING", (0,0), (-1,-2), 2),
    ("LEFTPADDING", (0,0), (-1,-1), 10), ("RIGHTPADDING", (0,0), (-1,-1), 10),
]))
story.append(Spacer(1, 4))
story.append(KeepTogether(example))

# ---------- PAGE 2 ----------
story.append(PageBreak())
story.append(Paragraph("When the loan must be repaid", H2))
story.append(Paragraph(
    "Principal plus all accrued interest becomes due, in full, at the <b>earliest</b> of these events:", BODY))
for b in [
    "You <b>sell</b> the home or <b>transfer title</b>",
    "You <b>refinance</b> your first mortgage",
    "You <b>pay off</b> your first mortgage",
    "Your first mortgage reaches the <b>end of its term</b> (maturity)",
    "A <b>Notice of Default</b> is formally filed and recorded on the first mortgage (unless rescinded)",
]:
    story.append(bullet(b))
story.append(Paragraph(
    "<b>Planning to refinance later?</b> A refinance triggers repayment of MyHome, so make it part of the math — talk to us first. "
    "<b>Assumptions:</b> paired with an FHA first, MyHome is assumable by an eligible buyer; with any other first mortgage it is "
    "paid off at assumption.", BODY))

story.append(Paragraph("Who qualifies", H2))
for b in [
    "<b>First-time homebuyer:</b> no ownership interest in a principal residence (including a spouse's home you lived in) during the past 3 years — <b>every</b> borrower must meet this and live in the home. (Narrow disaster/HUD-184 exceptions exist — ask us.)",
    "<b>Income limits:</b> total qualifying income of all borrowers must be at or under CalHFA's limit for the county you're buying in. We look yours up when we talk.",
    "<b>Credit score & debt-to-income:</b> you must qualify for the CalHFA first mortgage itself; MyHome follows that program's credit and DTI rules.",
    "<b>Residency status:</b> U.S. citizen, U.S. national, or Qualified Alien.",
    "<b>Occupancy:</b> the home must become your primary residence within 60 days of closing. Non-occupant co-borrowers and co-signers are not allowed.",
]:
    story.append(bullet(b))

story.append(Paragraph("Eligible homes", H2))
story.append(Paragraph(
    "Single-family, one-unit residences anywhere in California — including approved condos and PUDs. Homes with a guest house, "
    "granny unit, or in-law quarters may be eligible, and manufactured housing is permitted (subject to the first mortgage's guidelines).", BODY))

story.append(Paragraph("The fine print that matters", H2))
for b in [
    "MyHome funds may <b>only</b> go toward down payment and/or closing costs — never to pay off your debts, and you can't receive cash back from it.",
    "Your combined loan-to-value (first + all seconds) can't exceed <b>105%</b>.",
    "MyHome can be layered with other assistance programs, but it must stay in <b>second lien position</b>.",
    "The lender may charge a maximum <b>$250</b> processing fee for the MyHome loan (normal third-party fees still apply).",
    "<b>Homebuyer education is required</b> — one occupying first-time borrower completes eHome's 8-hour online course (~$100; the only online option CalHFA accepts) or in-person/virtual counseling via NeighborWorks or any HUD-approved agency.",
]:
    story.append(bullet(b))

story.append(Paragraph("How to get started", H2))
story.append(Paragraph(
    "Fetti Financial Services arranges CalHFA financing through CalHFA-approved lending partners, structuring the first "
    "mortgage and the MyHome second together as one closing. Step 1: we confirm your county income limit and first-time-buyer "
    "status (10 minutes). Step 2: you complete the homebuyer education course. Step 3: the CalHFA first is locked, your "
    "MyHome funds are reserved, and we take it to closing.", BODY))
story.append(Spacer(1, 6))
cta = Table([[Paragraph(
    "<b>Questions about whether MyHome fits your purchase?</b>  Call us at <b>+1 424.675.6295</b> — we'll run your exact numbers.",
    st("CTA", fontSize=10, leading=14, textColor=DARK, alignment=TA_CENTER))]], colWidths=[7.0*inch])
cta.setStyle(TableStyle([
    ("BACKGROUND", (0,0), (-1,-1), LIGHT), ("BOX", (0,0), (-1,-1), 1, GREEN),
    ("TOPPADDING", (0,0), (-1,-1), 7), ("BOTTOMPADDING", (0,0), (-1,-1), 7),
]))
story.append(cta)

doc.build(story)
print("built", OUT)
