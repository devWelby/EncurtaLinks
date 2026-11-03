# API do EncurtaLinks

Respostas JSON têm `Cache-Control: no-store`, exceto os textos legais (cache curto, abaixo).
Erros seguem o formato:

```json
{ "error": { "code": "rate_limited", "message": "Muitas tentativas. Tente novamente em 42 segundo(s).", "retryAfterSeconds": 42 } }
```

Códigos comuns a qualquer rota: `405 method_not_allowed` (com `Allow`), `415 unsupported_media_type`,
`413 payload_too_large`, `400 bad_request`/`invalid_request`, `403 bad_origin`,
`429 rate_limited` (com `Retry-After`), `503` (com `Retry-After: 30`).

Não há API pública de listagem, estatísticas, edição de destino nem códigos personalizados.

---

## Site público

### `POST /api/links` — criar link curto

Requisição (`Content-Type: application/json`, até 8 KB; `Origin`, se enviado, deve ser o do site):

```json
{ "url": "https://exemplo.com.br/pagina", "expiresIn": "30d", "turnstileToken": "<token do widget>" }
```

`expiresIn` (opcional): `never` (padrão), `1d`, `7d`, `30d`, `90d`, `365d`.

Respostas:

| Status | `code` | Quando |
|---|---|---|
| `201` | — | `{ "slug", "shortUrl", "destinationHost", "expiresAt" }` |
| `403` | `antibot_failed` | desafio inválido, expirado, de outra ação ou de outro hostname |
| `422` | `invalid_url:<motivo>` | `empty`, `too_long`, `invalid_characters`, `missing_scheme`, `invalid_url`, `unsupported_protocol`, `credentials_not_allowed`, `port_not_allowed`, `ip_not_allowed`, `private_address`, `invalid_host`, `reserved_host`, `confusable_host`, `self_reference` |
| `422` | `blocked_domain` | domínio (ou domínio pai) bloqueado |
| `429` | `rate_limited` | limites por IP (10 min / 24 h) ou global (1 h) |
| `503` | `creation_disabled` | criação desligada no painel |
| `503` | `antibot_unavailable` | Turnstile indisponível ou mal configurado |
| `503` | `slug_unavailable` | colisões sucessivas de código (improvável) |

### `POST /api/reports` — denunciar link

```json
{ "link": "https://SEU-SITE.netlify.app/s/CODIGO", "reason": "phishing", "details": "opcional", "contactEmail": "opcional", "turnstileToken": "..." }
```

`link` aceita a URL curta completa ou só o código. `reason`: `phishing`, `malware`, `fraud`,
`spam`, `illegal`, `other`. Respostas: `201 { "received": true }`, `404 link_not_found`,
`422 invalid_link`, `403 antibot_failed`, `429`, `503 reports_disabled`.

### `GET /api/legal/terms` · `GET /api/legal/privacy`

`200 { kind, title, body, responsibleName, responsibleContact, responsibleDocument, updatedAt }`.
O `body` é texto simples com marcação mínima (`#`, `##`, `-`), renderizado sem HTML.
Cache: `public, max-age=60` no navegador e até 5 min na CDN do Netlify (`Netlify-CDN-Cache-Control`),
então uma edição no painel pode levar alguns minutos para aparecer.

### `GET /s/:slug` — página intermediária (HTML)

| Status | Página |
|---|---|
| `200` | domínio de destino, URL completa recolhida, botão **Continuar**, publicidade opcional |
| `404` | código inexistente ou malformado |
| `410` | link expirado ou excluído |
| `403` | link bloqueado (individualmente ou pelo domínio) |
| `429` | limite de visualizações por IP |
| `503` | estado do link não pôde ser verificado (nunca redireciona) |

`HEAD` é aceito (sem emitir ticket). Cabeçalhos: CSP com nonce, `Cache-Control: no-store`,
`X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: strict-origin-when-cross-origin`.

### `POST /s/:slug/continue` — continuar (formulário)

`Content-Type: application/x-www-form-urlencoded`, campo `ticket`.

| Status | Significado |
|---|---|
| `303` | `Location` = destino lido do banco; `Cache-Control: no-store` |
| `400` | ticket ausente/malformado ou `Origin` de outro site — página reapresentada com novo ticket |
| `409` | ticket desconhecido, já usado, expirado ou cedo demais — página reapresentada com novo ticket |
| `403`/`410`/`404` | link bloqueado/expirado/excluído **no momento do clique** |
| `405` | qualquer método diferente de `POST` (`Allow: POST`) |
| `503` | falha ao verificar o estado (nunca redireciona) |

Parâmetros de consulta (`?url=…`) e campos extras são ignorados.

### `POST /consent` — preferência de publicidade (formulário)

Campos `choice` (`granted` | `denied`) e `return` (`/preferencias` ou `/s/CODIGO`; qualquer outro
valor vira `/preferencias`). Responde `303` e grava o cookie `el_ads_consent` (180 dias,
`SameSite=Lax`, legível pela página de preferências por não ser segredo).

### Função agendada `cleanup` (`@daily`)

Sem rota HTTP. Executa a limpeza/retenção descrita em [operacao.md](operacao.md).

---

## Painel administrativo (outra origem)

Todas as rotas exigem que a origem da requisição seja `ADMIN_SITE_URL` (senão `404`, inclusive
nas URLs alternativas de deploy do Netlify).

### Autenticação

| Rota | Descrição |
|---|---|
| `GET /auth/github/start` | cria `state` + PKCE, grava `__Host-el_oauth` (10 min) e redireciona ao GitHub |
| `GET /auth/github/callback` | valida `state`, troca o código, confere ID autorizado e 2FA, cria a sessão e grava `__Host-el_admin`; erros voltam para `/?erro=<código>` |
| `POST /auth/logout` | revoga a sessão (CSRF obrigatório) → `204` |

Códigos de erro do login: `nao_configurado`, `sessao_expirada`, `falha_no_login`,
`nao_autorizado`, `sem_2fa`, `indisponivel`.

### `/api/admin/*`

Requisitos: cookie de sessão válido (`401 unauthorized` se ausente/expirado/revogado). Em `POST`:
`Origin` igual ao painel, `Sec-Fetch-Site: same-origin` (quando enviado) e `X-CSRF-Token`
(obtido em `GET session`) — senão `403`. Corpos JSON estritos (campos desconhecidos → `400 invalid_body`).
Listagens: `page` (1–1000), `pageSize` (5–100, padrão 25) → `{ items, page, pageSize, hasMore }`.

| Método e rota | Corpo / parâmetros | Resposta |
|---|---|---|
| `GET session` | — | `{ admin: { githubId, login }, csrfToken, expiresAt }` |
| `GET links` | `q` (código ou domínio), `status` (`all`/`active`/`blocked`/`deleted`) | lista paginada |
| `POST links/:slug/block` · `unblock` · `delete` | `{ "reason"?: string }` | `{ slug, status }` |
| `GET reports` | `status` (`all`/`open`/`resolved`/`dismissed`) | lista paginada |
| `POST reports/:id/resolve` · `dismiss` | `{ "note"?: string, "blockLink"?: boolean }` | `{ id, status, linkBlocked }` |
| `GET domains` | `q` | lista paginada |
| `POST domains` | `{ "domain": string, "reason"?: string }` | domínio bloqueado (vale para subdomínios) |
| `POST domains/:domain/delete` | — | desbloqueio |
| `GET metrics` | `days` (1–400, padrão 30) | séries diárias e totais agregados |
| `GET settings` / `POST settings` | `{ linkCreationEnabled?, adsEnabled?, reportsEnabled? }` (ao menos um) | configurações atuais |
| `GET legal/terms` · `legal/privacy` | — | documento |
| `POST legal/terms` · `legal/privacy` | `{ title, body, responsibleName?, responsibleContact?, responsibleDocument? }` | documento salvo |
| `GET audit` | paginação | trilha de auditoria |
| `POST sessions/revoke-all` | `{}` | `{ revoked }` — encerra todas as sessões do administrador |

Toda alteração grava um registro em `admin_audit_log` na mesma transação.

### Métricas: o que cada número significa

| Métrica | Origem | O que **não** significa |
|---|---|---|
| `interstitialView` | página `/s/:slug` renderizada pelo servidor | não é visitante único nem impressão de anúncio |
| `continuation` | ticket consumido com sucesso (`303`) | não prova que um anúncio foi exibido ou visto |
| `linkCreated` / `linkRejected` / `reportCreated` | eventos do servidor | — |
| Impressões/receita de anúncios | **somente** o painel do Adsterra | o EncurtaLinks não mede nem estima isso |
