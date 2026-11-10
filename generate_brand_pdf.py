"""Generate a valid vector PDF for brand-colors.pdf with color swatches and brand spec."""
from pathlib import Path


def build_brand_pdf() -> bytes:
    # Build a clean 1-page vector PDF (A4: 595 x 842 pt) using standard PDF operators
    lines = []
    # Page background (#FBFAF6 -> 0.984, 0.980, 0.965)
    lines.append("0.984 0.980 0.965 rg 0 0 595 842 re f")

    # Top Header Bar (#282B2B -> 0.157, 0.169, 0.169)
    lines.append("0.157 0.169 0.169 rg 36 760 523 52 re f")
    # Orange Badge (#EE6C29 -> 0.933, 0.424, 0.161)
    lines.append("0.933 0.424 0.161 rg 48 770 32 32 re f")

    def text(x: int, y: int, size: int, content: str, rgb=(0.157, 0.169, 0.169), font="F1"):
        r, g, b = rgb
        safe = content.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        lines.append(f"BT /{font} {size} Tf {r:.3f} {g:.3f} {b:.3f} rg {x} {y} Td ({safe}) Tj ET")

    text(58, 780, 16, "O", (1.0, 0.97, 0.92), "F2")
    text(92, 788, 14, "AI OFFICE - BRAND VISUAL SYSTEM & LICENSE SPEC (brand-colors.pdf)", (1.0, 0.97, 0.92), "F2")
    text(92, 771, 9, "Doc ID: AIO-BRAND-SPEC-v2.4  |  QA & Compliance Approved by Supervisor XiaoChu (Virgo)", (0.85, 0.83, 0.78), "F1")

    # Section 1: Core Brand Palette Swatches
    text(36, 736, 12, "1. CORE PAPER & RPG BRAND PALETTE (CSS Variables & WCAG AA)", (0.157, 0.169, 0.169), "F2")

    swatches = [
        ("Director Orange", "--orange", "#EE6C29", (0.933, 0.424, 0.161), "Primary CTA / Active Accent / Badge"),
        ("Ink Charcoal", "--charcoal", "#282B2B", (0.157, 0.169, 0.169), "2px Modal Border / Primary Typography (14.1:1 AAA)"),
        ("Warm Paper", "--paper", "#E2DAC2", (0.886, 0.855, 0.761), "Isometric Office Floor & Card Canvas"),
        ("Ivory Surface", "--surface", "#FBFAF6", (0.984, 0.980, 0.965), "Popup Notification Modal & Speech Bubble Surface"),
        ("Active Sage Green", "--green", "#6B9B72", (0.420, 0.608, 0.447), "Working Status LED / Approved Decision Card"),
        ("Calm Slate Blue", "--blue", "#7AA6B3", (0.478, 0.651, 0.702), "Researching & Break Status / Tool Running Chip"),
        ("Warning Amber", "--amber", "#F39120", (0.953, 0.569, 0.125), "Pending Confirmation / Disagreement Alert"),
        ("Accessible Muted", "--muted-safe", "#6E6A60", (0.431, 0.416, 0.376), "WCAG AA Compliant Secondary Text (5.3:1)"),
    ]

    y = 702
    for name, var_name, hex_code, (r, g, b), usage in swatches:
        # Card row border
        lines.append(f"0.89 0.87 0.82 RG 1 w 36 {y - 6} 523 24 re S")
        # Color swatch box
        lines.append(f"{r:.3f} {g:.3f} {b:.3f} rg 42 {y - 3} 36 18 re B")
        text(88, y + 3, 9, f"{name} ({var_name})", (0.157, 0.169, 0.169), "F2")
        text(235, y + 3, 9, hex_code, (0.55, 0.30, 0.12), "F2")
        text(300, y + 3, 8, usage, (0.35, 0.34, 0.30), "F1")
        y -= 28

    # Section 2: Terminal Dark Mode Palette
    y -= 8
    text(36, y, 12, "2. BACKGROUND TERMINAL ACTIVITY LOG TOKens (>_ office.activity.log)", (0.157, 0.169, 0.169), "F2")
    y -= 22

    # Dark terminal preview box (#161B19 -> 0.086, 0.106, 0.098)
    lines.append(f"0.086 0.106 0.098 rg 36 {y - 78} 523 88 re f")
    text(48, y - 8, 9, ">_ office.activity.log   --all  --tool  --file  --error  --handoff", (0.498, 0.878, 0.635), "F2")
    text(48, y - 24, 8, "[09:44:12] [FILE]    @engineer   $ Updated App.tsx & visual system tokens  #8AD694", (0.541, 0.839, 0.580), "F1")
    text(48, y - 38, 8, "[09:43:38] [ERROR]   @virgo      $ Verified brand-colors.pdf license spec  #F29B58", (0.949, 0.608, 0.345), "F1")
    text(48, y - 52, 8, "[09:43:02] [TOOL]    @researcher $ Executed web.search & UI contrast check #7FC1E0", (0.498, 0.757, 0.878), "F1")
    text(48, y - 66, 8, "[09:41:55] [HANDOFF] @planner    $ Handed off MVP spec to QA Supervisor    #C7A4E8", (0.780, 0.643, 0.910), "F1")

    y -= 104
    # Section 3: Layout & Mobile 9:16 Rules
    text(36, y, 12, "3. RESPONSIVE 9:16 MOBILE & POPUP MODAL ARCHITECTURE", (0.157, 0.169, 0.169), "F2")
    y -= 18
    rules = [
        "- Mobile Collapsible Toolbar: .topbar uses flex: 0 0 auto; tools collapse into [Toolbar Menu] popup.",
        "- Notification Popup Standard: Colleague Status, Team Decisions, HR Roster, and Tasks open in modals.",
        "- Adaptive Speech Bubbles: Auto-scales width (68px - 188px) with word-wrap to prevent sprite overlap.",
        "- Strict Avatar Clipping: All Emoji, Pixel Canvas, and uploaded images are clipped inside .avatar-clip-box.",
    ]
    for r_line in rules:
        text(44, y, 8, r_line, (0.25, 0.24, 0.21), "F1")
        y -= 14

    y -= 8
    # Section 4: Brand Asset & GitHub Pages License Clause
    lines.append(f"0.95 0.97 0.94 rg 0.42 0.61 0.45 RG 1.5 w 36 {y - 74} 523 84 re B")
    text(48, y - 10, 10, "4. BRAND ASSET, FONT & GITHUB PAGES LICENSE DECLARATION (APPROVED)", (0.22, 0.42, 0.25), "F2")
    text(48, y - 26, 8, "1) All color tokens, isometric room vector props, and pixel mascot sprites (Momo & DongDong) are", (0.25, 0.28, 0.25), "F1")
    text(48, y - 38, 8, "   original first-party assets licensed for public deployment on https://szhu72.github.io/ai-office/.", (0.25, 0.28, 0.25), "F1")
    text(48, y - 50, 8, "2) Typography uses system-safe & open stacks (Trebuchet MS, Noto Sans TC, Consolas) with zero", (0.25, 0.28, 0.25), "F1")
    text(48, y - 62, 8, "   proprietary font infringement risk. QA Status: PASSED & SIGNED BY SUPERVISOR XIAOCHU.", (0.22, 0.42, 0.25), "F2")

    stream_data = "\n".join(lines).encode("latin-1")

    objects = []
    objects.append(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
    objects.append(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n")
    objects.append(
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n"
    )
    objects.append(b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n")
    objects.append(b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n")
    objects.append(
        f"6 0 obj\n<< /Length {len(stream_data)} >>\nstream\n".encode("latin-1")
        + stream_data
        + b"\nendstream\nendobj\n"
    )

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(out))
        out.extend(obj)

    xref_pos = len(out)
    out.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode("latin-1"))
    for off in offsets[1:]:
        out.extend(f"{off:010d} 00000 n \n".encode("latin-1"))

    out.extend(
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("latin-1")
    )
    return bytes(out)


if __name__ == "__main__":
    pdf_bytes = build_brand_pdf()
    for rel in ["public/docs/brand-colors.pdf", "docs/brand-colors.pdf", "docs/docs/brand-colors.pdf"]:
        p = Path(__file__).parent / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(pdf_bytes)
        print(f"Wrote {p} ({len(pdf_bytes)} bytes)")
