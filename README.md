# WhatsSideBar

Extensão (Chrome/Edge/Brave, Manifest V3) que **recolhe a coluna de conversas do
WhatsApp Web**, deixando só foto + nome, para o chat ocupar o resto da tela.

Um botãozinho (setinha) fica na borda entre as duas colunas; o estado é
lembrado e vale para todas as abas abertas.

## Instalar

1. `chrome://extensions`
2. Ligue o **Modo do desenvolvedor** (canto superior direito)
3. **Carregar sem compactação** → selecione a pasta do repositório
4. Abra/recarregue `https://web.whatsapp.com/`

## Usar

- **Setinha na borda** entre a lista e o chat → recolhe/expande
- **Alt + Shift + C** → mesma coisa, pelo teclado
- **Ícone da extensão** → opções:
  - largura recolhida (120–520 px, padrão 210)
  - mostrar nome (desligado = só a foto, 76 px)
  - ocultar prévia da mensagem (padrão: ocultar)
  - ocultar horário (padrão: ocultar)

No modo "só foto" o selo de não lidas some junto com o bloco de texto; no modo
com nome ele continua aparecendo.

## Por que não quebra toda semana

As classes CSS do WhatsApp Web são ofuscadas e mudam constantemente, então o
código **não usa nenhuma delas**:

- **A coluna** é achada por estrutura: a partir de `#pane-side`, sobe até o
  ancestral que tem um irmão contendo `#main` (o painel da conversa). Note que
  essa coluna **não** é `#side` — no layout atual `#side` é só um pedaço dela,
  dentro de um wrapper com `flex: 0 0 40%`; encolher `#side` deixa um vão vazio.
  Como `#main` só existe com uma conversa aberta, no boot do app a regra não
  casa: aí vale um fallback (o primeiro ancestral cujo pai é bem mais largo que
  ele) e a detecção é **refeita** até a regra boa valer.
- **A linha da conversa** não tem `role` nem classe estável: é o ancestral do
  nome que é filho do container que se repete (≥ 3 filhos contendo
  `span[title]`).
- **As partes de cada linha** (nome, hora, prévia) são achadas por geometria:
  do `span[title]` do nome, sobe até o elemento cujo irmão seguinte começa
  *abaixo* dele — esse par é [linha do nome, linha da prévia]. O par precisa
  caber dentro da linha (≤ 80% da altura dela), senão casaria a linha inteira
  com a linha seguinte da lista.
- Os elementos encontrados recebem atributos próprios (`data-wsb-el="column"`,
  `"preview"`, `"meta"`, `"content"`…) e **só esses atributos** aparecem no
  `content.css`.
- Se o pai da coluna for um CSS grid, a largura de um filho não venceria a
  trilha do grid: nesse caso o `grid-template-columns` é reescrito e restaurado
  ao expandir.
- Um `MutationObserver` reaplica tudo quando o WhatsApp remonta o layout
  (login/QR, reconexão) e remarca as linhas conforme a lista virtualizada
  recicla os nós.

- **As divisórias entre painéis** vivem numa camada sobreposta
  (`data-testid="drawer-left"` / `-middle` / `-right`) posicionada pela largura
  original da coluna. Ela não acompanha o colapso e deixa um traço de 1px
  boiando no meio do chat; enquanto recolhido, os `<span>` vazios desse nível
  exato (`> div > span:empty`) são ocultados e as bordas desses trilhos ficam
  transparentes — conteúdo de drawer de verdade não é tocado. No lugar dela, a
  extensão desenha a própria divisória (`#wsb-line`) na borda nova, usando o
  token do design system do WhatsApp: `var(--WDS-lines-divider)`, herdado pela
  página. Se o token não estiver no alcance, o JS lê a cor da divisória
  original — descartando `currentColor` (uma borda sem cor própria resolve para
  a cor do *texto*, o que deixa a linha escura demais; e não dá para usar a
  largura da borda como filtro, porque com o span oculto o Chrome reporta 0).

Nada de altura de linha é alterado — a lista do WhatsApp é virtualizada com
alturas fixas, e mexer nisso bagunçaria o posicionamento.

## Arquivos

```
manifest.json
src/content.js    # detecção, marcação, botão, atalho, persistência
src/content.css   # só seletores data-wsb-*
src/popup.html/.css/.js
icons/
test/mock.html    # mock da estrutura do WhatsApp Web para testar sem login
```

### Testar sem WhatsApp

`test/mock.html` reproduz a estrutura (não as classes) da página real. Sirva a
pasta e abra o mock — o `content.js` roda nele com um stub de
`chrome.storage`:

```bash
python3 -m http.server 8765
```

(a partir da raiz do repositório)

Depois abra `http://localhost:8765/test/mock.html` (precisa ser via http://,
não file://). Parâmetros úteis:

- `?nomain=1500` — atrasa o `#main` em 1,5s, simulando o boot do app (foi o que
  fez a detecção cair no fallback errado)
- `?drawer=1` — monta conteúdo de verdade num drawer, para conferir que a regra
  das divisórias não engole conteúdo
- `?notoken=1` — sem o token `--WDS-lines-divider`, com cor própria na borda:
  exercita o plano B da cor da divisória
- `?currentcolor=1` — borda sem cor própria (resolve `currentColor`): tem que
  ser descartada, não copiada

## Firefox

Funciona com um ajuste: adicione ao `manifest.json`

```json
"browser_specific_settings": { "gecko": { "id": "whatssidebar@local" } }
```

e carregue por `about:debugging` → "Este Firefox" → "Carregar extensão
temporária".
