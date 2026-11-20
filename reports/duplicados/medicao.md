# Duplicados — medição contra as decisões dos técnicos

2026-11-19T16:31:10+00:00 · zona santos-martires · rótulos: **29 mesmo**, **1 diferente**, 40 implícitos (dois reais a ≤ 8 m que o técnico manteve) · 602 pares candidatos (mesma classe, ≤ 15 m)

## Regra atual (D7)

| | apanha mesmo | sugere diferente | falha mesmo | precisão | recall | sugere implícitos |
|---|---:|---:|---:|---:|---:|---:|
| junta_sozinho (certo) | 0 | 0 | 29 | None | 0.0 | 0 |
| sugere (certo ou possivel) | 17 | 0 | 12 | 1.0 | 0.586 | 1 |

## Características (mediana e p10–p90)

| | mesmo | diferente | implícito |
|---|---|---|---|
| dist_m | 3.37 (1.13–6.41), n=29 | 4.26 (4.26–4.26), n=1 | 4.83 (2.02–7.5), n=40 |
| raio_m | 1.19 (0.37–3.49), n=29 | 3.21 (3.21–3.21), n=1 | 1.75 (0.6–3.16), n=40 |
| anos | 0.0 (0.0–0.06), n=29 | 0.0 (0.0–0.0), n=1 | 0.0 (0.0–1.18), n=40 |
| partilham_foto | 0.83 | 1.0 | 0.95 |
| caixas_distintas | 0.34 | 1.0 | 0.95 |
| fontes_diferentes | 0.0 | 0.0 | 0.0 |
| mesmo_subtipo | 1.0 | 1.0 | 0.93 |

## Por classe

- sinal: {'implicito': 5, 'mesmo': 9}
- candeeiro: {'mesmo': 11, 'implicito': 29, 'diferente': 1}
- contentor: {'mesmo': 9, 'implicito': 6}
