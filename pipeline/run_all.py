#!/usr/bin/env python3
"""Corre o pipeline de ponta a ponta sobre as imagens limpas da zona.

    M3 detect → M4 classify_signs → M5 geolocate → M6/M8 fuse → M9 export

(A recolha — fetch_mapillary.py / ingest_video.py — corre antes, à parte.)

Uso:
    python pipeline/run_all.py            # tudo
    python pipeline/run_all.py --desde geolocate   # retoma a partir de um passo
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

PASSOS = ["detect", "classify_signs", "geolocate", "fuse", "export"]


def main() -> None:
    desde = sys.argv[sys.argv.index("--desde") + 1] if "--desde" in sys.argv else PASSOS[0]
    here = Path(__file__).resolve().parent
    t0 = time.time()
    for p in PASSOS[PASSOS.index(desde):]:
        print(f"\n=== {p} ===", flush=True)
        t = time.time()
        subprocess.run([sys.executable, str(here / f"{p}.py")], check=True)
        print(f"({time.time() - t:.0f} s)")
    print(f"\npipeline completo em {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
