# M4 e contentores — resumo para o pitch

Zona piloto Santos Mártires, 18/11/2026. Números medidos contra rótulos feitos
à mão: 194 recortes de sinais (lado ≥ 30 px) e 258 deteções de contentores,
de imagens Mapillary e do vídeo próprio. Detalhe em `reports/m4/medicao.md`,
`reports/contentores/medicao.md` e `reports/contentores/filtro_clip.md`.

## Sinais: antes e depois

"Antes" = CLIP sem treino sobre o recorte largo. "Depois" = cascata final (p5):
recorte justo, família primeiro, forma e cor (OpenCV), algarismos dos limites,
prompt "stop sign". O que não tem certeza vai para a fila do técnico.

| | Antes | Depois |
|---|---:|---:|
| Sinais classificados como STOP, cedência ou limite com valor | 11 | 8 |
| **Errados** | **3** | **0** |
| **Precisão** | **0,73** | **1,00** |
| Para a fila do técnico | 0 | **52 de 194 (27 %)** |

Os 3 erros de antes: um limite de 40 lido como 70, um sinal de costas dado como
cedência e um sinal de outro tipo dado como limite de 20.

A mensagem: **o sistema deixou de errar**. Prefere dizer "não sei" e passar o
sinal ao técnico a gravar um sinal errado no inventário.

## Onde falha e porquê

### Sinais

| # | O que acontece | n | Porquê | Exemplos |
|---|---|---:|---|---|
| 1 | Sinal de outro tipo vai para a fila | 29 | O CLIP fica indeciso entre famílias (sinais pequenos ou tremidos) | `reports/m4/exemplos/01_outro_frente__outro_sinal_fila/` |
| 2 | Sinal de costas vai para a fila | 9 | As costas de um sinal são uma chapa cinzenta, sem nada que as distinga | `reports/m4/exemplos/02_costas__outro_sinal_fila/` |
| 3 | Algo que não é sinal é dado como "de costas" | 5 | Postes e chapas lisas parecem costas de sinais | `reports/m4/exemplos/03_nao_sinal__costas/` |
| 4 | Limite de 40 vai para a fila | 3 | Os dois limites de 40 da zona estão vistos de lado; os algarismos não se leem com segurança | `reports/m4/exemplos/04_limite_40__outro_sinal_fila/` |
| 5 | STOP vai para a fila | 3 | STOP noturno ou tapado: o filtro de forma não vê o octógono e veta | `reports/m4/exemplos/05_stop__outro_sinal_fila/` |
| — | Cedência dada como "outro sinal", sem passar pela fila | 3 | Bordo vermelho escuro ou desbotado (dia encoberto) e recorte que apanha também as placas de direção: o filtro de forma não vê o triângulo e o CLIP está confiante noutra família. Uma regra (cedência em 2.º lugar no CLIP → fila) recuperou 1 de 4; nenhuma regra de forma resolveu as outras | — |

Nenhum destes casos é um sinal específico errado: são sinais que ficam por
classificar. Só as 3 cedências da última linha entram no inventário como
"outro sinal" sem passar pela fila.

**Um problema a montante (M3, deteção): 20 % das deteções de "sinal" nem são
sinais.** São 39 de 194 recortes rotulados, incluindo passadeiras pintadas no
chão, fachadas e postes. A M4 não as pode rejeitar, porque só decide que tipo de
sinal é. Melhorar isto é trabalho da M3: um prompt negativo para marcas no
pavimento ou um filtro de posição na imagem.

### Contentores

- **Só 1 em cada 5 deteções é um contentor:** 51 verdadeiras em 258
  (precisão 0,20). O detetor (YOLO-World, "underground waste bin") marca tudo o
  que é escuro, vertical e está no passeio.
- **O filtro CLIP limpa a fila sem perder contentores.** A segunda opinião do
  CLIP ("contentor ou outra coisa?") com limiar 0,05 tira 80 falsos e só 3 dos
  51 verdadeiros. A fila passa de 258 para 175 e a precisão de 0,20 para 0,27.
  O limiar foi escolhido com validação cruzada (200 repetições: metade dos
  rótulos para escolher o limiar, a outra metade para medir), e aí o recall
  fica em 0,93 e a precisão em 0,28. A capacidade do filtro de separar
  contentores de falsos (AUC) está entre 0,81 e 0,86, conforme as frases usadas.
  O filtro está ligado com este limiar. Nenhum contentor entra direto no
  catálogo: todos passam pela fila.
- **O que o detetor confunde com contentores**, segundo o filtro CLIP:

  | Classe | Falsos |
  |---|---:|
  | Papeleira presa a poste | 73 |
  | Outro (parede, porta, tronco, pessoa, banco, montra) | 54 |
  | Armário técnico | 36 |
  | Pilarete | 23 |
  | Mota/carro | 12 |
  | Marco de incêndio | 6 |
  | Floreira | 3 |

  A contagem é **aproximada**. Numa amostra vista à mão, cerca de metade do que
  o CLIP chama "papeleira" é mesmo papeleira; o resto são marcos, armários e
  parquímetros. Exemplos em `reports/contentores/exemplos_filtro_clip/falso_*/`.
- **Os contentores que o filtro perde:** contentores de rua escuros, com rodas,
  vistos atrás de um poste, que o CLIP toma por papeleiras, e um iglô laranja
  tomado por marco de incêndio. Recortes em
  `reports/contentores/exemplos_filtro_clip/verdadeiros_deitados_fora/`.
- **O tipo de contentor ainda não é fiável:** acerta 6 dos 12 verdadeiros com
  tipo marcado. As "ilhas" da zona são contentores escuros filmados com pouca
  luz, onde a cor não ajuda.

## Limites desta medição

- Na zona há poucos sinais específicos: 6 STOP, 10 cedências e 4 limites, todos
  de 40. Não há nenhum de 30, 50 ou 120 km/h nesta execução.
- O recall dos sinais específicos é de 0,50 para STOP e para cedência. A outra
  metade fica na fila.
- Filtro dos contentores: AUC entre 0,81 e 0,86. O valor de 0,86 é o da
  versão final, com 4 frases acrescentadas depois de ver os erros da primeira
  versão, e pode estar inflacionado por isso. O limiar de 0,05 foi escolhido
  com validação cruzada, que protege essa escolha mas não a das frases.
