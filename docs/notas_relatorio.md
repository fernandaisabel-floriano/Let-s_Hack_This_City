# Ctrl+F Aveiro — notas técnicas para o relatório

Números medidos (não estimados) durante a construção do MVP, a 17/11/2026.
Zona piloto (v3): **bairro Santos Mártires, Aveiro** — Rua dos Santos Mártires +
rotunda + Cais dos Santos Mártires (junto à Fábrica Centro Ciência Viva).
Máquina de teste: portátil com CPU de 12 threads, 15 GB RAM, **sem GPU**.

---

## 1. Zona piloto e cobertura de imagens

### 1.1 Porque passámos de uma rua para um pequeno bairro (v3)

Começámos só com a Rua dos Santos Mártires (181 m). Ao filtrar as imagens que
são mesmo da rua (câmara a ≤ 10 m do eixo e a olhar ao longo dela) ficaram
**15 de 54**, quase todas de um único dia de 2019 e **sem nenhum contentor
visível** — não era possível medir uma das três classes. O enunciado permite
"uma rua ou um bairro", por isso a zona passou a ser a rua + a rotunda da ponta
sul + o Cais dos Santos Mártires (119 m, paralelo). Mantemos a v2 (só a rua)
nos ficheiros, para referência.

| | v2 (só a rua) | **v3 (bairro)** |
|---|---|---|
| Vias | Rua (181 m) | Rua (181 m) + rotunda (raio ~7,5 m) + Cais (119 m) |
| Zona de avaliação (eixos + 15 m, pontas cortadas) | 5 081 m² | **9 227 m²** |
| Imagens recolhidas (≤ 30 m das vias, desde 2019) | 54 | **68** |
| Imagens "da zona" (filtro abaixo) | 15 | **37** |
| Sequências de 2021 na zona | 0 | 2 (7 imagens) |

**Filtro "imagem da zona":** câmara a ≤ 10 m de uma das vias **e** heading
alinhado com o troço mais próximo (± 35°, qualquer sentido). Na rotunda o
alinhamento não funciona (anel de ~7,5 m de raio: as imagens úteis são das ruas
de acesso a olhar *para* ela), por isso também entra a câmara a ≤ 25 m do
centro da rotunda e a olhar para ele (± 45°).

Cobertura por via (37 imagens):

| Via | Imagens | Datas |
|---|---|---|
| Rua dos Santos Mártires | 13 | 9 ago 2019 |
| Cais dos Santos Mártires | 11 | 9 ago 2019 |
| Rotunda | 13 | 28 jul 2020 (6, noturnas), 17 mai 2021 (4), 28 ago 2021 (3) |

**Zona de avaliação:** eixos das três vias (OSM) + 15 m, unidos, com as pontas
cortadas onde as vias acabam. Na métrica (M10) e no catálogo final só contam
elementos cuja posição calculada (M5) cai dentro deste polígono; a recolha de
imagens é mais larga (30 m).

### 1.2 Contentores no OpenStreetMap

37 elementos a ≤ 300 m da zona (19 papeleiras, 10 de reciclagem, 8 contentores
de resíduos), **nenhum dentro** do polígono. Quatro ficam a ≤ 10 m da
fronteira, entre eles um **ecoponto** (latas, vidro, papel, plástico) a 10 m,
logo a seguir à ponta nordeste da Rua. Os dados do OSM servem para planear a
gravação, não como verdade: a contagem manual (M10) é que conta.

### 1.3 Números da primeira versão (só a rua)

| | |
|---|---|
| Imagens Mapillary na área (todas as datas) | 72 (todas planas, 6 sequências) |
| Imagens desde 2023 | **0** |
| Imagens a ≤ 30 m do eixo da rua, desde 2019 | **54** (5 sequências, 2 autores) |
| Datas das 54 imagens | ago 2019 → ago 2021 |

**Mensagem para o relatório:** a imagem pública mais recente da zona piloto tem
mais de 5 anos. Isto justifica a decisão de usar **vídeo próprio** (viatura
municipal / telemóvel) como fonte principal; o Mapillary fica como complemento
e para demonstrar a replicação noutros concelhos. No centro de Aveiro a
cobertura recente (2026) existe mas é só de panorâmicas 360°, que o pipeline
também suporta (cortadas em 4 vistas planas).

Qualidade: a sequência de julho de 2020 (15 imagens recolhidas, 6 na zona) é
de fim de tarde e tem muito arrastamento — bom exemplo para mostrar onde o
sistema falha.

## 2. Descarga (M1)

- API v4 do Mapillary, área dividida em quadrados de ~0,002° (~200 m).
- **Descoberta técnica:** a API não diz quando corta resultados. Com mais
  imagens do que o `limit`, devolve um número aleatório *abaixo* do limite
  (medido: 6–90 %), por vezes mesmo com o total abaixo do limite (569 imagens
  com `limit=600` devolveram 435). Solução: cada quadrado só é aceite se os 4
  sub-quadrados não trouxerem nenhuma imagem nova. Verificado: 525/525 imagens
  iguais à referência.
- Posição e direção: usamos as versões corrigidas pelo Mapillary
  (`computed_*`) com recurso às originais. Na rua piloto: **54/54 com posição e
  direção corrigidas**.
- Segunda execução: 0 imagens reprocessadas (2,7 s).
- Tempo total da rua piloto (54 imagens, com desfoque): **44 s**.
- Licença: imagens Mapillary **CC BY-SA 4.0**, com atribuição ao autor em cada
  registo exportado.

## 3. Privacidade — desfoque antes de gravar (M2)

**Garantia:** a imagem original só existe em memória; nada é escrito em disco
antes do desfoque. Não há pasta de imagens "em bruto".

Modelos (todos locais, sem APIs externas):

| O quê | Modelo | Licença |
|---|---|---|
| Rostos | YuNet (OpenCV Zoo) | MIT |
| Matrículas | YOLOv11s afinado para matrículas (morsetechlab) | AGPL-3.0 |
| Pessoas → zona da cabeça | YOLO11n COCO (Ultralytics) | AGPL-3.0 |

A deteção de pessoas é uma rede de segurança: quando o rosto não é visível
(de lado, de costas, longe), desfoca-se o quarto superior da pessoa.

**Resultados:**

| | Rua (v2, 54 imagens) | **Bairro (v3, 68 imagens)** |
|---|---|---|
| Rostos desfocados | 2 | **4** |
| Matrículas desfocadas | 4 | **8** |
| Cabeças de pessoas desfocadas | 50 | **56** |
| Imagens com pelo menos um desfoque | 24 de 54 (44 %) | **31 de 68** (46 %) |
| Tempo de desfoque | ~0,6 s por imagem (CPU) | |

**Problemas encontrados e corrigidos:**
- O modelo de matrículas marcava fachadas inteiras como matrículas (confiança
  até 0,74), o que tapava sinais e candeeiros. Filtro de forma (matrícula =
  pequena e mais larga do que alta). Efeito: na rua de 8 → 4 matrículas; numa
  panorâmica de teste de 13 → 4, sem perder matrículas reais.
- O detetor de rostos marcou uma parede tremida numa imagem noturna como um
  rosto enorme, e o desfoque tapou um quarto da imagem. Rostos com mais de 25 %
  da altura da imagem são agora ignorados; uma pessoa real próxima continua
  coberta pela rede de segurança das cabeças (detetor de pessoas).

**Limitações honestas:**
- Peões muito pequenos ao fundo (cabeça de ~5 px) podem não ser detetados.
- As imagens Mapillary já vêm com desfoque do próprio Mapillary; o nosso é uma
  segunda camada. No vídeo próprio, o nosso desfoque é a única proteção.

## 4. Panorâmicas 360°

Cada panorâmica é cortada em 4 vistas planas (90° de campo de visão, direção da
panorâmica + 0/90/180/270°), a partir da imagem em resolução original
(3840×1920 → vistas de 1024 px). Verificado visualmente que a direção de cada
vista coincide com a rua. A panorâmica inteira nunca é gravada.

## 5. Vídeo próprio (P1.1, agora parte do MVP)

- Entrada: vídeo + ficheiro GPX gravados em simultâneo.
- Extrai **1 imagem a cada 2 m percorridos** (não por tempo: parado não gera
  imagens; mais rápido não perde cobertura).
- Posição interpolada pela hora; direção calculada pelo movimento.
- Corrige o desfasamento entre o relógio do vídeo e o do GPS (`--offset-s`).
- Mesmo desfoque e mesmo formato que as imagens Mapillary.

Teste com vídeo de 20 s + trajeto GPS sintético ao longo da rua piloto (7 s
parado com ruído de GPS, depois 5 m/s, relógio do GPS 3 s adiantado):

| | |
|---|---|
| Imagens extraídas | 41 (40 em movimento + 1 parado — ruído do GPS ignorado) |
| Espaçamento entre imagens | **2,0 m** em média (1,84–2,16 m) |
| Erro de posição | ≤ 0,35 m |
| Erro de direção | ≤ 2,6° (nas curvas) |
| Sem correção do relógio | trajeto desviado 15 m — a correção é necessária |

(Números do vídeo real a acrescentar depois da gravação.)

## 6. Deteção (M3) — teste de prompts do YOLO-World

### 6.0 Teste na zona v3 (37 imagens do filtro "imagem da zona") — o que conta

Cada deteção verificada visualmente. 0,70 s por imagem e por prompt (CPU).
Objetos reais encontrados por algum prompt: **64 sinais, 99 candeeiros,
7 contentores**.

| Classe | Prompts | Limiar | Certos | Falsos |
|---|---|---|---|---|
| Sinal | traffic sign + stop sign + road sign | 0,05 | **64 / 64** | 14 |
| Sinal | (os mesmos) | 0,2 | 35 / 64 | 2 |
| Candeeiro | street lamp | 0,1 | **85 / 99** | 30 |
| Candeeiro | street lamp | 0,3 | 60 / 99 | 10 |
| Contentor | underground waste bin | 0,05 | 7 / 7 | 43 |
| Contentor | trash can | 0,1 | 3 / 7 | 5 |

**Prompts fixados:** sinais = "traffic sign" + "stop sign" + "road sign"
(≥ 0,05); candeeiros = "street lamp" (≥ 0,1). "lamp post" junto não acrescenta
nada; "street light" acrescenta poucos certos e quase o dobro dos falsos.

**Contentores continuam o ponto fraco.** Os prompts que na v2 davam 0 falsos
("dumpster", "colored recycling containers", "recycling bins") davam 0 falsos
porque quase não detetam nada: aqui acertam 0, 0 e 1 em 7. Nenhum prompt
consegue ao mesmo tempo apanhar os contentores e evitar os falsos (motas,
pessoas, carros, armários elétricos). Com só 7 contentores na amostra a
conclusão é frágil; o teste repete-se com os frames do vídeo, onde os
contentores são filmados de propósito. "wheelie bin" foi descartado (17 falsos
em 15 imagens na v2).

### 6.1 Teste só na rua (v2, 15 imagens do filtro "imagem da rua")

Cada deteção verificada visualmente. 0,85 s por imagem e por prompt (CPU).
Objetos reais encontrados por algum prompt: **9 sinais, 18 candeeiros, 0 contentores**.

| Classe | Prompts | Limiar | Certos | Falsos |
|---|---|---|---|---|
| Sinal | traffic sign + stop sign + road sign | 0,05 | 9 / 9 | 5 |
| Sinal | (os mesmos) | 0,3 | 4 / 9 | 0 |
| Candeeiro | street lamp | 0,1 | 16 / 18 | 7 |
| Candeeiro | street lamp | 0,3 | 10 / 18 | 2 |

Contentores — 10 prompts testados ("recycling container", "waste container",
"garbage bin", "underground waste bin", "wheelie bin", "trash can", "dumpster",
"recycling bins", "igloo recycling container", "colored recycling containers"):
sem contentores nas imagens, só se mede o ruído — **"wheelie bin" dá 17 falsos
positivos** com limiar 0,1 (armários elétricos, portas, carros, troncos);
"dumpster", "recycling bins", "colored recycling containers", "recycling
container" e "waste container" dão 0. Teste de deteção a repetir com o vídeo.

### 6.2 Primeiro teste (amostra larga, inclui rotunda e Cais)

Amostra de **20 imagens escolhidas à mão** (sinais, candeeiros, contentores,
2 noturnas tremidas). Cada deteção foi verificada visualmente.
Tempo: **0,75 s por imagem e por prompt** em CPU (1280 px).

Objetos reais encontrados por pelo menos um prompt: **42 sinais, 66 candeeiros,
6 contentores**. (A "cobertura" abaixo é relativa a estes; objetos que nenhum
prompt encontrou não estão contados.)

Por prompt, com limiar 0,1 — certos / falsos positivos:

| Classe | Prompt | Certos | Falsos |
|---|---|---|---|
| Sinal | traffic sign | 25 | 6 |
| Sinal | stop sign | 14 | 0 |
| Sinal | road sign | 16 | 4 |
| Candeeiro | street lamp | 53 | 24 |
| Candeeiro | lamp post | 39 | 8 |
| Candeeiro | street light | 56 | 38 |
| Contentor | recycling container | 1 | 0 |
| Contentor | waste container | 2 | 1 |
| Contentor | garbage bin | 2 | 5 |
| Contentor | underground waste bin | 3 | 14 |

Observações:
- "stop sign" funciona como detetor genérico de sinais (deteta passadeiras,
  cedências, rotundas), quase sem falsos positivos.
- Falsos positivos típicos: sinais → placas toponímicas e montras; candeeiros →
  postes de sinais, antenas, chaminés, reflexos de luz; contentores → armários
  elétricos, marcos de incêndio, motas.
- **Contentores são o ponto fraco**: só 6 na amostra (a rua quase não tem) e o
  YOLO-World encontra 2. É material para o pitch: mostra porque é preciso a
  fila de validação.
- Confianças do YOLO-World são baixas: com limiar 0,6 entram direto só 5 sinais
  (0 falsos) e 21 candeeiros (2 falsos). O resto vai para a fila do técnico.

*Conjunto final de prompts e limiares: pendente de confirmação da equipa.*

Ficheiros: `reports/yolo_world_test/` (imagens anotadas, `resultados.json`,
`combinacoes.json`, `labels.json` com os critérios de rotulagem).

## 7. Confiança do elemento e entrada direta no catálogo (M6 → M8)

A decisão "entra direto vs. vai para a fila" é tomada sobre o **elemento
fundido** (várias vistas), não sobre cada deteção.

Factos medidos:
- A confiança do YOLO-World separa só moderadamente reais de falsos
  (AUC ≈ 0,73 sinais, 0,75 candeeiros, numa só vista).
- A maior parte dos falsos positivos são **estruturas reais e persistentes**
  (postes de sinais, antenas, armários): aparecem em todas as vistas, como um
  objeto verdadeiro. Juntar vistas não os elimina.

Simulação com o limiar decidido (0,9). Distribuições de confiança reais de
238 objetos rotulados (93 sinais, 145 candeeiros, sem repetir imagens entre
testes); número de vistas e correlação entre frames assumidos:

| Fórmula | Fonte | Reais que entram direto (sinais / candeeiros) | Falsos que entram direto | Precisão do que entra direto |
|---|---|---|---|---|
| 1 − ∏(1 − cᵢ) ≥ 0,9 | Mapillary | 17 % / 47 % | 3,5 % / 10 % | 0,96 / 0,93 |
| 1 − ∏(1 − cᵢ) ≥ 0,9 | Vídeo | 57 % / 82 % | 15 % / 39 % | 0,95 / 0,86 |
| **P(real) calibrada ≥ 0,9** | Mapillary | 30 % / 35 % | 3,9 % / 3,8 % | **0,97 / 0,96** |
| **P(real) calibrada ≥ 0,9** | Vídeo | 46 % / 53 % | 6,9 % / 10 % | **0,97 / 0,94** |

O produto 1 − ∏(1 − cᵢ) assume vistas independentes; no vídeo (frames a 2 m,
quase iguais) satura para 1 e deixa entrar até 39 % dos falsos de candeeiros.
A confiança calibrada tem o mesmo significado em qualquer fonte.

**Decisão (M8):** `confianca_elemento` = P(real) calibrada por classe (Platt
sobre a média das 3 melhores vistas), mínimo de 2 vistas, **limiar 0,9** para
entrar direto; o resto vai para a fila do técnico. Implementado em
`pipeline/confianca.py`; calibração em `config/calibracao.json`.

Calibração inicial (rótulos dos testes):

| Classe | Rótulos | Entra direto se a média das 3 melhores vistas ≥ |
|---|---|---|
| Sinal | 76 reais / 17 falsos | 0,32 |
| Candeeiro | 106 reais / 39 falsos | 0,63 |
| Contentor | 4 reais / 7 falsos | — (poucos rótulos: tudo para a fila) |

**Melhora com o uso (P1.3):** cada validação do técnico (✓ real, ✗ falso,
tipo corrigido = falso para a classe original; posição corrigida = real) é
acrescentada aos rótulos e a calibração é reajustada
(`python pipeline/confianca.py recalibrar validacoes.json`). Uma classe só
passa a ter entrada direta quando tem pelo menos 10 rótulos reais e 10 falsos.

*Repetir a simulação com os dados reais da M6.*

## 8. Licenças a mencionar

- Imagens Mapillary: CC BY-SA 4.0 (atribuição ao autor em cada registo).
- Geometria da rua: OpenStreetMap, ODbL.
- Ultralytics (YOLO, YOLO-World) e modelo de matrículas: AGPL-3.0 — compatível
  com código aberto.
- YuNet: MIT.
- Sem APIs pagas; tudo corre num portátil sem GPU.

## 9. Replicação

Mudar de município = mudar `config/municipio.yaml` (município, rua/bbox,
datas). O relatório de cobertura (`pipeline/coverage_report.py`) diz em
segundos se uma rua tem imagens suficientes antes de descarregar.
