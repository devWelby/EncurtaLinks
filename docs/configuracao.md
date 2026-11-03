# Configuração (variáveis de ambiente)

O arquivo [`.env.example`](../.env.example) lista todas as variáveis com comentários. Aqui está
o resumo por site e por contexto. **Segredos nunca vão para o repositório, para o
`netlify.toml` nem para variáveis `VITE_*`** (tudo com `VITE_` é público no navegador; o build
recusa variáveis `VITE_` desconhecidas e `npm run check:secrets` procura vazamentos em `dist/`).

## Como o ambiente é determinado

- O contexto do deploy informado pelo Netlify em tempo de execução manda:
  `production` ⇒ produção, **sempre** (mesmo que `APP_ENV` diga outra coisa).
- Modos de teste (antiautomação simulado, login local `/__dev/admin-login`, anúncios simulados)
  só existem no emulador local (contexto `dev` + `APP_ENV` `development`/`test`). Em qualquer
  deploy, `ANTIBOT_MODE=test` faz a configuração falhar e o build recusa `VITE_ANTIBOT_MODE=test`.
- Configuração inválida ⇒ as funções respondem `503` e registram `config_invalid` (sem valores).

## Segredos

| Variável | Sites | Observação |
|---|---|---|
| `DATABASE_URL` | ambos | URL *pooled*; um banco por contexto (produção ≠ previews) |
| `DATABASE_MIGRATION_URL` | ambos | opcional; URL direta para migrações |
| `IP_HASH_SECRET` | ambos | ≥ 32 caracteres aleatórios; trocar reinicia os limites por IP e a contagem de denúncias por origem |
| `TURNSTILE_SECRET_KEY` | público | chave de teste da Cloudflare só fora de produção |
| `GITHUB_CLIENT_SECRET` | painel | OAuth App do painel |
| `DATABASE_CA_CERT` | ambos | não é segredo, mas fica junto da conexão |

## Não secretas

| Variável | Padrão | Sites | Uso |
|---|---|---|---|
| `PUBLIC_SITE_URL` | origem da requisição (fora de produção) | ambos | obrigatória em produção (https) |
| `ADMIN_SITE_URL` | `http://127.0.0.1:8889` (local) | ambos | obrigatória no painel; a API só responde nessa origem |
| `DATABASE_SSL` | `verify` | ambos | `disable` só local; recusado em produção |
| `VITE_TURNSTILE_SITE_KEY` | — | público (build) | obrigatória no build de produção; chave de teste recusada |
| `GITHUB_CLIENT_ID` | — | painel | — |
| `ADMIN_GITHUB_USER_IDS` | — | painel | IDs numéricos separados por vírgula |
| `ADMIN_REQUIRE_GITHUB_2FA` | `true` | painel | exige 2FA na conta GitHub |
| `ADMIN_SESSION_TTL_SECONDS` | `28800` (8 h) | painel | 600–86400 |
| `ADMIN_SESSION_IDLE_SECONDS` | `1800` (30 min) | painel | 300–28800 |
| `ADS_ENABLED` | `false` | público | ver [adsterra.md](adsterra.md) |
| `ADS_REQUIRE_CONSENT` | `true` | público | — |
| `ADSTERRA_SLOT_PRIMARY_HTML` / `_SECONDARY_HTML` | — | público | tags exatas do Adsterra (≤ 4000 caracteres) |
| `ADS_CSP_*_SRC` | — | público | origens extras exigidas pelas tags |
| `ADS_DEV_PLACEHOLDER` | `true` | público | espaço simulado fora de produção |
| `TICKET_TTL_SECONDS` | `1800` | público | 60–86400 |
| `CONTINUE_MIN_WAIT_SECONDS` | `0` | público | 0–15, validado no servidor |
| `REPORT_AUTO_BLOCK_THRESHOLD` | `5` | público | origens distintas em 24 h; 0 desliga |
| `RATE_LIMIT_*` | ver `.env.example` | ambos | limites no PostgreSQL |

O interruptor "Criação de links", "Publicidade" e "Denúncias" fica no **banco** (painel →
Configurações) e vale na hora, sem deploy.

## Matriz por contexto

| | Local (`npm run dev`) | Deploy Preview / Branch deploy (site público) | Produção |
|---|---|---|---|
| Banco | PostgreSQL embarcado em `.local-db/` | branch `staging` do Neon | banco de produção |
| Migrações no build | — (o `dev` migra o banco local) | não rodam | `npm run db:migrate` |
| Turnstile | simulado | chaves de **teste** da Cloudflare | chaves reais |
| Anúncios | espaço simulado | espaço simulado; **nunca** `ADS_ENABLED` | opcionais |
| Painel | `http://127.0.0.1:8889` + login local | **desativado** (sem previews no site do painel) | GitHub OAuth |
| Limpeza agendada | não roda | não roda (só deploy publicado) | diária |

Se uma variável faltar num preview, as funções respondem `503` — o comportamento seguro.
