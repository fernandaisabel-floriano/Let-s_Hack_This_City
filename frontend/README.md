# Ctrl+F Aveiro — front-end

Plataforma pública do inventário de mobiliário urbano, com uma área reservada aos técnicos da Câmara.

| Vista | Quem vê | O quê |
|---|---|---|
| **Mapa** (M7) | todos | Elementos com ícones por tipo, filtros escondidos num botão (P2.4) e ficha de cada elemento |
| **Painel** | todos | O inventário em números. Os técnicos veem também a avaliação M10, a calibração e os tempos |
| **Exportar** (M9) | todos | Dados abertos em GeoJSON e CSV. Os técnicos exportam também as validações |
| **Validação** (M8) | técnicos | Recortes um a um, abaixo de um limiar ajustável (por omissão `m8.limiar_auto`), cronometrada (M11) |
| **Registo** | técnicos | Quem validou o quê, e quando |

O público vê, por omissão, só os elementos confirmados (`auto`, `validado` e `corrigido`), e pode pedir para ver também os que estão por confirmar. Ao abrir uma vista de técnico sem sessão, aparece o login.

React + TypeScript + Vite, componentes [shadcn/ui](https://ui.shadcn.com) (Radix, Tailwind v4) e Leaflet. O mapa base é o OpenStreetMap, com um filtro CSS para ficar sóbrio.

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

## Técnicos

Qualquer pessoa consulta o mapa, o painel e os dados abertos. Validar, corrigir e ver o registo exige login, e cada decisão fica com o nome de quem a tomou.

- Na primeira utilização, o botão "Área do técnico" pede para criar a primeira conta.
- Contas seguintes: `node scripts/tecnico.ts adicionar <utilizador> "<Nome completo>"` (pede a password). Para listar: `node scripts/tecnico.ts listar`.
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
| `/api/estado` | estado atual de cada elemento, sem nomes de técnicos | público |
| `GET/POST /api/decisoes` | registo de validações | técnicos |
| `/api/sessao`, `/api/login`, `/api/logout`, `/api/tecnicos` | autenticação | — |

- Se existir `catalogo/elementos.json` (saída de `pipeline/fuse.py`), a app usa esses dados.
- Campos lidos do `fuse.py`: `metodo_posicao`, `residuo_raios_m`, `ajustado_edificio`, `subtipo_incerto` e `subtipo_motivo`. Os subtipos de sinal são os do `classify_signs.py` (`stop`, `cedencia_passagem`, `limite_NN`, `limite_desconhecido`, `outro_sinal`, `costas`).
- Os técnicos podem carregar um `elementos.json` ou um `catalogo.geojson` à mão, no menu do utilizador, em "Fonte dos dados".
- Se não houver dados, a app mostra **dados de demonstração** gerados ao longo das vias, e indica-o no topo.

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
