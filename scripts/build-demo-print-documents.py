from __future__ import annotations

import re
from pathlib import Path

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_ROW_HEIGHT_RULE, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parents[1]
INPUTS = ROOT / "deliverables" / "demo-inputs"
OUTPUTS = INPUTS / "print-ready"
INK = "183443"
MUTED = "536B75"
TEAL = "247B77"
BLUE = "456C93"
AMBER = "A96528"
PURPLE = "735D8A"
PALE = {"I": "EDF5F2", "H": "EEF3F8", "S": "F8F1E8", "R": "F1EEF5", "X": "F8ECE9", "W": "EFF4F5"}
ACCENT = {"I": TEAL, "H": BLUE, "S": AMBER, "R": PURPLE, "X": "A64F3F", "W": "507C80"}


def between(text: str, start: str, end: str) -> str:
    if start not in text:
        raise ValueError(f"Missing section: {start}")
    tail = text.split(start, 1)[1]
    return tail.split(end, 1)[0] if end in tail else tail


def parse_heading_cards(text: str, pattern: str, use_body: bool = False) -> list[tuple[str, str]]:
    matches = list(re.finditer(pattern, text, flags=re.M))
    result: list[tuple[str, str]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        body = text[match.end() : end]
        if use_body:
            body = re.sub(r"\n\s*---\s*\n", "\n", body)
            content = next((line.strip() for line in body.splitlines() if line.strip()), "")
        else:
            content = match.group(2).strip()
        result.append((match.group(1), content))
    return result


def parse_md_table(text: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for line in text.splitlines():
        if not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if not cells or all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells):
            continue
        rows.append(cells)
    return rows


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=240, start=220, bottom=240, end=220) -> None:
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for edge, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{edge}"))
        if node is None:
            node = OxmlElement(f"w:{edge}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_cell_border(cell, color="8CA6A5", size="10", style="dashed") -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        tag = f"w:{edge}"
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        element.set(qn("w:val"), style)
        element.set(qn("w:sz"), size)
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), color)


def set_repeat_table_header(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def set_font(run, size=10, color=INK, bold=False, name="Microsoft YaHei") -> None:
    run.font.name = name
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), name)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), name)
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = RGBColor.from_string(color)


def style_document(doc: Document, margins=(0.48, 0.48, 0.5, 0.5)) -> None:
    section = doc.sections[0]
    section.page_width = Inches(8.27)
    section.page_height = Inches(11.69)
    section.top_margin = Inches(margins[0])
    section.bottom_margin = Inches(margins[1])
    section.left_margin = Inches(margins[2])
    section.right_margin = Inches(margins[3])
    section.header_distance = Inches(0.22)
    section.footer_distance = Inches(0.22)

    normal = doc.styles["Normal"]
    normal.font.name = "Microsoft YaHei"
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    normal.font.size = Pt(9.5)
    normal.font.color.rgb = RGBColor.from_string(INK)
    normal.paragraph_format.space_after = Pt(4)
    normal.paragraph_format.line_spacing = 1.12

    for name, size, color in (("Title", 22, INK), ("Heading 1", 16, INK), ("Heading 2", 12, TEAL)):
        style = doc.styles[name]
        style.font.name = "Microsoft YaHei"
        style._element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = RGBColor.from_string(color)
        style.paragraph_format.space_before = Pt(8 if name != "Title" else 0)
        style.paragraph_format.space_after = Pt(5)


def add_hyperlink(paragraph, text: str, url: str, color=BLUE):
    part = paragraph.part
    relationship_id = part.relate_to(
        url,
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        is_external=True,
    )
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), relationship_id)
    run = OxmlElement("w:r")
    properties = OxmlElement("w:rPr")
    color_node = OxmlElement("w:color")
    color_node.set(qn("w:val"), color)
    properties.append(color_node)
    underline = OxmlElement("w:u")
    underline.set(qn("w:val"), "single")
    properties.append(underline)
    run.append(properties)
    text_node = OxmlElement("w:t")
    text_node.text = text
    run.append(text_node)
    hyperlink.append(run)
    paragraph._p.append(hyperlink)
    return hyperlink


def add_page_label(doc: Document, station: str, subtitle: str) -> None:
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(1)
    run = p.add_run("VHFXNEX   /   冬日健康守护   /   ")
    set_font(run, 8, MUTED, True)
    run = p.add_run(station)
    set_font(run, 9, TEAL, True)
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(5)
    run = p.add_run(subtitle)
    set_font(run, 8, MUTED)


def keep_row_together(row) -> None:
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement("w:cantSplit")
    tr_pr.append(cant_split)


def add_card_page(doc: Document, station: str, group: str, cards: list[tuple[str, str]]) -> None:
    add_page_label(doc, station, f"{group}  ·  A4 原尺寸打印，沿卡片边框裁剪")
    table = doc.add_table(rows=2, cols=2)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    for row in table.rows:
        # Leave enough vertical room for the two-row grid to stay on one A4
        # page after the station label and trailing paragraph are laid out.
        row.height = Inches(4.35)
        row.height_rule = WD_ROW_HEIGHT_RULE.AT_LEAST
        keep_row_together(row)
        for cell in row.cells:
            cell.width = Inches(3.62)
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            set_cell_margins(cell, top=300, start=250, bottom=260, end=250)
            set_cell_border(cell)
            cell.text = ""

    for index in range(4):
        row_index, col_index = divmod(index, 2)
        cell = table.cell(row_index, col_index)
        if index < len(cards):
            card_id, content = cards[index]
        else:
            card_id, content = "备用空白卡", "主持人可手写补充同类内容"
        prefix = re.match(r"[A-Z]", card_id)
        key = prefix.group(0) if prefix else (re.match(r"[A-Z]", cards[0][0]).group(0) if cards else "W")
        set_cell_shading(cell, PALE.get(key, "EFF4F5"))
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.LEFT
        p.paragraph_format.space_after = Pt(12)
        run = p.add_run(card_id)
        set_font(run, 13, ACCENT.get(key, TEAL), True)
        p = cell.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.line_spacing = 1.22
        run = p.add_run(content)
        set_font(run, 17 if len(content) < 48 else 15, INK, True)
        if index >= len(cards):
            p = cell.add_paragraph()
            p.alignment = WD_ALIGN_PARAGRAPH.LEFT
            p.paragraph_format.space_before = Pt(18)
            p.paragraph_format.space_after = Pt(4)
            run = p.add_run("补充内容：________________________")
            set_font(run, 9, MUTED)
            for _ in range(2):
                p = cell.add_paragraph()
                p.paragraph_format.space_after = Pt(4)
                run = p.add_run("________________________________")
                set_font(run, 9, MUTED)

    blank = doc.add_paragraph()
    blank.paragraph_format.space_after = Pt(0)
    blank.paragraph_format.space_before = Pt(0)
    blank.paragraph_format.line_spacing = 0.5
    set_font(blank.add_run(" "), 1)


def build_participant_deck(clothing, health, scenarios, actions, word_cards, out_path: Path) -> None:
    doc = Document()
    style_document(doc, margins=(0.42, 0.42, 0.48, 0.48))
    pages: list[tuple[str, str, list[tuple[str, str]]]] = []
    groups = [
        ("第 1 站｜冬日穿搭卡片排序", "衣物分类卡", clothing),
        ("第 2 站｜健康说法核验卡", "判断卡", health),
        ("第 3 站｜温暖行动卡排序", "情境卡", scenarios),
        ("第 3 站｜温暖行动卡排序", "行动卡", actions),
        ("第 4 站｜冬日温暖词接龙", "主题卡", word_cards),
    ]
    for station, label, cards in groups:
        for offset in range(0, len(cards), 4):
            pages.append((station, label, cards[offset : offset + 4]))
    for page_index, (station, label, cards) in enumerate(pages):
        if page_index:
            doc.add_page_break()
        add_card_page(doc, station, label, cards)
    doc.core_properties.title = "冬日健康守护参与者纸卡"
    doc.core_properties.subject = "四站纸笔活动参与者卡片，打印后剪开使用"
    doc.core_properties.author = "VHFXNEX"
    doc.save(out_path)


def shade_header(row, fill=INK):
    set_repeat_table_header(row)
    for cell in row.cells:
        set_cell_shading(cell, fill)
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        for paragraph in cell.paragraphs:
            for run in paragraph.runs:
                set_font(run, 8.5, "FFFFFF", True)


def add_data_table(doc: Document, rows: list[list[str]], widths=None, font_size=8.5):
    if not rows:
        return
    cols = len(rows[0])
    table = doc.add_table(rows=1, cols=cols)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    table.style = "Table Grid"
    for index, value in enumerate(rows[0]):
        cell = table.rows[0].cells[index]
        cell.text = value
        if widths:
            cell.width = Inches(widths[index])
    shade_header(table.rows[0])
    for source_row in rows[1:]:
        cells = table.add_row().cells
        keep_row_together(table.rows[-1])
        for index, value in enumerate(source_row[:cols]):
            cells[index].text = value
            cells[index].vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            if widths:
                cells[index].width = Inches(widths[index])
            set_cell_margins(cells[index], top=90, start=100, bottom=90, end=100)
            for paragraph in cells[index].paragraphs:
                paragraph.paragraph_format.space_after = Pt(1)
                paragraph.paragraph_format.line_spacing = 1.05
                for run in paragraph.runs:
                    set_font(run, font_size, INK)
    return table


def add_bullets(doc: Document, items: list[str], font_size=9):
    for item in items:
        paragraph = doc.add_paragraph(style="List Bullet")
        paragraph.paragraph_format.left_indent = Inches(0.22)
        paragraph.paragraph_format.first_line_indent = Inches(-0.12)
        paragraph.paragraph_format.space_after = Pt(2)
        paragraph.paragraph_format.line_spacing = 1.08
        run = paragraph.add_run(item)
        set_font(run, font_size, INK)


def add_lead(doc: Document, text: str, fill="EFF4F5"):
    table = doc.add_table(rows=1, cols=1)
    cell = table.cell(0, 0)
    set_cell_shading(cell, fill)
    set_cell_margins(cell, top=130, start=170, bottom=130, end=170)
    p = cell.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    run = p.add_run(text)
    set_font(run, 9, INK, True)


def add_section_heading(doc: Document, text: str, level="Heading 1"):
    doc.add_paragraph(text, style=level)


def build_host_guide(
    constraints,
    game_reference,
    game_cards,
    health_cards,
    out_path: Path,
) -> None:
    doc = Document()
    style_document(doc, margins=(0.52, 0.52, 0.62, 0.62))
    title = doc.add_paragraph(style="Title")
    title.add_run("冬日健康守护 主持人现场指南")
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(8)
    set_font(p.add_run("四站轮转 · 20 名参与者 · 75 分钟"), 11, TEAL, True)
    add_lead(
        doc,
        "本指南供志愿者现场分工和主持使用。每站 8 分钟、每轮换场 2 分钟；所有活动均可用书写、指认或同伴代述参与。",
    )

    add_section_heading(doc, "活动执行总览")
    overview = [
        ["参与者", "志愿者", "分组", "站点", "现金预算"],
        [
            f"{constraints['participants']} 人",
            f"{constraints['volunteers']} 人（另有 1 名机动名额）",
            f"{constraints['groups']} 组 × 每组 {constraints['participantsPerGroup']} 人",
            f"{constraints['stations']} 站并行",
            f"{constraints['cashBudgetCny']} 元（不代表物料已盘点）",
        ],
    ]
    add_data_table(doc, overview, widths=[0.9, 1.25, 1.5, 1.05, 2.3], font_size=8)

    add_section_heading(doc, "志愿者岗位")
    add_bullets(
        doc,
        [
            "志愿者 1–4：分别固定主持第 1–4 站，按站点答案说明玩法和收集卡片。",
            "志愿者 5：现场统筹与安全；确认换场节奏，遇到湿滑路线或参与者要求暂停时先处置现场。",
            "第 6 名志愿者（如有）：签到、物料机动或经同意后协助拍摄；不把拍摄列为必需环节。",
        ],
    )

    add_section_heading(doc, "75 分钟时间安排")
    schedule = parse_md_table(
        between(game_reference, "## 75 分钟安排与轮转", "| 小组")
    )
    add_data_table(doc, schedule, widths=[2.55, 1.5, 1.0], font_size=8)
    add_lead(
        doc,
        "四轮站点任务各 8 分钟、三次换场各 2 分钟。若延误，先使用机动缓冲；不得缩短安全说明或催促参与者赶场。",
        fill="F8F1E8",
    )

    doc.add_page_break()
    add_section_heading(doc, "第 1 站 冬日穿搭卡片排序")
    add_lead(
        doc,
        "用时约 8 分钟。把 I/M/O/A 卡分为贴身层、保暖层、防风外层和配件，再为有风的冬日通勤挑选 1–2 件配件并说明理由。",
        fill=PALE["I"],
    )
    clothing_table = parse_md_table(between(game_cards, "### 主持人分类参考", "## 站点 3"))
    add_data_table(doc, clothing_table, widths=[0.9, 1.25, 4.2], font_size=8.5)
    add_bullets(
        doc,
        [
            "分类仅为活动示例；允许参与者说明合理的替代分类，不把衣物选择当作健康评价。",
            "发卡前先核对 I01–A02 共 8 张；结束时按卡号回收。",
        ],
        font_size=8.5,
    )

    doc.add_page_break()
    add_section_heading(doc, "第 2 站 健康说法核验卡")
    rules = between(health_cards, "### 8 分钟玩法", "## 参与者卡片")
    add_lead(doc, re.sub(r"\s+", " ", rules).strip(), fill=PALE["H"])
    health_table = parse_md_table(between(health_cards, "## 主持人答案", "## 来源与复核记录"))
    add_data_table(doc, health_table, widths=[0.55, 1.05, 4.8], font_size=7.7)
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(6)
    set_font(p.add_run("来源："), 8.5, INK, True)
    add_hyperlink(
        p,
        "国家卫健委《中国公民健康素养释义》第 33–34 页",
        "https://www.nhc.gov.cn/xcs/c100123/202404/c30d31cb877749ce94ce23d2c55ad973/files/1733220375762_77083.pdf",
    )
    add_bullets(
        doc,
        [
            "H01–H03 为来源支持的简短改写；H04–H06 用于识别绝对化、遗漏条件或错误性质。",
            "不诊断、不治疗、不询问个人病史。来源更新或活动时间变更时，主持人须先复核卡片。",
        ],
        font_size=8.2,
    )

    doc.add_page_break()
    add_section_heading(doc, "第 3 站 温暖行动卡排序")
    add_lead(
        doc,
        "用时约 8 分钟。小组将 S01–S06 情境卡与 R01–R06 行动卡配对，再讨论 X01–X02 为什么不合适。",
        fill=PALE["S"],
    )
    action_table = parse_md_table(between(game_cards, "### 主持人答案", "## 站点 4"))
    add_data_table(doc, action_table, widths=[0.7, 1.0, 4.75], font_size=8.2)
    add_bullets(
        doc,
        [
            "R05 的重点是尊重暂停，并按学校现场流程寻求负责人协助；志愿者不替参与者诊断。",
            "若地面湿滑或出现赶场风险，先停下并告知现场统筹；不为赶进度要求奔跑。",
        ],
        font_size=8.5,
    )

    doc.add_page_break()
    add_section_heading(doc, "第 4 站 冬日温暖词接龙")
    station_four = between(game_cards, "## 站点 4｜冬日温暖词接龙", "## 打印与现场复核")
    word_rules = between(station_four, "### 主持人规则（约 8 分钟）", "### 参与者主题卡")
    add_lead(doc, re.sub(r"\s+", " ", word_rules).strip(), fill=PALE["W"])
    prompts = parse_heading_cards(
        between(game_cards, "### 参与者主题卡｜剪开使用", "### 主持人提示"),
        r"^#### (W\d{2})｜(.+)$",
    )
    prompt_rows = [["卡号", "主题提示"], *[[card_id, content] for card_id, content in prompts]]
    add_data_table(doc, prompt_rows, widths=[0.75, 5.7], font_size=8.5)
    add_section_heading(doc, "全场待确认事项", level="Heading 2")
    add_bullets(
        doc,
        [
            "日期与开始时间、联办单位及联系人尚未确认。",
            "场地可用时段、核定容量、通道和无障碍条件须由学校确认；活动总到场按 25 人核算。",
            "纸张、笔和其他可借物料需现场盘点；现金采购预算为 0 元，不代表物资已齐备。",
            "卡包是主持人复核草案，不是学校或卫生部门审定材料；活动批准、预约、人员承诺和实际举办均未确认。",
        ],
        font_size=8.5,
    )

    doc.core_properties.title = "冬日健康守护主持人现场指南"
    doc.core_properties.subject = "75 分钟四站纸笔互动活动主持与现场核对"
    doc.core_properties.author = "VHFXNEX"
    doc.save(out_path)


def main() -> None:
    OUTPUTS.mkdir(parents=True, exist_ok=True)
    constraints = __import__("json").loads((INPUTS / "主场景约束.json").read_text(encoding="utf-8"))
    game_reference = (INPUTS / "纸笔游戏设计参考.md").read_text(encoding="utf-8")
    game_cards = (INPUTS / "纸笔游戏四站卡包.md").read_text(encoding="utf-8")
    health_cards = (INPUTS / "健康知识判断卡-主持人版.md").read_text(encoding="utf-8")

    clothing = parse_heading_cards(
        between(game_cards, "### 参与者卡片｜剪开使用", "### 主持人分类参考"),
        r"^#### ((?:I|M|O|A)\d{2})｜(.+)$",
    )
    health = parse_heading_cards(
        between(health_cards, "## 参与者卡片｜打印后沿分隔线剪开", "## 主持人答案"),
        r"^### (H\d{2})$",
        use_body=True,
    )
    scenario_cards = parse_heading_cards(
        between(game_cards, "### 参与者情境卡｜剪开使用", "### 参与者行动卡｜剪开使用"),
        r"^#### (S\d{2})｜(.+)$",
    )
    action_cards = parse_heading_cards(
        between(game_cards, "### 参与者行动卡｜剪开使用", "### 主持人答案"),
        r"^#### ((?:R|X)\d{2})｜(.+)$",
    )
    word_cards = parse_heading_cards(
        between(game_cards, "### 参与者主题卡｜剪开使用", "### 主持人提示"),
        r"^#### (W\d{2})｜(.+)$",
    )

    expected = {"clothing": 8, "health": 6, "scenarios": 6, "actions": 8, "word_cards": 12}
    actual = {
        "clothing": len(clothing),
        "health": len(health),
        "scenarios": len(scenario_cards),
        "actions": len(action_cards),
        "word_cards": len(word_cards),
    }
    if actual != expected:
        raise ValueError(f"Card source count mismatch: expected {expected}, got {actual}")

    build_participant_deck(
        clothing,
        health,
        scenario_cards,
        action_cards,
        word_cards,
        OUTPUTS / "冬日健康守护参与者卡片.docx",
    )
    build_host_guide(
        constraints,
        game_reference,
        game_cards,
        health_cards,
        OUTPUTS / "冬日健康守护主持人现场指南.docx",
    )
    print(f"Created print-ready DOCX files in {OUTPUTS}")


if __name__ == "__main__":
    main()
