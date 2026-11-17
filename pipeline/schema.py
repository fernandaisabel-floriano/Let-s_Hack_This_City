"""Contratos de dados partilhados entre A (deteção), B (geo) e C (app).

Três formatos:
  * IMAGE_FIELDS — uma linha por imagem limpa (já desfocada) em images.csv.
    Escrito pela M1 (fetch_mapillary.py) e pelo P1.1 (ingest_video.py).
  * Detection    — uma deteção (saída de M3/M4, entrada de M5/M6).
  * EXPORT_FIELDS — um elemento do inventário exportado (M9).

Todos os caminhos são relativos à pasta do images.csv correspondente, para
que data/ possa ser copiada (Google Drive) sem partir nada.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Optional

# --------------------------------------------------------------------- imagens

FONTES = ("mapillary", "video_proprio")

IMAGE_FIELDS = [
    "id",              # chave única da linha = nome do ficheiro sem .jpg
    "image_id",        # id na origem (Mapillary: id da imagem/panorâmica; vídeo: <video>_<frame>)
    "view",            # 0–3 para vistas cortadas de panorâmica; vazio para imagens planas
    "fonte",           # mapillary | video_proprio
    "lon", "lat",      # posição da câmara, WGS84
    "coord_fonte",     # computed | original | gpx
    "heading",         # direção da câmara em graus (0 = norte, sentido horário)
    "heading_fonte",   # computed | original | movimento
    "captured_at",     # ISO 8601 UTC
    "is_pano",         # a imagem de origem era panorâmica
    "fov_deg",         # campo de visão horizontal da imagem gravada (se conhecido)
    "focal_norm",      # focal / max(largura, altura) da imagem gravada (se conhecida)
    "sequence",        # sequência Mapillary ou nome do vídeo
    "camera_type",     # perspective | fisheye | spherical (origem)
    "camera_parameters",  # JSON da origem (Mapillary), ou vazio
    "width", "height",    # da imagem gravada
    "ficheiro",        # images/<id>.jpg
    "autor", "autor_id",
    "licenca", "atribuicao",
    "url_origem",
    "rostos", "matriculas", "cabecas",  # n.º de regiões desfocadas nesta imagem
]

# -------------------------------------------------------------------- deteções

CLASSES = ("sinal", "candeeiro", "contentor")


@dataclass
class Detection:
    id: str
    image_id: str
    view: Optional[int]          # 0–3 ou None
    bbox: list[float]            # [x1, y1, x2, y2] em px na imagem gravada
    classe: str                  # sinal | candeeiro | contentor
    subclasse: Optional[str]     # p.ex. stop, cedencia_passagem, limite_50, outro_sinal
    confianca: float             # 0–1 (deteção)
    recorte: Optional[str]       # caminho relativo do recorte
    heading_camara: float
    lat_camara: float
    lon_camara: float
    extra: dict = field(default_factory=dict)  # p.ex. confianca_classificacao

    def __post_init__(self):
        if self.classe not in CLASSES:
            raise ValueError(f"classe inválida: {self.classe}")
        if self.view is not None and self.view not in (0, 1, 2, 3):
            raise ValueError(f"view inválida: {self.view}")
        if len(self.bbox) != 4 or not (self.bbox[0] < self.bbox[2] and self.bbox[1] < self.bbox[3]):
            raise ValueError(f"bbox inválida: {self.bbox}")
        if not 0.0 <= self.confianca <= 1.0:
            raise ValueError(f"confianca fora de [0,1]: {self.confianca}")

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Detection":
        return cls(**{k: d.get(k) for k in cls.__dataclass_fields__ if k in d})


# ----------------------------------------------------------------- exportação

ESTADOS = ("auto", "validado", "corrigido", "rejeitado")

EXPORT_FIELDS = [
    "id", "tipo", "subtipo", "lat", "lon", "x", "y", "epsg_local",
    "confianca", "n_vistas", "estado", "primeira_vista", "ultima_vista",
    "imagem", "fonte", "atribuicao",
]
