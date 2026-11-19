# Aveiro Smart City — plataforma de gestão do mobiliário urbano

Front-end e API da plataforma da Câmara Municipal de Aveiro (projeto Ctrl+F Aveiro). A IA deteta, classifica e localiza o mobiliário urbano; os técnicos supervisionam, corrigem e validam.

| Página | Quem vê | O quê |
|---|---|---|
| **Dashboard** | todos | Totais por categoria, pendentes, aprovadas, distribuição por categoria e estado, atividade recente (técnicos) ou fontes das imagens (público); por baixo, os indicadores técnicos (M10, calibração, duplicados) |
| **Mapa** (M7) | todos | Marcadores por categoria ou por estado, clusters, filtros (categoria, estado, rua, posição a rever, confiança), pesquisa por rua ou tipo, ficha de cada elemento |
| **Catálogo** | todos (edição: técnicos) | Tabela de todos os elementos sem duplicados: pesquisa, filtros por categoria, tipo, estado e rua, ordenação, ficha lateral, exportação do que está filtrado |
| **Exportação** (M9) | todos | Catálogo em GeoJSON e CSV; os técnicos exportam também as validações |
| **Deteções e validação** (M8) | técnicos | Fila um a um (atalhos, cronometrada, M11) e grelha com todas as deteções: baixa confiança em destaque, aprovar/rejeitar num clique, editar classificação, corrigir coordenadas, ver a imagem original e o recorte |
| **Importação** | técnicos | Fotografias, vídeo + GPX e Mapillary, processados pelo pipeline Python real, com estado (a aguardar, em processamento, concluído, com erros) e progresso por passo |
| **Registo** | técnicos | Quem validou o quê, e quando |

O público vê, por omissão, só os elementos confirmados (`auto`, `validado` e `corrigido`). Ao abrir uma página de técnico sem sessão, a app vai para a página de login e volta à página pedida depois de entrar.

React + TypeScript + Vite, componentes [shadcn/ui](https://ui.shadcn.com) (Radix, Tailwind v4) e Leaflet.

O mapa base é uma cartografia própria em tons de cinzento, ao estilo das plataformas de SIG municipais, feita só com componentes abertos (OpenStreetMap + Leaflet). A geografia é real: mosaicos vetoriais do [OpenFreeMap](https://openfreemap.org), com dados OpenStreetMap, gratuitos e sem chave, desenhados com o MapLibre. O estilo é redefinido em `src/lib/estilo-mapa.ts`: fundo quase branco, edifícios e quarteirões em cinzento suave, ruas finas com a hierarquia das vias, água e verdes também em cinzento e toponímia pequena. Não há pontos de interesse, relevo nem 3D, para só os marcadores do inventário terem cor. Tem versão escura. Sem WebGL, ou se o servidor de mapas não responder em 10 s, a app usa os mosaicos do OpenStreetMap em tons de cinzento.

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

## No mapa

- **Marcadores:** ícone do tipo. O ponto de cor indica a confiança: verde ≥ `m8.limiar_auto`, amarelo ≥ 50 %, vermelho abaixo, cinzento sem calibração. O contorno tracejado quer dizer "por confirmar". O badge "+N" indica que N duplicados foram juntados nesse elemento, e a tooltip explica-o. A legenda está no painel de filtros.
- **Transferir** (ícone ao lado dos filtros): GeoJSON ou CSV do que está no mapa ou do catálogo completo, sem mudar de vista.
- **Agrupar elementos próximos** (modo lite): ligado por omissão no telemóvel; pode mudar-se nos filtros. Usa o `react-leaflet-cluster`.
- **Visita guiada:** abre sozinha na primeira visita (uma para o público e outra para técnicos) e repete-se no botão "?".
- **Acessibilidade:** os marcadores são focáveis com Tab, abrem com Enter ou Espaço e têm uma descrição para leitores de ecrã (tipo, estado, confiança, duplicados). Os botões só com ícone têm `aria-label`.

## Técnicos

Qualquer pessoa consulta o mapa, o painel e os dados abertos. Validar, corrigir e ver o registo exige login, e cada decisão fica com o nome de quem a tomou.

- Entra-se com o **nome de utilizador** e a palavra-passe.
- Na primeira utilização, a página de login pede para criar a primeira conta (nome completo, utilizador, palavra-passe).
- Contas seguintes: `node scripts/tecnico.ts adicionar <utilizador> "<Nome completo>" [email]` (pede a palavra-passe). Para listar: `node scripts/tecnico.ts listar`.
- As contas ficam em `data/tecnicos.json`, com a password em scrypt e sal. **Este ficheiro não deve ir para o git.**
- As sessões vivem na memória do servidor: reiniciar o `npm run dev` obriga a entrar de novo.

O registo de auditoria é `catalogo/registo_validacoes.jsonl`. Só se acrescenta, e o técnico gravado é sempre o da sessão, nunca um valor enviado pelo browser. Com dados de demonstração ou com um ficheiro carregado à mão, o registo fica só no browser.

> É um protótipo: corre no servidor de desenvolvimento do Vite, sem HTTPS. Para produção, a API de `server/api.ts` deve passar para um servidor próprio, atrás de HTTPS e, idealmente, ligada às contas da Câmara (SSO).

## De onde vêm os dados

O servidor de desenvolvimento (`vite.config.ts` e `server/api.ts`) lê `config/municipio.yaml` e serve:

| URL | Origem | Acesso |
|---|---|---|
| `/api/config` | campos de `config/municipio.yaml` (município, zona, bbox, limiares, `crs_local`) | público |
| `/config/...` | `config/`: vias, polígono da zona, `calibracao.json` | público |
| `/zona/...` | `<saida>/<municipio>/<zona>/`: `catalogo/elementos.json`, recortes e imagens | público |
| `/zona/...` | o resto: `deteccoes/deteccoes.json`, `referencia.csv`, `catalogo/metrica*.json` | técnicos |
| `/api/estado` | estado atual de cada elemento e pares decididos, sem nomes de técnicos | público |
| `/api/duplicados` | pares de elementos duplicados (só ids e distâncias) | público |
| `/api/sugestoes` | tipo de contentor sugerido pelo CLIP (`extra.clip_tipo` em `deteccoes.json`) | público |
| `GET/POST /api/decisoes` | registo de validações | técnicos |
| `/api/sessao`, `/api/login`, `/api/logout`, `/api/tecnicos` | autenticação | — |

- Se existir `catalogo/elementos.json` (saída de `pipeline/fuse.py`), a app usa esses dados.
- Campos lidos do `fuse.py`: `metodo_posicao`, `residuo_raios_m`, `ajustado_edificio`, `subtipo_incerto` e `subtipo_motivo`. Os subtipos de sinal são os do `classify_signs.py` (`stop`, `cedencia_passagem`, `limite_NN`, `limite_desconhecido`, `outro_sinal`, `costas`).
- Os técnicos podem carregar um `elementos.json` ou um `catalogo.geojson` à mão, no menu do utilizador, em "Fonte dos dados".
- Se não houver dados, a app mostra **dados de demonstração** gerados ao longo das vias, e indica-o no topo.

## Importação e processamento

A página de Importação chama os scripts do pipeline (`server/importacoes.ts`):

| Recolha | Comando |
|---|---|
| Fotografias | `python pipeline/ingest_fotos.py PASTA --nome N --rua R` (GPS e direção da câmara do EXIF; sem eles a foto fica de fora, listada para revisão) |
| Vídeo + GPX | `python pipeline/ingest_video.py VIDEO GPX --nome N --offset-s S` |
| Mapillary | `python pipeline/fetch_mapillary.py` (precisa de `MAPILLARY_TOKEN` no `.env`) |
| Depois | `python pipeline/run_all.py` (deteção → classificação → tipo de contentor → georreferenciação → fusão → catálogo) |

- **Motor:** o servidor procura o Python em `CTRLF_PYTHON`, depois em `.venv` e depois no `PATH`, e verifica os módulos do `requirements.txt`. Se faltar algum, o envio fica desativado e a página diz o que falta.
- **Demonstração:** sem motor, a página oferece uma simulação, marcada como demonstração, que não lê ficheiros nem altera o catálogo.
- **Privacidade:** os ficheiros enviados ficam numa pasta temporária do sistema, fora do repositório, e são apagados quando o processamento termina (com ou sem erro). O pipeline desfoca rostos e matrículas antes de gravar qualquer imagem.
- **Ordem:** um processamento de cada vez; os outros ficam "a aguardar". O histórico (só metadados) fica em `<zona>/importacoes/importacoes.json`.
- **KartaView:** ainda não integrado; aparece como previsto.

## Georreferenciação e posição a rever

As coordenadas vêm do pipeline: posição e direção da câmara (GPS, EXIF ou Mapillary) mais a direção do objeto na imagem e a distância estimada, com triangulação quando há várias imagens. Não são inventadas a partir da imagem. Um elemento fica com **posição a rever** (`src/lib/revisao.ts`) quando:

- foi visto numa só imagem e a posição não foi triangulada (só estimada); ou
- as direções das várias imagens não coincidem bem (resíduo dos raios > 1,5 m, o pior 5 % na zona piloto).

Estes elementos entram na fila de validação, mesmo que tenham sido aceites automaticamente, e podem ser filtrados no mapa e no catálogo.

## Privacidade e licenças na interface

`/api/imagens` lê os `images.csv` do pipeline. Cada ficha e o visualizador da imagem original mostram:

- a fonte, o autor, a licença (CC BY-SA 4.0 no Mapillary) e a ligação de origem;
- quantos rostos, matrículas e pessoas foram desfocados nessa imagem.

O visualizador marca a caixa do objeto detetado (técnicos).

## Preparado para outro backend

Toda a comunicação com a API passa por `src/lib/api.ts` e `src/lib/data.ts`. Hoje a API é o servidor Node em `server/*.ts`, que lê os ficheiros do pipeline. Para passar a FastAPI + PostGIS, basta manter os caminhos e formatos:

`/api/config`, `/api/sessao`, `/api/login`, `/api/logout`, `/api/tecnicos`, `/api/estado`, `/api/decisoes`, `/api/duplicados`, `/api/sugestoes`, `/api/imagens`, `/api/motor`, `/api/importacoes` e `/zona/<ficheiro>`.

## Tipo de contentor

O enunciado pede o tipo de cada contentor: subterrâneo, ilha de reciclagem (ecoponto) ou indiferenciado. O `pipeline/contentores_clip.py` sugere-o, mas a equipa decidiu não o escrever no catálogo (`contentores_clip.escrever_tipo: false`, porque acerta 6 em 12). Por isso:

- a ficha mostra o tipo, quando já foi confirmado, ou "por identificar"; se houver anotação CLIP, mostra "provável: …" (por confirmar);
- o técnico confirma o tipo com um clique ("Confirmar como: Subterrâneo / Ecoponto / Indiferenciado"), e a decisão fica no registo como correção de subtipo;
- o Painel mostra os contentores por tipo, incluindo os por identificar.

Os contentores ainda não têm confiança calibrada. Nesses casos, a ficha mostra a confiança do detetor na melhor imagem (`confianca_max_vista`) e indica que não está calibrada.

## Duplicados

O mesmo objeto pode chegar ao catálogo como vários elementos. `server/duplicados.ts` compara os elementos da mesma classe dentro do raio de fusão (`m6.raio_fusao_m`) usando as caixas de `deteccoes.json`:

| Caso | O que acontece |
|---|---|
| Candeeiros e contentores com caixas sobrepostas (IoU ≥ 0,3) numa foto que partilham | **Fundidos automaticamente**: fica um só elemento, com uma só imagem. O técnico pode separar |
| Sinais com caixas sobrepostas | **Possível duplicado**: vários sinais no mesmo poste sobrepõem-se e são objetos diferentes |
| Sem nenhuma foto em comum, a ≤ 5 m, subtipos compatíveis (ex.: um só visto no Mapillary, outro só no vídeo) | **Possível duplicado** |
| Partilham uma foto com caixas distintas | Objetos diferentes |

Os possíveis duplicados entram na fila de validação, mostrados lado a lado, com "É o mesmo" / "São diferentes". O painel mostra também a semelhança visual dos dois recortes (histograma de cor, calculado no browser; só indicativa) e as datas em que cada um foi visto. As decisões ficam no registo (`acao: "par"`). O mapa, o painel e a exportação mostram um elemento por objeto. Medido a 18/11 na zona piloto: 36 pares, 21 elementos fundidos automaticamente e 11 por decidir.

## Validações

Com dados do pipeline, cada decisão (✓ / ✗ / mudar tipo ou subtipo / mover) é acrescentada ao registo, e `catalogo/validacoes.json` é regravado com a última decisão de cada elemento, incluindo `validado_por`. O formato é o de `confianca.py recalibrar`:

```bash
python pipeline/confianca.py recalibrar data/clean/aveiro/santos-martires/catalogo/validacoes.json
```

`confiancas_vistas` é calculado a partir de `deteccoes.json` (melhor confiança por imagem, como em `fuse.py`). Se esse ficheiro não existir, usa `confianca_max_vista`.

Atalhos na fila: `V` confirmar · `X` rejeitar · `1`/`2`/`3` sinal/candeeiro/contentor · `Z` desfazer.

## Adicionar componentes shadcn

```bash
npx shadcn@latest add <componente>
```
