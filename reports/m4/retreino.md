# M4 — re-treino (sonda linear sobre o CLIP)

2026-11-20T13:13:27+00:00 · **267 exemplos prontos** · λ = 1e-05 · com sintéticos

| Classe | Exemplos | P (fora do treino) | R (fora do treino) |
|---|---|---:|---:|
| stop | 30 (rótulos 6, sintéticos 24) | 0,80 | 0,67 |
| cedencia_passagem | 34 (rótulos 10, sintéticos 24) | 0,57 | 0,40 |
| limite | 28 (rótulos 4, sintéticos 24) | 1,00 | 0,75 |
| outro_sinal | 115 (rótulos 114, validações 1) | 0,92 | 0,96 |
| costas | 21 (rótulos 21) | 0,83 | 0,91 |
| nao_sinal | 39 (rótulos 39) | 0,79 | 0,77 |

## p5 × p6 (sonda fora do treino)

Por recorte (rótulos) e por elemento (voto refeito). Escolha: 0 falsos específicos sem fila por elemento, mais elementos certos.

| | recortes: específicos certos | errados | STOP R | cedência R | limite R | elementos: certo (auto) | certo (fila) | fila sem tipo | perdido | falsos sem fila |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| p5 | 8 | 0 | 0,50 | 0,50 | 0,25 | 1 | 2 | 2 | 0 | 0 |
| p6 específica ≥ 0.5 | 11 | 3 | 0,83 | 0,60 | 0,75 | 2 | 3 | 0 | 0 | 1 |
| p6 específica ≥ 0.6 | 11 | 2 | 0,83 | 0,60 | 0,75 | 2 | 3 | 0 | 0 | 1 |
| p6 específica ≥ 0.7 | 10 | 1 | 0,83 | 0,50 | 0,75 | 2 | 2 | 1 | 0 | 0 |
| p6 específica ≥ 0.8 | 10 | 0 | 0,83 | 0,50 | 0,75 | 2 | 2 | 1 | 0 | 0 |
| p6 específica ≥ 0.9 ← escolhido | 9 | 0 | 0,67 | 0,50 | 0,75 | 2 | 2 | 1 | 0 | 0 |

## "Não é sinal" (vistas rotuladas, fora do treino)

39 recortes que não são sinais; 134 sinais reais de frente.

| P(não é sinal) ≥ | não-sinais apanhados | sinais reais marcados por engano |
|---:|---:|---:|
| 0.4 | 33 | 6 ← escolhido |
| 0.5 | 28 | 5 |
| 0.6 | 27 | 5 |
| 0.7 | 25 | 5 |
| 0.8 | 20 | 4 |
| 0.9 | 16 | 4 |
| 1.01 | 0 | 0 |

**p6 ganha à p5: sim.** Sonda gravada em `config/m4/sonda.npz`.
