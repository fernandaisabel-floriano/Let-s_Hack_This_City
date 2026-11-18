# Contentores — deteções da M3 contra os rótulos

2026-11-18T17:13:00+00:00 · 258 de 258 deteções rotuladas (0 sem rótulo) · **51 verdadeiros, 207 falsos**

Incertos fora da medição: **0** (0 com < 30 px, 0 com confiança < 0,1, 0 sem nenhum dos dois motivos).

**Precisão atual** (todas as deteções da M3, sem limiar extra): **0,20** (51 de 258).

| Fonte | n | verdadeiros | precisão |
|---|---:|---:|---:|
| mapillary | 127 | 25 | 0,20 |
| video_proprio | 131 | 26 | 0,20 |

| Prompt | n | verdadeiros |
|---|---:|---:|
| trash can | 2 | 0 |
| underground waste bin | 256 | 51 |

## Precisão por faixa de confiança

| Faixa | n | verdadeiros | precisão |
|---|---:|---:|---:|
| [0.05, 0.10) | 110 | 10 | 0,09 |
| [0.10, 0.20) | 55 | 9 | 0,16 |
| [0.20, 0.30) | 28 | 1 | 0,04 |
| [0.30, 0.50) | 20 | 7 | 0,35 |
| [0.50, 0.70) | 23 | 10 | 0,43 |
| [0.70, 1.00] | 22 | 14 | 0,64 |

## Acumulado (conf ≥ t)

| t | n | verdadeiros | precisão | recall |
|---:|---:|---:|---:|---:|
| 0.05 | 258 | 51 | 0,20 | 1,00 |
| 0.1 | 148 | 41 | 0,28 | 0,80 |
| 0.15 | 114 | 36 | 0,32 | 0,71 |
| 0.2 | 93 | 32 | 0,34 | 0,63 |
| 0.25 | 79 | 31 | 0,39 | 0,61 |
| 0.3 | 65 | 31 | 0,48 | 0,61 |
| 0.4 | 54 | 29 | 0,54 | 0,57 |
| 0.5 | 45 | 24 | 0,53 | 0,47 |
| 0.6 | 35 | 21 | 0,60 | 0,41 |
| 0.7 | 22 | 14 | 0,64 | 0,28 |
| 0.8 | 15 | 11 | 0,73 | 0,22 |
| 0.9 | 5 | 3 | 0,60 | 0,06 |

## Limiares sugeridos (por confirmar; a config não foi alterada)

- entra direto: conf ≥ **nenhum** (menor t com precisão ≥ 95% e ≥ 5 deteções)
- vai para a fila: conf ≥ **0.05** (maior t que guarda ≥ 95% dos verdadeiros); abaixo: descartar

## Falsos por tipo

| Tipo | n |
|---|---:|
| papeleira | 0 |
| armario | 11 |
| banco_floreira | 0 |
| veiculo | 11 |
| outro | 61 |
| (sem tipo) | 124 |

## Verdadeiros por tipo

| Tipo | n |
|---|---:|
| subterraneo | 0 |
| ilha_reciclagem | 6 |
| indiferenciado | 6 |
| (sem tipo) | 39 |

Exemplos (3 por tipo, maior confiança primeiro):

- falso_outro: `reports/contentores/exemplos/falso_outro`
- falso_sem_tipo: `reports/contentores/exemplos/falso_sem_tipo`
- falso_armario: `reports/contentores/exemplos/falso_armario`
- falso_veiculo: `reports/contentores/exemplos/falso_veiculo`
- verdadeiro_sem_tipo: `reports/contentores/exemplos/verdadeiro_sem_tipo`
- verdadeiro_ilha_reciclagem: `reports/contentores/exemplos/verdadeiro_ilha_reciclagem`
- verdadeiro_indiferenciado: `reports/contentores/exemplos/verdadeiro_indiferenciado`
