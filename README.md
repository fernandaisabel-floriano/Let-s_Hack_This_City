# Let's Hack This City - Ctrl+F Aveiro

**Um inventário municipal de mobiliário urbano que se mantém sozinho.**

Ctrl+F Aveiro deteta e localiza no mapa os sinais de trânsito, os candeeiros e os contentores do município a partir de imagens de fontes abertas e de vídeos gravados na rua, sem levantamento no terreno. Um técnico valida em minutos os casos duvidosos, o sistema fica mais preciso com cada validação e qualquer município o instala mudando um ficheiro de configuração.

Projeto desenvolvido para o **Desafio #2 do Aveiro Tech City Hackathon 2026** — *Ctrl + F Aveiro: Identificação Automática de Mobiliário Urbano* (Câmara Municipal de Aveiro e Universidade de Aveiro).

---

## Como funciona

```
Fontes                 Pipeline (tudo local)                                  Catálogo
────────────           ───────────────────────────────────────────────        ─────────────────────
Mapillary   ─┐                                                                Mapa (Leaflet + OSM)
KartaView   ─┼─▶ desfoque ─▶ deteção ─▶ classificação ─▶ posição ─▶ fusão ─▶ Fila de validação
Vídeo + GPX ─┘   rostos e    3 tipos     tipo de sinal    no mapa   sem      Exportação GeoJSON/CSV
                 matrículas                                          duplicados
```

1. **Recolha** — imagens das fontes abertas (Mapillary, KartaView) e frames de vídeo gravado na rua, sincronizados com uma trilha GPS (GPX). Cada fonte é um módulo com o mesmo formato de saída: acrescentar uma fonte é acrescentar um ficheiro.
2. **Desfoque** — rostos e matrículas são desfocados **antes** de qualquer imagem ser gravada em disco. A imagem original só existe em memória.
3. **Deteção e classificação** — modelos pré-treinados a correr localmente, sem APIs externas.
4. **Posição** — posição e direção da câmara + ângulo do objeto na imagem + distância estimada.
5. **Fusão** — o mesmo elemento visto em várias imagens e em várias fontes fica um só ponto no catálogo ("visto em N imagens").
6. **Validação** — confiança alta entra direto no catálogo; confiança baixa vai para uma fila onde o técnico confirma, rejeita ou corrige. Cada validação fica guardada como dado rotulado.

## Princípios

- **Autonomia.** Deteção e classificação correm localmente. As APIs das plataformas abertas servem só para obter imagens. O vídeo próprio permite recolher dados atuais sem depender de terceiros.
- **Privacidade por desenho.** Nenhum rosto nem matrícula é guardado ou mostrado na aplicação.
- **Melhora com o uso.** As validações calibram os limiares de confiança por tipo e formam um conjunto de dados para re-treino periódico do modelo.
- **Replicável.** Código aberto, sem serviços pagos. Município, zona, sistema de coordenadas e limiares vivem em `config/municipio.yaml`.
- **Funciona com ou sem cadastro existente.** A exportação é genérica e abre em qualquer SIG.

---

## User stories

### MVP

| # | História | Está feito quando | Estado |
|---|---|---|---|
| M1 | Como equipa, quero descarregar as imagens Mapillary da rua piloto | Script guarda imagens + posição + direção da câmara para uma bounding box | Feito |
| M2 | Como Câmara, quero que nenhum rosto ou matrícula seja guardado | Desfoque corre antes de gravar (integrado na M1 e na ingestão de vídeo) | Feito |
| M3 | Como sistema, quero detetar os 3 tipos | Sinais, candeeiros e contentores detetados com confiança | Em curso |
| M4 | Como técnico, quero saber que sinal é | STOP, cedência, limites de velocidade e "outro sinal" classificados | |
| M5 | Como sistema, quero calcular as coordenadas de cada deteção | Posição da câmara + ângulo + distância (tamanho do objeto ou ponto de contacto com o chão) | |
| M6 | Como técnico, não quero duplicados | Deteções da mesma classe a menos de ~8 m fundidas; mostra "visto em N imagens" | |
| M7 | Como técnico, quero ver tudo num mapa | Ficha com imagem, coordenadas, tipo, confiança, n.º de vistas e atribuição | |
| M8 | Como técnico, quero validar os casos duvidosos | Fila ordenada por confiança com ✓ / ✗ / mudar tipo | |
| M9 | Como técnico, quero levar os dados para o meu SIG | Exportação GeoJSON (WGS84) e CSV (WGS84 + sistema local) | |
| M10 | Como equipa, quero provar a precisão | Referência da rua piloto + script que calcula encontrados / falsos / em falta | |
| M11 | Como equipa, quero o tempo de validação | Validação completa da rua cronometrada por alguém que não programou | |
| M12 | Como Câmara, quero usar vídeo gravado na rua | Frames a cada ~2 m sincronizados com o GPX entram no mesmo pipeline | Feito (testado com dados sintéticos) |

### P1 — a seguir ao MVP

| # | História | Está feito quando |
|---|---|---|
| P1.1 | Como técnico, não quero duplicados entre fontes | O mesmo elemento no Mapillary, no KartaView e no vídeo fica um só ponto, com a lista de fontes e datas |
| P1.2 | Como Câmara, quero que o sistema melhore com o uso | Painel com precisão por tipo e limiar de entrada automática ajustado pelas validações |
| P1.3 | Como técnico, quero corrigir a posição | Arrastar o ponto no mapa grava a nova coordenada |
| P1.4 | Como outro município, quero instalar isto | Mudar `config/municipio.yaml` e correr; demonstrado numa rua de outro concelho |
| P1.5 | Como Câmara, quero saber o que mudou na rua | Elementos vistos só em fontes antigas marcados "possivelmente removido"; vistos só nas recentes, "novo" |
| P1.6 | Como equipa, quero uma segunda fonte aberta | KartaView com o mesmo formato de saída (se houver cobertura) |

### P2 — se sobrar tempo

| # | História | Está feito quando |
|---|---|---|
| P2.1 | Como sistema, quero posições mais exatas | Triangulação entre várias vistas; erro em metros medido contra a referência |
| P2.2 | Como Câmara, quero re-treinar o modelo | Contador "X exemplos prontos" + script de fine-tune |
| P2.3 | Como qualquer pessoa, quero instalar com um comando | `docker compose up` |
| P2.4 | Como técnico, quero filtrar o mapa | Filtros por tipo e estado de validação |

### Roadmap (fora do protótipo)

- Câmaras fixas em viaturas municipais com rota regular, para recolha semanal automática.
- Instância Panoramax da própria Câmara para guardar as imagens recolhidas, abertas e sob controlo municipal.
- Base de dados PostGIS para volumes à escala do município.

---

## Zona piloto

**Rua dos Santos Mártires, Aveiro** (junto à Fábrica Centro Ciência Viva). Bbox: `[-8.658917, 40.637622, -8.656677, 40.639154]`.

O Mapillary tem 54 imagens a ≤30 m da rua, todas de 2019–2021. Por isso, o **vídeo gravado na rua é a fonte principal** e o Mapillary entra como camada complementar e para a comparação entre datas (P1.5).

## Decisões técnicas

| Tema | Decisão |
|---|---|
| Fontes | Vídeo próprio + GPX (principal), Mapillary (desde 2019), KartaView (se houver cobertura) |
| Panorâmicas | Incluídas, cortadas em 4 vistas planas (FOV 90°, heading + 0/90/180/270°) |
| Desfoque | Na recolha, antes de gravar. Rostos: YuNet. Matrículas: YOLOv11s de matrículas. Cabeças de peões: YOLO11n, como rede de segurança |
| Deteção | YOLO-World (small), local; prompts por classe fixados após teste numa amostra |
| Classificação de sinais | Cascata com prioridade à precisão: CLIP sem treino (família primeiro, depois o número) + filtro de forma e cor (OpenCV) + templates dos algarismos para os limites. O incerto vai para a fila. O GTSRB foi abandonado (não tem 40 km/h nem a passadeira portuguesa) |
| Distância | Sinais: tamanho assumido da placa (~0,7 m). Candeeiros e contentores: ponto de contacto com o chão, câmara a ~2,5 m |
| Limiares | Fusão a 8 m; entrada direta no catálogo a partir de 0,6 de confiança (ambos na config) |
| Base de dados | SQLite |
| Exportação | GeoJSON em WGS84 (EPSG:4326); CSV com lat/lon + x/y no sistema local (`crs_local`, por omissão EPSG:3763 / PT-TM06) |

### Formato de uma deteção (`pipeline/schema.py`)

```
{id, image_id, view (0–3 ou null), bbox [x1,y1,x2,y2] px, classe (sinal|candeeiro|contentor),
 subclasse, confianca, recorte, heading_camara, lat_camara, lon_camara}
```

### Campos da exportação

| Campo | Exemplo |
|---|---|
| id | `avr-000123` |
| tipo | sinal / candeeiro / contentor |
| subtipo | stop, cedencia, velocidade_50 / subterraneo, ilha_reciclagem, indiferenciado |
| lat, lon | 40.6385, -8.6578 |
| x, y, epsg_local | coordenadas no sistema local, 3763 |
| confianca | 0.87 |
| n_vistas | 7 |
| estado | auto / validado / corrigido / rejeitado |
| primeira_vista, ultima_vista | datas das imagens |
| imagem | caminho ou URL do recorte |
| fonte, atribuicao | mapillary, CC BY-SA – autor |

---

## Como correr

Precisa de Python 3.10+, Node.js 20.19+ e git. Não precisa de GPU.

```bash
python -m venv .venv
.venv/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu   # PyTorch só CPU, primeiro
.venv/bin/pip install -r requirements.txt   # inclui o CLIP (do GitHub) e o pillow-heif (fotos HEIC)
cp .env.example .env        # preencher MAPILLARY_TOKEN
```

Os modelos (YOLO-World, rostos, matrículas e CLIP, ~390 MB) descarregam-se sozinhos para `models/` e `weights/clip/` na primeira execução.

**Imagens Mapillary** (zona definida em `config/municipio.yaml`):

```bash
.venv/bin/python pipeline/fetch_mapillary.py --zona santos-martires
# opções: --bbox oeste,sul,este,norte  --config caminho.yaml  --sem-imagens
```

**Vídeo gravado na rua** (um ficheiro por sentido):

```bash
.venv/bin/python pipeline/ingest_video.py VIDEO.mp4 TRACK.gpx --nome sentido_norte --offset-s X
# --relogio-fim se o telemóvel gravar a hora do fim do vídeo
```

- **Offset:** filmem uns segundos o ecrã da app de GPS com a hora à vista. O offset é a diferença entre essa hora e a do vídeo.
- Na config: `video.fov_horizontal_deg` (68° por omissão) e `video.heading_offset_deg` (0 se a câmara apontar para a frente, 90 se filmar para a direita).
- Gravem a rua nos dois sentidos: os sinais só têm a face virada para um lado.

A saída vai para `data/clean/<municipio>/<zona>/<fonte>/`, com caminhos relativos. A pasta `data/` não entra no repositório. Os modelos são descarregados para `models/` na primeira utilização.

---

## Licenças e atribuição

- **Imagens Mapillary e KartaView:** CC BY-SA. A autoria é guardada por imagem e mostrada na ficha de cada elemento.
- **Código:** aberto. Usa componentes AGPL-3.0 (Ultralytics e o modelo de matrículas), por isso o projeto é distribuído sob AGPL-3.0.
- **Mapas:** © contribuidores do OpenStreetMap.