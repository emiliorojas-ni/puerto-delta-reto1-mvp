from __future__ import annotations

from pathlib import Path
import shutil
import tempfile

from reto.imports.services import EXPECTED_HEADERS

OFFICIAL_DATA_DIR = (
    Path(__file__).resolve().parent.parent.parent.parent
    / "Investigacion_Reto_1"
    / "Material_oficial"
    / "datos_csv"
)


def copy_official_csvs_to_temp() -> Path:
    tmp_dir = Path(tempfile.mkdtemp(prefix="reto1_csv_"))
    for filename in EXPECTED_HEADERS.keys():
        shutil.copy2(OFFICIAL_DATA_DIR / filename, tmp_dir / filename)
    return tmp_dir
