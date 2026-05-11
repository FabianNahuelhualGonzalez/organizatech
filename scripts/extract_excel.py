import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

XLSX = Path(sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\fanah\Downloads\progreso_v2.1.1.xlsx")
OUTPUT = Path(sys.argv[2] if len(sys.argv) > 2 else "supabase/excel-seed.json")

NS = {
    "a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

ROUTINE_NAMES = {
    "Pecho Hombro Triceps": "Pecho Hombro Tríceps",
    "Espalda Biceps": "Espalda Bíceps Abdomen",
    "Piernas": "Piernas",
}


def cell_row(ref):
    return int(re.sub(r"[^0-9]", "", ref))


def cell_col(ref):
    return re.sub(r"[^A-Z]", "", ref)


def read_workbook(path):
    with zipfile.ZipFile(path) as zf:
        shared = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for item in root.findall("a:si", NS):
                shared.append("".join(text.text or "" for text in item.findall(".//a:t", NS)))

        workbook = ET.fromstring(zf.read("xl/workbook.xml"))
        rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        relmap = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
        sheets = []

        for sheet in workbook.find("a:sheets", NS):
            rid = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
            sheets.append((sheet.attrib["name"], "xl/" + relmap[rid].lstrip("/")))

        result = {}
        for sheet_name, sheet_path in sheets:
            if sheet_name == "Control_Versiones":
                continue
            root = ET.fromstring(zf.read(sheet_path))
            cells = {}
            for cell in root.findall(".//a:c", NS):
                ref = cell.attrib.get("r")
                if not ref:
                    continue
                value = cell.find("a:v", NS)
                if value is None:
                    continue
                text = value.text or ""
                if cell.attrib.get("t") == "s":
                    text = shared[int(text)]
                cells[ref] = text
            result[sheet_name] = cells
        return result


def parse_number(value, default=0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def build_seed(sheets):
    exercises = {}
    entries = []

    for sheet_name, cells in sheets.items():
        routine = ROUTINE_NAMES.get(sheet_name, sheet_name)
        rows = sorted({cell_row(ref) for ref in cells if 5 <= cell_row(ref) <= 120})
        for row in rows:
            name = cells.get(f"A{row}", "").strip()
            if not name or name.lower().startswith("semana"):
                continue
            target_sets = int(parse_number(cells.get(f"B{row}"), 4))
            target_reps = int(parse_number(cells.get(f"C{row}"), 10))
            weight = parse_number(cells.get(f"N{row}"), parse_number(cells.get(f"E{row}"), 0))
            reps = [int(parse_number(cells.get(f"{col}{row}"), 0)) for col in ["H", "I", "J", "K"]]
            if sum(reps) == 0:
                continue

            exercise_id = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
            exercises[exercise_id] = {
                "id": exercise_id,
                "routine": routine,
                "name": name,
                "targetSets": target_sets,
                "targetReps": target_reps,
                "baseWeight": weight,
                "sideWeight": parse_number(cells.get(f"F{row}"), None),
                "notes": cells.get(f"G{row}", "") or None,
            }
            week = 1 + (row - 5) // 14
            entries.append(
                {
                    "id": f"{exercise_id}-s{week}",
                    "exerciseId": exercise_id,
                    "exerciseName": name,
                    "routine": routine,
                    "week": week,
                    "date": f"2026-05-{min(31, 3 + ((week - 1) * 7)):02d}",
                    "targetSets": target_sets,
                    "targetReps": target_reps,
                    "weight": weight,
                    "previousWeight": weight,
                    "reps": reps[:target_sets],
                    "notes": cells.get(f"G{row}", "") or None,
                }
            )

    return {"exercises": list(exercises.values()), "entries": entries}


if __name__ == "__main__":
    seed = build_seed(read_workbook(XLSX))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(seed, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {len(seed['exercises'])} ejercicios y {len(seed['entries'])} registros exportados a {OUTPUT}")
