# Como marcar a referência (contagem manual)

O objetivo é ter **um ponto no mapa por cada sinal, candeeiro e contentor que existe
na zona**. O sistema vai ser comparado com estes pontos, por isso o que marcares é a
"verdade". Demora cerca de 30–45 minutos.

## O que está nesta pasta

| Ficheiro | O que é |
|---|---|
| `V001_…jpg` a `V014_…jpg` | Fotografias do nosso vídeo, uma a cada ~10 m ao longo da Rua dos Santos Mártires (17/11/2026) |
| `M001_…jpg` a `M024_…jpg` | Fotografias do Mapillary no Cais (`cais`) e na rotunda (`rotunda`), onde o vídeo não passou. São de 2019–2021 |
| `guia.geojson` | O mapa de apoio: a zona, o trajeto do vídeo e o sítio de cada fotografia |
| `ATRIBUICAO.txt` | Autores das fotografias Mapillary (licença CC BY-SA) |

O nome de cada fotografia diz onde foi tirada e para onde a câmara apontava, por
exemplo `V005_40.638312_-8.657822_h048.jpg` = fotografia V005, nessa posição, a
apontar para 48° (0° = norte, 90° = este).

As caras e as matrículas já estão desfocadas.

## Passo a passo

1. Abre **https://geojson.io** no browser.
2. Menu **Open → File** e escolhe `guia.geojson`. Aparecem:
   - a **zona** (área verde-clara) — só se marca o que está **dentro** dela;
   - o **trajeto do vídeo** (linha azul);
   - um ponto por fotografia (azul = vídeo `V…`, laranja = Mapillary `M…`) com uma
     **linha curta a mostrar para onde a câmara apontava**. Clica num ponto para ver
     o nome da fotografia.
3. Abre as fotografias (pela ordem dos números) ao lado do mapa. Para cada elemento
   que vês, descobre onde fica no mapa usando a posição da câmara e a linha da
   direção. Se o elemento aparece em duas fotografias, o sítio certo é onde as duas
   direções se cruzam.
4. Para marcar: escolhe a ferramenta de **ponto** (ícone do marcador, à direita do
   mapa) e clica no sítio do elemento.
5. Clica no ponto que criaste e, na tabela que aparece, acrescenta (botão
   **Add row**) estas propriedades, com os nomes escritos exatamente assim:

   | Propriedade | Valor |
   |---|---|
   | `tipo` | `sinal`, `candeeiro` ou `contentor` (obrigatório) |
   | `subtipo` | opcional, ver a lista abaixo |
   | `notas` | opcional; escreve `duvida` se não tiveres a certeza |

   Clica **Save** na tabela do ponto.
6. No fim: menu **Save → GeoJSON**. Envia o ficheiro (`map.geojson`) à Isa.
   Não faz mal o ficheiro trazer também o guia: o script separa-o sozinho.

## Regras

- **Um ponto por elemento real, não por fotografia.** O mesmo candeeiro visto em
  cinco fotografias é um só ponto.
- **Só dentro da zona** (área verde-clara). O que estiver fora não se marca.
- **Papeleiras não contam.** Os caixotes pequenos presos a postes ou ao chão, para
  deitar um papel, ficam de fora. Contam os **contentores** de lixo (os grandes, com
  rodas ou fixos) e os **ecopontos** / contentores de reciclagem.
- **Sinais:** cada placa de trânsito é um elemento (STOP, cedência, passadeira,
  limites de velocidade, proibições, direção…). Uma placa adicional por baixo de um
  sinal ("50 m", "Dias úteis") não é um elemento à parte. Vários sinais no mesmo
  poste: um ponto para cada sinal, todos no mesmo sítio.
- **Candeeiros:** cada poste de iluminação com luminária, e luminárias presas a
  fachadas. Postes só com sinais, semáforos ou postes elétricos sem luz não contam.
- **Em caso de dúvida**, marca na mesma e escreve `duvida` nas notas — é melhor do
  que esquecer.
- As fotografias do Cais e da rotunda são antigas (2019–2021). Se souberes que um
  elemento já não existe, não o marques; se não souberes, marca-o e escreve
  `visto só em 2019` (ou o ano) nas notas.
- A posição não precisa de ser perfeita: um erro de 2–3 m é aceitável.
- **Usa só estas fotografias.** O mapa de fundo do geojson.io serve só para te
  orientares. Não uses Google Maps, Street View nem a vista de satélite para decidir
  o que existe ou onde fica.

## Subtipos (opcional)

| tipo | subtipo |
|---|---|
| `sinal` | `stop`, `cedencia_passagem`, `limite_30`, `limite_40`, `limite_50`, `passadeira`, `sentido_proibido`, `proibicao`, `obrigacao`, `perigo`, `informacao`, `direcao`, `outro_sinal` |
| `contentor` | `ecoponto`, `indiferenciado`, `subterraneo`, `outro` |
| `candeeiro` | (deixa vazio) |
