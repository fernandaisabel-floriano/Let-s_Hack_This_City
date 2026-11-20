# Mapeya — Ctrl+F Aveiro

**Um inventário municipal de mobiliário urbano que se mantém sozinho.**

A Mapeya deteta e coloca no mapa os sinais de trânsito, os candeeiros e os contentores de um município a partir de imagens de fontes abertas, de vídeos e de fotografias tirados na rua, sem levantamento no terreno. O que o sistema dá como certo entra sozinho no inventário. Os casos duvidosos vão para uma fila onde um técnico os confirma, corrige ou rejeita em minutos. Cada decisão fica registada e serve para re-treinar o sistema. Qualquer município o instala mudando um ficheiro de configuração.

Projeto do **Desafio #2 do Aveiro Tech City Hackathon 2026**, *Ctrl + F Aveiro: Identificação Automática de Mobiliário Urbano* (Câmara Municipal de Aveiro e Universidade de Aveiro).

---

## Como funciona

```
Fontes                  Pipeline (tudo local, só CPU)                                   App web
─────────────           ─────────────────────────────────────────────────────────       ──────────────────────
Mapillary     ─┐                                                                         Mapa e catálogo (público)
Vídeo + GPX   ─┼─▶ desfoque ─▶ deteção ─▶ tipo de sinal ─▶ qualidade ─▶ posição ─▶ fusão ─▶ Fila de validação (técnico)
Fotografias   ─┘   rostos e    3 tipos    (forma + CLIP    das vistas    raios e      sem     Exportação GeoJSON / CSV
                   matrículas              + sonda)                       triangulação duplicados
```

1. **Recolha**: imagens do Mapillary, frames de vídeo sincronizados com o trajeto GPS (GPX) e fotografias com GPS no EXIF. Todas as fontes produzem o mesmo formato.
2. **Desfoque**: rostos e matrículas são desfocados **antes** de qualquer imagem ser gravada. A imagem original só existe em memória.
3. **Deteção**: YOLO-World a correr localmente, com prompts por classe.
4. **Tipo de sinal**: uma cascata que dá prioridade à precisão:
   - a forma e a cor (OpenCV) decidem primeiro: octógono vermelho → STOP, triângulo invertido → cedência;
   - os algarismos leem o valor dos limites de velocidade;
   - o CLIP e uma **sonda re-treinável** decidem o resto;
   - o que fica incerto vai para a fila.
5. **Qualidade**: as vistas tremidas, escuras ou demasiado pequenas ajudam a calcular a posição, mas não servem de prova.
6. **Posição e fusão**: cada deteção é um raio que parte da câmara.
   - Os raios de imagens diferentes **triangulam-se** num ponto.
   - Placas empilhadas no mesmo poste ficam separadas pela família do sinal.
   - O mesmo objeto visto em várias imagens e fontes fica um só elemento ("visto em N imagens").
   - Nenhum ponto fica dentro de um edifício.
   - Os ids mantêm-se entre execuções, para as decisões dos técnicos não se perderem.
7. **Validação**: limiares de entrada automática por tipo e por zona. O resto vai para a fila do técnico. Cada decisão fica num registo de auditoria e passa a ser um exemplo para o re-treino.

## Princípios

- **Autonomia.** A deteção e a classificação correm localmente, sem APIs pagas nem GPU. As plataformas abertas servem só para obter imagens.
- **Privacidade por desenho.** Nenhum rosto nem matrícula é guardado ou mostrado.
- **Prefere "não sei" a errar.** Um sinal só entra sozinho no inventário com provas suficientes. Na dúvida, vai para o técnico.
- **Melhora com o uso.** As validações ajustam os limiares e re-treinam a classificação dos sinais (`pipeline/retreino.py`).
- **Replicável.** Código aberto. Município, zonas, sistema de coordenadas e limiares vivem em `config/`.
- **Funciona com ou sem cadastro existente.** A exportação é genérica e abre em qualquer SIG.

---

## Na app

- **Mapa e catálogo** (público): cada elemento com a ficha (imagem, coordenadas, tipo, confiança, n.º de vistas e autoria da imagem), filtros por tipo e estado, e exportação GeoJSON / CSV.
- **Fila de validação** (técnico): os casos duvidosos ordenados por confiança, com confirmar, rejeitar, mudar o tipo e arrastar o ponto para corrigir a posição. Cada decisão é cronometrada e fica no registo de auditoria.
- **Selecionar vários no mapa** (técnico): unir duplicados escolhendo o que fica e a posição, ou rejeitar em massa.
- **Avisos da Câmara**: quem consulta o catálogo sem sessão pode reportar um problema num elemento (já não existe, tipo errado, posição errada). O elemento volta à fila do técnico, à frente dos outros.
- **Painel**: precisão por tipo a partir das validações e limiares de entrada automática ajustáveis por zona.
- **Importação**: novas zonas, vídeos e fotografias processados a partir da própria app.
- **Ecrã de setup do município** ao abrir a app (protótipo, só no frontend).

## Roadmap (fora do protótipo)

- Câmaras fixas em viaturas municipais com rota regular, para recolha semanal automática.
- Instância Panoramax da própria Câmara para guardar as imagens recolhidas.
- KartaView como segunda fonte aberta, se houver cobertura.
- Base de dados PostGIS e servidor próprio com HTTPS e contas da Câmara (SSO).
- Instalação com um comando (`docker compose up`).

---

## Resultados na zona piloto

**Zona piloto (Santos Mártires, Aveiro):** a Rua dos Santos Mártires, a rotunda da ponta sul e o Cais dos Santos Mártires, junto à Fábrica Centro Ciência Viva. A zona de avaliação são os eixos das vias mais 15 m.

**Contagem manual vs. o que o sistema encontrou sozinho** (só a Rua dos Santos Mártires, do Cais até à rotunda, sem a rotunda):

| | Reais | Propostos | Entram sozinhos | Para a fila |
|---|---:|---:|---:|---:|
| Sinais | 22 | 15 | 8 | 7 |
| Candeeiros | 9 | 26 | 7 | 19 |
| Contentores | 5 | 14 | 0 | 14 |

Os contentores nunca entram sozinhos, porque o detetor deles é o mais fraco. Os candeeiros têm propostas a mais, mas os que entram sozinhos (7) não passam dos reais (9).

**Tipo de sinal**, medido contra 194 recortes rotulados à mão, com a sonda avaliada fora do treino:

| | Antes (p5) | Agora (p6) |
|---|---:|---:|
| STOP reconhecidos | 50 % | 67–83 % |
| Limites reconhecidos | 25 % | 75 % |
| Sinais específicos errados | 0 | 0 |
| Elementos certos que entram sozinhos | 1 | 2 |

Os detalhes estão em `reports/m4/retreino.md`, `reports/m4/elementos.md` e `docs/notas_relatorio.md`.

---

## Decisões técnicas

| Tema | Decisão |
|---|---|
| Fontes | Mapillary (desde 2019), vídeo próprio + GPX, fotografias com GPS no EXIF |
| Panorâmicas | Cortadas em 4 vistas planas (FOV 90°) |
| Desfoque | Rostos: YuNet. Matrículas: YOLOv11s de matrículas. Pessoas: YOLO11n, como rede de segurança |
| Deteção | YOLO-World v2 (small), com prompts e limiares por classe em `m3.prompts` |
| Tipo de sinal | Cascata p6: forma e cor (OpenCV) → algarismos dos limites → CLIP → sonda linear sobre o CLIP (re-treinável). O GTSRB foi abandonado (não tem 40 km/h nem a passadeira portuguesa) |
| Voto por elemento | Uma vista STOP/cedência/limite certa ganha ao "outro sinal"; com uma só vista certa, vai para a fila |
| Posição | Triangulação entre imagens. Para vistas únicas: lancil da via (carro), paralela ao trajeto (a pé) ou tamanho na imagem. Nunca dentro de um edifício do OSM |
| Fusão | Raios por família de sinal; vistas únicas a ≤ 8 m; sinais específicos iguais a ≤ 4 m. Calibração do vídeo fixa contra o Mapillary |
| Entrada automática | Por tipo e por zona (`config/limiares.json`): sinais e candeeiros com P(real) ≥ 0,9 e ≥ 2 vistas boas; contentores sempre na fila |
| Dados | Ficheiros (JSON, JSONL, GeoJSON, CSV), sem base de dados. As decisões ficam num registo que só se acrescenta (`catalogo/registo_validacoes.jsonl`) |
| Exportação | GeoJSON em WGS84; CSV com lat/lon + x/y no sistema local (`crs_local`, por omissão EPSG:3763 / PT-TM06) |

### Campos da exportação

| Campo | Exemplo |
|---|---|
| id | `sin_0002` |
| tipo | sinal / candeeiro / contentor |
| subtipo | stop, cedencia_passagem, limite_40, outro_sinal |
| lat, lon | 40.6387, -8.6572 |
| x, y, epsg_local | coordenadas no sistema local, 3763 |
| confianca | 0.87 |
| n_vistas | 7 |
| estado | auto / pendente / validado / corrigido / rejeitado |
| primeira_vista, ultima_vista | datas das imagens |
| imagem | caminho do recorte |
| fonte, atribuicao | mapillary+video_proprio, © autor / Mapillary, CC BY-SA 4.0 |

---

## Instalação

Precisa de Python 3.10+, Node.js 20.19+ e git. Não precisa de GPU (testado num portátil com 12 threads e 15 GB de RAM).

```bash
python -m venv .venv
.venv/bin/pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu   # PyTorch só CPU, primeiro
.venv/bin/pip install -r requirements.txt   # inclui o CLIP (do GitHub) e o pillow-heif (fotos HEIC)
cp .env.example .env        # preencher MAPILLARY_TOKEN

cd frontend && npm install
```

Os modelos (YOLO-World, rostos, matrículas e CLIP, ~390 MB) descarregam-se sozinhos para `models/` e `weights/clip/` na primeira execução. A sonda do re-treino (`config/m4/sonda.npz`, 12 KB) já vem no repositório.

## Como correr

**App web** (mapa, catálogo, fila, exportação e importação):

```bash
cd frontend && npm run dev        # http://localhost:5173
```

- Na primeira utilização, a página de login pede para criar a primeira conta de técnico.
- As contas seguintes criam-se com `node scripts/tecnico.ts adicionar <utilizador> "<Nome completo>"`.
- Mais detalhes em `frontend/README.md`.

**Pipeline** (também se pode correr pela app, na aba Importação):

```bash
.venv/bin/python pipeline/fetch_mapillary.py --zona santos-martires        # imagens Mapillary da zona
.venv/bin/python pipeline/ingest_video.py VIDEO.mp4 TRACK.gpx --nome sentido_norte --offset-s X
.venv/bin/python pipeline/ingest_fotos.py PASTA --nome N --rua R           # fotografias com GPS no EXIF
.venv/bin/python pipeline/run_all.py                                       # deteção → … → exportação
.venv/bin/python pipeline/run_all.py --desde fuse                          # retoma a partir de um passo
```

- **Vídeo:** filmem uns segundos o ecrã da app de GPS com a hora à vista; o offset é a diferença entre essa hora e a do vídeo. Gravem a rua nos dois sentidos, porque os sinais só têm a face virada para um lado. Na config: `video.fov_horizontal_deg` e `video.heading_offset_deg`.
- **Saída:** `data/clean/<municipio>/<zona>/`, com caminhos relativos.

**Nova zona ou outro município:**

```bash
.venv/bin/python pipeline/nova_zona.py --id gloria --nome "Glória" --vias vias.geojson
CTRLF_ZONA=gloria .venv/bin/python pipeline/fetch_mapillary.py && CTRLF_ZONA=gloria .venv/bin/python pipeline/run_all.py
```

**Medir e re-treinar:**

```bash
.venv/bin/python pipeline/evaluate.py                    # precisão (validações) e recall (contagem.json)
.venv/bin/python pipeline/m4_elementos.py                # tipo de sinal por elemento, contra os rótulos
.venv/bin/python pipeline/retreino.py --so-contar        # "X exemplos prontos"
.venv/bin/python pipeline/retreino.py --sinteticos       # re-treina a sonda, mede p5 × p6, grava config/m4/sonda.npz
.venv/bin/python pipeline/run_all.py --desde classify_signs   # aplica a sonda nova ao catálogo
```

**Testes:**

```bash
for t in tests/test_*.py; do .venv/bin/python "$t"; done
```

## Organização do repositório

| Pasta | O quê |
|---|---|
| `pipeline/` | Recolha, desfoque, deteção, classificação, posição, fusão, exportação, medição e re-treino |
| `frontend/` | App web (React + Vite) e a API dela (`frontend/server/`) |
| `config/` | `municipio.yaml`, zonas extra (`zonas/`), ruas e polígonos (`ruas/`), limiares, calibrações e a sonda dos sinais |
| `data/clean/` | Imagens desfocadas, deteções e catálogo por zona (as imagens da Av. Lourenço Peixinho partilham-se pelo Drive) |
| `reports/` | Medições e relatórios (sinais, contentores, duplicados, qualidade) |
| `tests/` | Testes do pipeline |
| `docs/` | Notas para o relatório, plano de ação e marca (logotipo) |

---

## Licenças e atribuição

- **Imagens Mapillary:** CC BY-SA. A autoria é guardada por imagem e mostrada na ficha de cada elemento.
- **Código:** aberto. Usa componentes AGPL-3.0 (Ultralytics e o modelo de matrículas), por isso o projeto é distribuído sob AGPL-3.0.
- **Mapas:** © contribuidores do OpenStreetMap; mosaicos do OpenFreeMap.
