# M4 — medição contra os rótulos manuais

2026-11-18T18:06:25+00:00 · 194 recortes rotulados (lado ≥ 30 px)

P = precisão, R = recall. Abstenções (fila) não contam como erro de precisão.

| Classe | n | atual P | atual R | p1 P | p1 R | p3 P | p3 R | p4 P | p4 R | p5 P | p5 R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| stop | 6 | 1,00 | 0,83 | 1,00 | 0,67 | 1,00 | 0,50 | 1,00 | 0,50 | 1,00 | 0,50 |
| cedencia | 10 | 0,50 | 0,10 | 1,00 | 0,10 | 1,00 | 0,50 | 1,00 | 0,50 | 1,00 | 0,50 |
| limite (família) | 4 | 0,75 | 0,75 | 0,22 | 1,00 | 0,50 | 0,25 | 0,50 | 0,25 | 0,50 | 0,25 |
| limite_30 | 0 | — | — | — | — | — | — | — | — | — | — |
| limite_40 | 4 | 1,00 | 0,50 | — | 0,00 | — | 0,00 | — | 0,00 | — | 0,00 |
| limite_50 | 0 | — | — | — | — | — | — | — | — | — | — |
| costas | 21 | 0,43 | 0,91 | 0,70 | 0,76 | 0,70 | 0,76 | 0,70 | 0,76 | 0,62 | 0,48 |
| outro (de frente) | 114 | 0,73 | 0,89 | 0,68 | 0,89 | 0,69 | 0,97 | 0,69 | 0,97 | 0,67 | 0,98 |

| Variante | Previsões específicas | Erros | Precisão das específicas | Para a fila |
|---|---:|---:|---:|---:|
| atual | 11 | 3 | 0,73 | 0 de 194 |
| p1 | 5 | 0 | 1,00 | 24 de 194 |
| p3 | 8 | 0 | 1,00 | 26 de 194 |
| p4 | 8 | 0 | 1,00 | 26 de 194 |
| p5 | 8 | 0 | 1,00 | 52 de 194 |

Erros de atual: limite_40 → limite_70 ×1; costas → cedencia ×1; outro → limite_20 ×1

## Antes (atual) → depois (p5)

| | antes | depois |
|---|---:|---:|
| previsões específicas (stop, cedência, limite com valor) | 11 | 8 |
| erradas | 3 | 0 |
| precisão das específicas | 0,73 | 1,00 |
| para a fila do técnico | 0 | 52 |
| stop: precisão / recall | 1,00 / 0,83 | 1,00 / 0,50 |
| cedencia: precisão / recall | 0,50 / 0,10 | 1,00 / 0,50 |
| limite (família): precisão / recall | 0,75 / 0,75 | 0,50 / 0,25 |
| costas: precisão / recall | 0,43 / 0,91 | 0,62 / 0,48 |

## Matriz de confusão — p5

Linhas = rótulo manual; colunas = previsão; "(fila)" = abstenção.

| rótulo \ previsão | cedencia_passagem | costas | limite_desconhecido (fila) | outro_sinal | outro_sinal (fila) | stop |
|---|---:|---:|---:|---:|---:|---:|
| stop |  |  |  |  | 3 | 3 |
| cedencia | 5 |  |  | 3 | 2 |  |
| limite_40 |  |  | 1 |  | 3 |  |
| outro_frente |  | 1 | 1 | 83 | 29 |  |
| costas |  | 10 |  | 2 | 9 |  |
| nao_sinal |  | 5 |  | 30 | 4 |  |

## Erros mais frequentes — p5

| Rótulo | Previsão | n | Exemplos |
|---|---|---:|---|
| outro_frente | outro_sinal (fila) | 29 | `reports/m4/exemplos/01_outro_frente__outro_sinal_fila` |
| costas | outro_sinal (fila) | 9 | `reports/m4/exemplos/02_costas__outro_sinal_fila` |
| nao_sinal | costas | 5 | `reports/m4/exemplos/03_nao_sinal__costas` |
| limite_40 | outro_sinal (fila) | 3 | `reports/m4/exemplos/04_limite_40__outro_sinal_fila` |
| stop | outro_sinal (fila) | 3 | `reports/m4/exemplos/05_stop__outro_sinal_fila` |

## Varrimento do limiar de família (p5)

| Limiar | Específicas | Erros | Fila |
|---:|---:|---:|---:|
| 0.3 | 8 | 0 | 49 |
| 0.4 | 8 | 0 | 50 |
| 0.45 | 8 | 0 | 52 |
| 0.5 | 8 | 0 | 60 |
| 0.6 | 8 | 0 | 83 |
| 0.7 | 8 | 0 | 108 |
| 0.8 | 8 | 0 | 133 |
| 0.9 | 8 | 0 | 154 |

## Opções para "de costas" (p5)

| Opção | costas P | costas R | costas previstos | específicas erradas | fila |
|---|---:|---:|---:|---:|---:|
| atual (costas 0.45) | 0,62 | 0,48 | 16 | 0 | 52 de 194 |
| limiar costas 0,8 | 1,00 | 0,10 | 2 | 0 | 66 de 194 |
