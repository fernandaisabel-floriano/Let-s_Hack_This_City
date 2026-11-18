# Contentores — filtro CLIP

2026-11-18T18:03:14+00:00 · 258 deteções rotuladas (51 verdadeiras) · 71.7 s

Frases e recorte usados: **v2 justo** (AUC 0.862; os outros: v2 largo 0.811, v1 justo 0.813). A v2 acrescenta 4 frases positivas escolhidas depois de ver os erros da v1 — a diferença v1→v2 pode estar inflacionada (sobreajuste às frases); a validação cruzada só protege a escolha do limiar.

## Sem filtro vs. com filtro (limiar recomendado, todos os dados)

| | sem filtro | com filtro |
|---|---:|---:|
| limiar p_contentor | — | 0.05 |
| fila (deteções) | 258 | 175 |
| precisão | 0,20 | 0,27 |
| recall | 1,00 | 0,94 |
| verdadeiros deitados fora | 0 | 3 |
| falsos tirados da fila | 0 | 80 |

Limiar recomendado = maior limiar que guarda ≥ 90% dos verdadeiros.

## Validação cruzada (200 × metade para escolher o limiar, metade para medir)

| | média | p10 | p90 |
|---|---:|---:|---:|
| limiar escolhido | 0,05 | 0,03 | 0,05 |
| precisão com filtro | 0,28 | 0,26 | 0,30 |
| recall com filtro | 0,93 | 0,89 | 1,00 |
| fila com filtro (metade) | 86,50 | 82,00 | 93,10 |
| fila sem filtro (metade) | 130,00 | 130,00 | 130,00 |
| precisão sem filtro | 0,20 | 0,20 | 0,20 |
| verdadeiros deitados fora (metade) | 1,94 | 0,00 | 3,00 |
| limiar 'entra direto' (precisão ≥ 95 % na metade de escolha) | 0,79 | 0,50 | 0,90 |
| entram direto (metade de medida) | 9,63 | 5,00 | 17,00 |
| precisão de quem entra direto | 0,93 | 0,82 | 1,00 |

Em 7 das 200 partições não houve limiar 'entra direto' com precisão ≥ 95 %.

## Comparação de frases e recortes (todos os dados)

| versão | AUC | limiar (recall ≥ alvo) | fila | precisão | verdadeiros fora | CV precisão | CV recall |
|---|---:|---:|---:|---:|---:|---:|---:|
| v2 justo | 0.862 | 0.05 | 175 | 0,27 | 3 | 0,28 | 0,93 |
| v2 largo | 0.811 | 0.05 | 158 | 0,29 | 5 | 0,29 | 0,92 |
| v1 justo | 0.813 | 0.02 | 185 | 0,25 | 5 | 0,24 | 0,90 |

## Varrimento do limiar

| p_contentor ≥ | fila | verdadeiros | precisão | recall | verdadeiros fora |
|---:|---:|---:|---:|---:|---:|
| 0.0 | 258 | 51 | 0,20 | 1,00 | 0 |
| 0.005 | 246 | 51 | 0,21 | 1,00 | 0 |
| 0.01 | 234 | 51 | 0,22 | 1,00 | 0 |
| 0.02 | 207 | 51 | 0,25 | 1,00 | 0 |
| 0.03 | 188 | 49 | 0,26 | 0,96 | 2 |
| 0.04 | 185 | 48 | 0,26 | 0,94 | 3 |
| 0.05 | 175 | 48 | 0,27 | 0,94 | 3 |
| 0.1 | 113 | 41 | 0,36 | 0,80 | 10 |
| 0.15 | 91 | 38 | 0,42 | 0,74 | 13 |
| 0.2 | 70 | 38 | 0,54 | 0,74 | 13 |
| 0.25 | 50 | 35 | 0,70 | 0,69 | 16 |
| 0.3 | 46 | 34 | 0,74 | 0,67 | 17 |
| 0.35 | 44 | 34 | 0,77 | 0,67 | 17 |
| 0.4 | 38 | 31 | 0,82 | 0,61 | 20 |
| 0.45 | 36 | 31 | 0,86 | 0,61 | 20 |
| 0.5 | 31 | 28 | 0,90 | 0,55 | 23 |
| 0.55 | 30 | 27 | 0,90 | 0,53 | 24 |
| 0.6 | 27 | 24 | 0,89 | 0,47 | 27 |
| 0.65 | 26 | 23 | 0,89 | 0,45 | 28 |
| 0.7 | 22 | 20 | 0,91 | 0,39 | 31 |
| 0.75 | 21 | 20 | 0,95 | 0,39 | 31 |
| 0.8 | 21 | 20 | 0,95 | 0,39 | 31 |
| 0.85 | 17 | 16 | 0,94 | 0,31 | 35 |
| 0.9 | 14 | 14 | 1,00 | 0,28 | 37 |
| 0.95 | 9 | 9 | 1,00 | 0,18 | 42 |

## Falsos por classe negativa (saída do filtro — contagem para o pitch)

| Classe | n |
|---|---:|
| papeleira | 73 |
| outro | 54 |
| armario | 36 |
| pilarete | 23 |
| veiculo | 12 |
| marco_incendio | 6 |
| floreira | 3 |

Exemplos (3 por classe, maior probabilidade primeiro):

- pilarete: `reports/contentores/exemplos_filtro_clip/falso_pilarete`
- floreira: `reports/contentores/exemplos_filtro_clip/falso_floreira`
- armario: `reports/contentores/exemplos_filtro_clip/falso_armario`
- papeleira: `reports/contentores/exemplos_filtro_clip/falso_papeleira`
- outro: `reports/contentores/exemplos_filtro_clip/falso_outro`
- veiculo: `reports/contentores/exemplos_filtro_clip/falso_veiculo`
- marco_incendio: `reports/contentores/exemplos_filtro_clip/falso_marco_incendio`

Cruzamento com os tipos que o técnico marcou (rótulo × classe do CLIP):

- (sem tipo) × outro: 40
- outro × papeleira: 31
- (sem tipo) × papeleira: 28
- (sem tipo) × armario: 22
- (sem tipo) × pilarete: 16
- outro × armario: 10
- outro × outro: 10
- armario × papeleira: 8
- (sem tipo) × veiculo: 6
- outro × pilarete: 6
- (sem tipo) × contentor: 5
- veiculo × veiculo: 5
- (sem tipo) × marco_incendio: 4
- (sem tipo) × floreira: 3
- veiculo × contentor: 3

## Verdadeiros deitados fora com o limiar 0.05: 3

Recortes em `reports/contentores/exemplos_filtro_clip/verdadeiros_deitados_fora`.

## Tipo de contentor (só verdadeiros)

**Vale pouco: só 12 verdadeiros têm tipo marcado.** Certos: 6 de 12.

- rótulo → previsto: {'ilha_reciclagem → indiferenciado': 4, 'indiferenciado → indiferenciado': 6, 'ilha_reciclagem → subterraneo': 2}
- previsto em todos os verdadeiros: {'indiferenciado': 41, 'subterraneo': 8, 'ilha_reciclagem': 2}
