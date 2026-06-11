# Case Canvas Workspace — implementation TODO / agent handoff

> **Para o próximo agente:** este arquivo é o estado vivo da implementação do
> [Case Canvas Workspace](../../FanvueSupport/Engineering/Feature%20-%20Case%20Canvas%20Workspace.md).
> Leia também `FanvueSupport/Engineering/Decisions/ADR-0009 Electron shell for embedded tool canvas.md`
> (por que Electron/WebContentsView e nunca iframe/proxy) e o `CLAUDE.md` da raiz (regras do projeto).
> Atualize este arquivo conforme avançar.

## Estado atual (2026-06-10) — Phase 0 ✅ VALIDADO · Phase 1 IMPLEMENTADO

**Phase 0 validado pelo Vinicius em 2026-06-10: Fadmin (Google @fanvue), ONDATO
(2FA celular) e MassPay logaram e funcionaram dentro das views.** URLs confirmadas:
`fadmin.fanvue.com`, `os.ondato.com`, `clients.masspay.io`.

**Phase 1 implementado (mesmo dia):**
- `/cases/[id]/canvas` — canvas por case (botão "Canvas" no header do case page);
  customer context live do Intercom; playbook top-match alimenta o draft card
- `/canvas` — canvas avulso (sem case), nav item na sidebar
- Node types: `tool` (view embedada/link), `case-info`, `draft` (envolve
  `draft-panel.tsx`), `notes` (scratchpad, persiste com o layout)
- Edges: automática case→tool (tracejada, "opened") + manuais (arrastar handle)
- Toolbox (canto sup. direito): adicionar tools/notes, reset layout
- Persistência: localStorage `fv-canvas-layout-v1:<conversationId|adhoc>`
  (geometria + edges + notas; dados do case SEMPRE re-hidratados do server)
- Registry de tools em `lib/canvas-tools.ts` com templates `{{email}}`/`{{handle}}`
  (resolução pronta; paths com placeholder ainda não definidos)
- Overlay guard: views nativas somem enquanto dialog/palette está aberto
  (`lib/canvas-overlay.ts`; palette marcada com `data-canvas-overlay`)

### O que existe e funciona

- **`web/desktop/`** — shell Electron fino (sem lógica de negócio):
  - `src/main.js` — BrowserWindow carrega o app da Vercel (`APP_URL` env override);
    uma `WebContentsView` por tool card; IPC `canvas:*`; partition `persist:tools`
    (sessões de login persistem entre restarts); **UA de Chrome puro** (obrigatório:
    Google bloqueia OAuth com UA de Electron — afeta o login do próprio app E o
    Google @fanvue do Fadmin); popups permitidos nas tool views compartilhando a
    partition (fluxos OAuth/2FA precisam disso); navegação de página principal
    fecha todas as views (evita view órfã sobre a UI).
  - `src/preload.js` — expõe `window.canvasHost` (contextIsolation on).
- **Web app** (mesmo deploy, progressive enhancement):
  - `app/canvas/page.tsx` — rota do spike (nav item "Canvas" na sidebar)
  - `components/canvas/case-canvas.tsx` — React Flow (@xyflow/react), 3 tool cards
    hardcoded: Fadmin, ONDATO, MassPay
  - `components/canvas/tool-node.tsx` — card com header (título da página, loading,
    reload/abrir-no-browser/minimizar/fechar), NodeResizer; **barra de URL ao vivo**
    (segue redirects/SSO; copiável; editável — Enter navega a view); loop rAF lê
    `getBoundingClientRect()` do corpo do card e sincroniza bounds + zoom
    (`setZoomFactor`) da view nativa; sem `canvasHost` (browser comum) vira link card
  - `lib/canvas-host.ts` — tipos + detecção do host
- ✅ `npm run typecheck`, eslint e `npm run build` passando (2026-06-10)
- ✅ Smoke test: shell abre, carrega o app, não crasha (Linux, Electron 38)

### Como rodar (dev)

```bash
cd web && npm run dev          # terminal 1 — app em localhost:3000
cd web/desktop && npm run dev  # terminal 2 — shell apontando pro localhost
# (npm start usa a URL de produção da Vercel)
```

## ✅ Phase 2 + 3 implementados (2026-06-10, mesma sessão)

- **Migration `0022_canvas_tools.sql` APLICADA no Supabase** (projeto
  `sarbmqumaadpozmpenyr`): `case_tools` + `case_tool_tags`, RLS select
  authenticated (padrão playbooks), escrita só via service role; seed das 3
  tools validadas com tags (kyc/payout/media)
- `lib/case-tools-db.ts` — fetch server-side com fallback hardcoded
  (`FALLBACK_TOOLS` em `lib/canvas-tools.ts`) se o DB falhar
- Canvas lê tools do DB (passadas por props dos server components)
- **Ghost cards**: sugestões por tag aparecem semi-transparentes/tracejadas —
  NADA carrega até o agente clicar "Open" (ou "Dismiss") ✅ feature doc §5
- **CRUD em Settings** (`components/case-tools-settings.tsx`): tabela + dialog
  (name, icon, url_template, group, tags, active) via `/api/case-tools` (GET/
  POST) e `/api/case-tools/[id]` (PATCH/DELETE), auth + service role
- **Command palette**: tools ativas viram itens "Open <tool>" (fetch no 1º
  open); num canvas adiciona o card (evento `canvas-add-tool`), fora abre nova aba
- **Tabs multi-canvas** (`components/canvas/canvas-tabs.tsx`): strip estilo
  Safari nos headers dos canvases; registro em localStorage
  (`fv-canvas-tabs-v1`, useSyncExternalStore, sincroniza entre janelas);
  "+" abre o scratch canvas
- **electron-builder configurado** em `desktop/package.json`: AppImage (linux),
  dmg universal (mac), NSIS (win); scripts `dist:linux|mac|win`.
  ⚠️ Build ainda NÃO testado em nenhuma plataforma.

## ✅ Rodada de feedback do Vinicius (2026-06-10, noite)

- **Múltiplos ad-hoc canvases** (browser-pages style): `/canvas` sem `?c=` gera
  id novo e redireciona; "+" na tab strip sempre cria canvas novo; cada um tem
  layout próprio (`adhoc:<id>`)
- **Emojis → ícones lucide** (`lib/tool-icons.tsx`, mapa name→ícone com
  fallback globe; `slack` mapeia pra HashIcon — lucide removeu brand icons).
  DB atualizado via SQL (icons = wrench/shield-check/banknote/landmark/inbox/
  slack/mail/file-text)
- **AI card** (`ai-node.tsx`): chat usando o mesmo `/api/ai/chat` do FAB
- **Queue card** (`queue-node.tsx`): fila live do `/api/cases` (poll 30s);
  clicar num case abre o canvas daquele case → dá pra trabalhar o turno
  inteiro sem sair do canvas
- **Conversation card** (`conversation-node.tsx`): thread do Intercom read-only
  no canvas do case (injetado também em layouts salvos antigos)
- **Botão "Open in canvas"** no header do case page
- **Toolkit expandido no DB** com grupos/dividers: Fanvue (Fadmin), KYC
  (ONDATO), Payments (MassPay, TripleA dashboard.triple-a.io), Workspace
  (Intercom, Slack, Gmail, Notion)
- **Personal links**: "Custom link…" no toolbox → POST em `case_tools` com
  group "Personal" — persiste no DB, aparece em todos os canvases e é editável
  em Settings
- UI toda em inglês (Fanvue é britânica)

## ✅ Rodada de feedback 2 (2026-06-10, madrugada)

- **"+" sem tela preta**: id gerado no cliente (sem redirect server) +
  `loading.tsx` nas duas rotas de canvas (fallback suave de Suspense)
- **Canvas avulso nasce VAZIO** (zero cards) — tudo vem do toolbox
- **Queue virou sidebar esquerda fixa** (`queue-sidebar.tsx`), colapsável em
  rail fino com badge de contagem; preferência em localStorage; clique no
  ticket → canvas do case. (O Queue *card* segue existindo só pra layouts
  antigos; saiu do toolbox.)
- **Case Info card**: todos os campos são **click-to-copy** (name, email,
  topic, tags, conversation id); **name/email editáveis** (lápis no hover →
  Enter salva) — overrides persistem com o layout e NÃO são sobrescritos pelo
  re-fetch do Intercom; tools novas resolvem `{{email}}` com o valor corrigido.
  Caso de uso: cliente abre com email secundário e manda o certo depois.
- **Notes**: botão X pra excluir
- **Personal links**: lixeira no hover (toolbox) → DELETE — sem edição, como pedido
- Canvas compartilhável: anotado como futuro (fora de escopo por ora)

## ✅ Rodada de feedback 3 (2026-06-11)

- **Case copilot** (`/api/ai/case-chat`): IA do canvas de case agora tem o
  ticket INTEIRO no contexto (thread truncada em 6k chars, customer, tags) +
  top-3 playbooks (recognize/checks/resolution/dos_donts). "Summarise the
  case" = ESTE case. Draft-only e never-invent-policy no system prompt;
  UK English. Mesmo provider (Verboo deepseek-v4-flash, sem stream).
  No canvas avulso o card cai no `/api/ai/chat` genérico.
- **AI card aberto por padrão** no canvas de case (abaixo da conversa)
- **Sugestões por keyword** além das tags (`TAG_KEYWORDS` em
  `lib/canvas-tools.ts`): "KYC"/"verification"/"identity"… → ONDATO;
  payout/withdraw/crypto → MassPay/TripleA. **Fadmin (grupo Fanvue) sempre
  aparece como ghost.** Texto do ticket vem da page (`ticketText` prop).
- **Pin de cards** (`lib/canvas-pins.ts` + `pin-button.tsx`): pin no header
  (tool, AI, notes, conversation, case info) congela o card naquela posição
  EM TODOS os canvases (registry global em localStorage, node ids estáveis);
  card pinado não arrasta; unpin libera.
- **Fios estilo Obsidian**: toggle global (ícone de grafo ao lado do badge)
  liga/desliga a visibilidade das edges; preferência persiste. Edges são
  bezier no layer SVG do React Flow — passam POR TRÁS dos cards (nativo).
- Conversation card: mensagens click-to-copy (rodada anterior do dia)

## ⏭️ Próximos passos (em ordem)

### 1. Validar no uso real (Vinicius)
- [ ] Case real → "Canvas": draft card gera/edita; ghost cards confirmam/dispensam
- [ ] Mapeamento tag→tool está certo? Ajustar em Settings → Canvas tools
- [ ] Definir os url_templates com `{{email}}` (paths reais do Fadmin etc.)
      em Settings — hoje só URLs base
- [ ] Layout/notas/tabs sobrevivem a sair e voltar
- [ ] Cmd+K com views abertas (overlay guard) e itens "Open <tool>"

### 2. Phase 4 — empacotamento e distribuição
- [ ] Rodar `npm run dist:linux` e testar o AppImage (atenção: Ubuntu 23.10+
      restringe user namespaces/AppArmor — pode precisar de profile ou
      `--no-sandbox`)
- [ ] macOS: Apple Developer ID + notarização (custo US$ 99/ano, obrigatório);
      Windows: NSIS sem cert = aviso SmartScreen (ok interno)
- [ ] Auto-update: electron-updater + GitHub Releases (definir repo/owner no
      bloco `build.publish` do desktop/package.json)

### 3. Polish restante
- [ ] Snapshot durante pan/zoom: hoje a view é live-synced via rAF (pode
      "rastejar" em pans rápidos). Se incomodar: `webContents.capturePage()` →
      `<img>` durante interação.
- [ ] Hardening do shell: validar `event.senderFrame` nos handlers IPC;
      `will-navigate` guard nas tool views (allowlist TEM que incluir domínios
      de auth: accounts.google.com etc., senão quebra login)
- [ ] Edges com label/cor editáveis; minimap click-to-jump já vem do React Flow

## Gotchas conhecidos (não re-descobrir)

1. **UA de Chrome é obrigatório** (`main.js`) — sem isso o Google recusa OAuth
   em qualquer view. Não remover ao mexer no shell.
2. **Popups das tool views devem ficar na partition `persist:tools`** — OAuth e
   2FA abrem janelas; se caírem no browser externo ou noutra session, o login
   não chega na view.
3. **Expiração de sessão é dos sites, não nossa**: Fadmin ~24h, ONDATO cache +
   2FA, MassPay 2FA. Re-login dentro do card é o fluxo esperado; não tentar
   "consertar" guardando tokens.
4. **Views nativas ficam ACIMA de toda a página** — qualquer UI que precise
   sobrepor (dialog, palette, dropdown grande) exige esconder as views antes.
5. **Iframe e proxy de headers estão proibidos** — não revisitar; ADR-0008/0009
   explicam (framing bloqueado, cookies third-party, segurança).
6. **Draft-only continua valendo** (CLAUDE.md): o canvas monta o workspace;
   quem opera as ferramentas e envia respostas é o humano.
