# Qualidade das vistas — medição contra os recortes rotulados

196 reais e 194 falsos (sinais da M4 e contentores). Por métrica, o limiar que perde no máximo 5% dos reais:

| critério | limiar | perde reais | tira falsos | mediana reais | mediana falsos |
|---|---:|---:|---:|---:|---:|
| lado_min_px | 33.2 | 5% | 31% | 62.9 | 47.9 |
| nitidez_min | 102.0 | 5% | 9% | 1510.3 | 1320.8 |
| brilho_min | 24.4 | 5% | 3% | 80.4 | 68.7 |
| brilho_max | 159.0 | 5% | 4% | 80.4 | 68.7 |
| contraste_min | 20.9 | 5% | 6% | 44.8 | 37.0 |

**Proposta** (critérios que tiram pelo menos o dobro do que perdem): `{'lado_min_px': 33.2}` → perde 5% dos reais, põe de lado 31% dos falsos.

**Atenção:** os rótulos de sinais só incluem recortes com lado ≥ 30 px (m4.rotular_lado_min_px), por isso o critério do tamanho só se mede bem nos contentores.

**Config atual** `{'lado_min_px': {'sinal': 30, 'candeeiro': 30, 'contentor': 42}, 'nitidez_min': 50, 'brilho_min': 15, 'brilho_max': 245, 'contraste_min': 0}` → perde 1% dos reais, põe de lado 50% dos falsos. Vistas fracas por classe: {'sinal': '54 de 244', 'candeeiro': '61 de 489', 'contentor': '122 de 258'}
