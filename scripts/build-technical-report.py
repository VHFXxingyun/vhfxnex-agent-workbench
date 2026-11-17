"""Build the competition technical-report PDF from the maintained Markdown source.

Install the optional renderer dependency with `python -m pip install -r requirements-docs.txt`.
"""

from __future__ import annotations

import html
import re
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "deliverables" / "VHFXNEX-technical-report-draft.md"
OUTPUT = ROOT / "deliverables" / "VHFXNEX-technical-report-candidate.pdf"
FONT_PATH = ROOT / "public" / "fonts" / "NotoSansSC-GB2312.ttf"
INK = colors.HexColor("#171622")
PURPLE = colors.HexColor("#7650A8")
PALE = colors.HexColor("#F2EEF8")
RULE = colors.HexColor("#D9D4E1")
PAGE_WIDTH, PAGE_HEIGHT = A4
LEFT = RIGHT = 18 * mm
TOP = 20 * mm
BOTTOM = 19 * mm
CONTENT_WIDTH = PAGE_WIDTH - LEFT - RIGHT


def inline_markup(value: str) -> str:
    """Convert the small inline Markdown subset used in the report to Paragraph markup."""
    value = value.replace("\\|", "|")
    autolinks: list[str] = []

    def hold_autolink(match):
        autolinks.append(match.group(1))
        return f"__AUTOLINK_{len(autolinks) - 1}__"

    value = re.sub(r"<(https?://[^>]+)>", hold_autolink, value)
    escaped = html.escape(value, quote=False)
    for index, url in enumerate(autolinks):
        safe_url = html.escape(url, quote=True)
        safe_label = html.escape(url, quote=False)
        escaped = escaped.replace(
            f"__AUTOLINK_{index}__",
            f'<link href="{safe_url}" color="#7650A8" underline="1">{safe_label}</link>',
        )
    escaped = re.sub(
        r"\[([^\]]+)\]\((https?://[^\s)]+)\)",
        r'<link href="\2" color="#7650A8" underline="1">\1</link>',
        escaped,
    )
    escaped = re.sub(r"`([^`]+)`", r'<font name="NotoSansSC" size="8.1" color="#5B456F">\1</font>', escaped)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", escaped)
    return escaped


def styles():
    pdfmetrics.registerFont(TTFont("NotoSansSC", str(FONT_PATH)))
    pdfmetrics.registerFontFamily(
        "NotoSansSC", normal="NotoSansSC", bold="NotoSansSC", italic="NotoSansSC", boldItalic="NotoSansSC"
    )
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "ReportTitle", parent=base["Title"], fontName="NotoSansSC", fontSize=23,
            leading=31, textColor=INK, alignment=TA_LEFT, spaceAfter=11,
        ),
        "h1": ParagraphStyle(
            "H1", parent=base["Heading1"], fontName="NotoSansSC", fontSize=17,
            leading=24, textColor=INK, spaceBefore=14, spaceAfter=8, keepWithNext=True,
        ),
        "h2": ParagraphStyle(
            "H2", parent=base["Heading2"], fontName="NotoSansSC", fontSize=12.5,
            leading=19, textColor=PURPLE, spaceBefore=10, spaceAfter=5, keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "H3", parent=base["Heading3"], fontName="NotoSansSC", fontSize=10.2,
            leading=15, textColor=INK, spaceBefore=7, spaceAfter=4, keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "Body", parent=base["BodyText"], fontName="NotoSansSC", fontSize=9.1,
            leading=14.2, textColor=INK, alignment=TA_LEFT, spaceAfter=5,
            wordWrap="CJK", splitLongWords=1,
        ),
        "small": ParagraphStyle(
            "Small", parent=base["BodyText"], fontName="NotoSansSC", fontSize=7.6,
            leading=11.2, textColor=INK, wordWrap="CJK", splitLongWords=1,
        ),
        "quote": ParagraphStyle(
            "Quote", parent=base["BodyText"], fontName="NotoSansSC", fontSize=8.6,
            leading=13.2, textColor=colors.HexColor("#4A4055"), leftIndent=8,
            borderColor=PURPLE, borderWidth=2, borderPadding=6, spaceBefore=3, spaceAfter=7,
            wordWrap="CJK",
        ),
        "bullet": ParagraphStyle(
            "Bullet", parent=base["BodyText"], fontName="NotoSansSC", fontSize=8.9,
            leading=13.6, textColor=INK, leftIndent=11, firstLineIndent=-9,
            spaceAfter=3, wordWrap="CJK",
        ),
        "code": ParagraphStyle(
            "Code", parent=base["Code"], fontName="NotoSansSC", fontSize=7.4,
            leading=10.4, textColor=colors.HexColor("#43384D"), leftIndent=7,
            rightIndent=7, backColor=PALE, borderPadding=4, spaceAfter=1,
            wordWrap="CJK", splitLongWords=1,
        ),
        "table": ParagraphStyle(
            "TableCell", parent=base["BodyText"], fontName="NotoSansSC", fontSize=7.25,
            leading=10, textColor=INK, wordWrap="CJK", splitLongWords=1,
        ),
        "tableHead": ParagraphStyle(
            "TableHead", parent=base["BodyText"], fontName="NotoSansSC", fontSize=7.4,
            leading=10.2, textColor=colors.white, wordWrap="CJK", splitLongWords=1,
        ),
    }


def table_cells(line: str) -> list[str]:
    raw = line.strip().strip("|")
    return [cell.strip() for cell in raw.split("|")]


def is_table_separator(line: str) -> bool:
    cells = table_cells(line)
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells)


def table_widths(rows: list[list[str]]) -> list[float]:
    count = max(len(row) for row in rows)
    measures = []
    for column in range(count):
        maximum = max((len(row[column]) if column < len(row) else 0) for row in rows)
        measures.append(max(1.0, min(2.6, maximum**0.48)))
    total = sum(measures)
    return [CONTENT_WIDTH * value / total for value in measures]


def build_table(lines: list[str], sheet_styles: dict[str, ParagraphStyle]):
    rows = [table_cells(line) for line in lines if not is_table_separator(line)]
    if not rows:
        return []
    columns = max(len(row) for row in rows)
    normalized = [row + [""] * (columns - len(row)) for row in rows]
    data = []
    for row_index, row in enumerate(normalized):
        style = sheet_styles["tableHead"] if row_index == 0 else sheet_styles["table"]
        data.append([Paragraph(inline_markup(cell), style) for cell in row])
    grid = Table(data, colWidths=table_widths(normalized), repeatRows=1, hAlign="LEFT", splitByRow=1)
    grid.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#25202E")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, RULE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F8F7FA")]),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    return [grid, Spacer(1, 7)]


def parse_markdown(text: str, sheet_styles: dict[str, ParagraphStyle]):
    lines = text.splitlines()
    story = []
    i = 0
    in_fence = False
    fence_lines: list[str] = []
    first_title = True

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            if in_fence:
                for code_line in fence_lines:
                    story.append(Paragraph(inline_markup(code_line or " "), sheet_styles["code"]))
                story.append(Spacer(1, 4))
                fence_lines = []
                in_fence = False
            else:
                in_fence = True
                fence_lines = []
            i += 1
            continue

        if in_fence:
            fence_lines.append(line)
            i += 1
            continue

        if stripped == "<!-- PAGEBREAK -->":
            story.append(PageBreak())
            i += 1
            continue

        if stripped.startswith("|"):
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i])
                i += 1
            story.extend(build_table(table_lines, sheet_styles))
            continue

        if stripped.startswith("#"):
            level = min(len(stripped) - len(stripped.lstrip("#")), 3)
            heading_text = stripped[level:].strip()
            style_key = "title" if level == 1 and first_title else f"h{level}"
            if style_key == "title":
                first_title = False
            story.append(Paragraph(inline_markup(heading_text), sheet_styles[style_key]))
            if level == 1 and not first_title:
                story.append(HRFlowable(width="100%", thickness=1.2, color=PURPLE, spaceAfter=10))
            i += 1
            continue

        if stripped.startswith(">"):
            story.append(Paragraph(inline_markup(stripped[1:].strip()), sheet_styles["quote"]))
            i += 1
            continue

        if stripped.startswith("- ") or stripped.startswith("* "):
            story.append(Paragraph("• " + inline_markup(stripped[2:].strip()), sheet_styles["bullet"]))
            i += 1
            continue

        number_match = re.match(r"^(\d+)\.\s+(.*)$", stripped)
        if number_match:
            story.append(Paragraph(f'{number_match.group(1)}. {inline_markup(number_match.group(2))}', sheet_styles["bullet"]))
            i += 1
            continue

        if stripped in {"---", "***", "___"}:
            story.append(HRFlowable(width="100%", thickness=0.5, color=RULE, spaceBefore=4, spaceAfter=7))
            i += 1
            continue

        if stripped:
            story.append(Paragraph(inline_markup(stripped), sheet_styles["body"]))
        else:
            story.append(Spacer(1, 3))
        i += 1

    return story


def draw_page(canvas, document):
    canvas.saveState()
    page = canvas.getPageNumber()
    if page > 1:
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.5)
        canvas.line(LEFT, PAGE_HEIGHT - 12 * mm, PAGE_WIDTH - RIGHT, PAGE_HEIGHT - 12 * mm)
        canvas.setFont("NotoSansSC", 7.2)
        canvas.setFillColor(colors.HexColor("#716B78"))
        canvas.drawString(LEFT, PAGE_HEIGHT - 9 * mm, "VHFXNEX · 技术说明书提交候选版")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.5)
    canvas.line(LEFT, 12 * mm, PAGE_WIDTH - RIGHT, 12 * mm)
    canvas.setFont("NotoSansSC", 7.2)
    canvas.setFillColor(colors.HexColor("#716B78"))
    canvas.drawString(LEFT, 8 * mm, "2026-11-17 · 仍需补齐报名团队信息与正式演示材料")
    canvas.drawRightString(PAGE_WIDTH - RIGHT, 8 * mm, f"{page}")
    canvas.restoreState()


def main():
    if not SOURCE.exists():
        raise SystemExit(f"Markdown source not found: {SOURCE}")
    if not FONT_PATH.exists():
        raise SystemExit(f"Chinese font not found: {FONT_PATH}")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    story = parse_markdown(SOURCE.read_text(encoding="utf-8"), styles())
    document = SimpleDocTemplate(
        str(OUTPUT), pagesize=A4, rightMargin=RIGHT, leftMargin=LEFT,
        topMargin=TOP, bottomMargin=BOTTOM, title="VHFXNEX 技术说明书提交候选版",
        author="VHFXNEX 团队（待按真实信息补齐）",
        subject="项目概述、架构、AI技术方案、核心功能、验收、部署与限制",
    )
    document.build(story, onFirstPage=draw_page, onLaterPages=draw_page)
    print(f"Created {OUTPUT}")


if __name__ == "__main__":
    main()
