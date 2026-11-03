# Arquitetura do EncurtaLinks

## Visão geral

```
                 ┌──────────────────────── Netlify (plano Free) ────────────────────────┐
 Visitante ───►  │ Site PÚBLICO  (apps/public)                                          │
                 │   CDN: SPA React (/, /denunciar, /termos, /privacidade, /preferencias)│
                 │   Funções: /api/links  /api/reports  /api/legal/:kind                │
                 │            /s/:slug  /s/:slug/continue  /consent   (+ limpeza @daily) │
                 │   Anúncios Adsterra OPCIONAIS só na página /s/:slug                   │
                 ├───────────────────────────────────────────────────────────────────────┤
 Administrador ► │ Site do PAINEL (apps/admin) — outra origem, sem anúncios             │
                 │   CDN: SPA React (CSP estrita)                                        │
                 │   Funções: /auth/github/start|callback  /auth/logout  /api/admin/*    │
                 └──────────────┬────────────────────────────────────────┬──────────────┘
                                │ TLS (verificação de certificado)       │ HTTPS
                                ▼                                        ▼
                     PostgreSQL gerenciado (Neon)          Cloudflare Turnstile · GitHub OAuth
```

- **Um repositório, dois sites Netlify.** Ambos usam a raiz do repositório como
  *base directory* e `apps/public` / `apps/admin` como *package directory*. Os
  caminhos do `netlify.toml` de cada site são relativos à raiz.
- **Código compartilhado** em `src/`: `src/server` (somente funções), `src/shared`
  (tipos e constantes sem dependências de servidor) e `src/ui` (componentes React).
  O ESLint impede que o código do navegador importe módulos de servidor.
- **Funções** no formato moderno do Netlify (`export default (req: Request, context) => Response`
  e `export const config = { path, rateLimit }`), empacotadas com esbuild.
  Funções com `config.path` têm prioridade sobre arquivos estáticos e regras de
  `[[redirects]]`. Os `[[headers]]` do `netlify.toml` valem só para arquivos
  estáticos; as funções definem os próprios cabeçalhos (CSP com nonce, `no-store` etc.).

## Fluxos principais

### Criação de link (`POST /api/links`)

1. Método `POST`, `Content-Type: application/json`, corpo ≤ 8 KB, `Origin` do próprio site.
2. Limites de uso no PostgreSQL (por IP: 10 min e 24 h; global: 1 h) → `429` + `Retry-After`.
3. Interruptor "Criação de links" (painel) → `503 creation_disabled`.
4. Desafio Turnstile validado no servidor (`siteverify`), conferindo **ação** e **hostname**.
5. Validação da URL (`src/server/security/url-policy.ts`): apenas `http`/`https`, sem
   credenciais, sem portas não padrão, sem IPs (IPv4/IPv6, inclusive notações
   alternativas como `0x7f.1`, `2130706433`, `[::ffff:127.0.0.1]`) e sem serviços de DNS
   curinga para IPs; sem nomes locais ou reservados; IDN normalizado para punycode e
   recusado (heurística, sem garantia contra todo homógrafo) quando mistura alfabetos ou
   usa só letras cirílicas/gregas parecidas com latinas sob TLD latino; sem apontar para o próprio EncurtaLinks.
   **A URL nunca é acessada** pelo servidor (sem pré-visualização, sem selo de "seguro").
6. Domínios bloqueados (inclui subdomínios).
7. Código aleatório de 10 caracteres (alfabeto de 57 símbolos sem os ambíguos `0 O 1 I l`,
   `crypto.randomBytes` com amostragem por rejeição, ≈ 58,3 bits). Unicidade garantida pela restrição `UNIQUE`; em colisão, até 5 tentativas.
   Códigos **nunca** são reutilizados: links excluídos ou expirados viram "lápides".
8. Resposta `201` com o link curto.

### Acesso (`GET /s/:slug` → `POST /s/:slug/continue`)

1. `GET /s/:slug` lê o link e o estado atual (ativo, expirado, bloqueado — inclusive por
   domínio — ou excluído). Estados diferentes de "ativo" têm páginas próprias
   (`404`, `410`, `403`). Mostra o **domínio de destino**, a URL completa (recolhida) e
   um único botão **Continuar**. Respostas com `Cache-Control: no-store` e CSP com nonce.
2. É emitido um **ticket de continuação**: token aleatório de 256 bits; o banco guarda
   apenas o SHA-256, ligado ao link e com prazo (`TICKET_TTL_SECONDS`, padrão 30 min).
3. `POST /s/:slug/continue` consome o ticket com um único `UPDATE … WHERE consumed_at IS NULL
   … RETURNING` (atômico: sem reutilização nem uso duplo concorrente), **revalida o estado do
   link no mesmo momento** e responde `303 See Other` para o destino lido do banco.
   Nenhum parâmetro do cliente (`?url=`, campos extras) influencia o destino. Nunca há
   redirecionamento permanente (`301/308`).
4. Espera mínima opcional (`CONTINUE_MIN_WAIT_SECONDS`, padrão 0) validada no servidor.
5. Falha ao consultar o estado do link → `503` e **nenhum** redirecionamento.
   Falha ao gravar métricas → ignorada (gravadas com `waitUntil`, fora do caminho crítico).

> **Um ticket consumido não prova que um anúncio foi exibido ou visto.** Ele só prova
> que a página intermediária foi carregada e o botão foi enviado dentro do prazo.

### Painel administrativo

- Login **GitHub OAuth** com PKCE (`oauth4webapi`), escopo `read:user`, `allow_signup=false`.
  Autorização pelo **ID numérico** da conta (`ADMIN_GITHUB_USER_IDS`) e exigência de
  verificação em duas etapas na conta GitHub (`two_factor_authentication`).
- Sessão no servidor (tabela `admin_sessions`, só o hash do token), cookie
  `__Host-el_admin` (`Secure`, `HttpOnly`, `SameSite=Strict`, sem `Domain`), expiração
  absoluta (8 h) e por inatividade (30 min), revogação individual e "encerrar todas".
- Toda requisição: cabeçalho `Host`/origem igual a `ADMIN_SITE_URL` (senão `404`),
  sessão válida e — em métodos que alteram dados — `Origin` igual ao painel,
  `Sec-Fetch-Site` same-origin (quando enviado) e token CSRF (`X-CSRF-Token`).
- Ações gravadas em `admin_audit_log` na mesma transação da alteração.

### Publicidade

- Desligada por padrão, em duas chaves: `ADS_ENABLED=true` (ambiente do site público) **e**
  o interruptor "Publicidade" no painel (efeito imediato, sem novo deploy).
- Somente na página intermediária, **abaixo** do botão Continuar, identificada como
  "Publicidade". Nunca no painel. Scripts só depois do consentimento (padrão).
- Tags inseridas exatamente como fornecidas pelo Adsterra; a CSP da página libera somente
  as origens e hashes dessas tags. Tempo limite de 8 s: espaços sem anúncio são recolhidos.
- O site funciona igual com anúncios desligados, provedor fora do ar, bloqueador de
  anúncios ou consentimento recusado (coberto pelos testes E2E).

## Banco de dados

- Schema `app`, RLS habilitado em todas as tabelas, `REVOKE` de `PUBLIC`.
- Timestamps `timestamptz` (UTC); decisões de expiração usam o relógio do banco (`now()`).
- Migrações em `db/migrations/*.sql`, aplicadas por `src/server/db/migrate.ts`: uma transação,
  `pg_advisory_xact_lock`, checksum SHA-256 (independente de CRLF/LF). Banco com migrações
  **mais novas** que o código (após rollback do deploy) é aceito com aviso; histórico
  divergente interrompe o deploy.
- Limites de uso: contadores de janela fixa (`rate_limit_counters`) atualizados com
  `INSERT … ON CONFLICT … DO UPDATE` atômico — valem entre instâncias de função.
- Decisões de bloqueio **não são cacheadas**: cada acesso consulta o estado atual.

## Registro de decisão: PostgreSQL externo (Neon) em vez do Netlify Database

*Consultado em 2026-11-02.*

O Netlify Database existe e está incluído no plano Free, mas **não** foi escolhido:

| Critério | Netlify Database (Free) | Neon (Free) |
|---|---|---|
| Compute | máx. 1 unidade, **48 unidades-hora por ciclo**; 10 créditos por unidade-hora | **100 CU-hora por projeto/mês** (0,25 CU ⇒ ~400 h ativas) |
| De onde sai o custo | dos **mesmos 300 créditos/mês** da equipe | cota própria, separada do Netlify |
| Ao esgotar | créditos da equipe esgotados ⇒ **todos os sites pausados** ("Site not available") | só o compute do banco é suspenso até o próximo ciclo; dados mantidos |
| Suspensão por inatividade | após 5 min (não configurável no Free) | após 5 min (não configurável no Free) |
| Armazenamento | 5 GB (cobrança de armazenamento anunciada para "não antes de 1º/07/2026") | 1 GB por projeto |

Com tráfego público, o banco fica acordado boa parte do tempo. No Netlify Database
Free, 48 unidades-hora correspondem a ~2 dias contínuos e consumiriam até 480 créditos —
mais que os 300 créditos que também pagam requisições, banda, funções e deploys, o que
pausaria **também o site estático**. Com o Neon, o pior caso é o banco ficar suspenso:
as páginas estáticas continuam no ar e os links respondem `503` (falha segura).

Qualquer PostgreSQL gerenciado com TLS funciona (`DATABASE_URL`); Supabase é
alternativa (Free: 2 projetos ativos, 500 MB, **pausa após 1 semana sem atividade**,
sem backups automáticos), mas a pausa por inatividade o torna menos adequado.

Fontes: [Netlify — preços](https://www.netlify.com/pricing/),
[Netlify Database — billing e limites](https://docs.netlify.com/build/data-and-storage/netlify-database/billing-and-usage/),
[Netlify — FAQ de créditos](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/),
[Neon — preços](https://neon.com/pricing), [Neon — planos](https://neon.com/docs/introduction/plans),
[Supabase — preços](https://supabase.com/pricing).

## Outras decisões

- **Dois sites em vez de um:** o painel fica em outra origem, sem anúncios e com CSP
  `default-src 'none'`; cookies de sessão nunca são enviados ao site com scripts de terceiros.
- **Migrador próprio (≈150 linhas) em vez de ferramenta externa:** poucas dependências,
  advisory lock e tolerância a rollback documentadas e testadas.
- **Limites de uso em duas camadas:** regras de código do Netlify (2 por site no Free,
  agregadas por IP) como primeira barreira, e limites no PostgreSQL (fonte da verdade,
  com `Retry-After`). Nenhum cabeçalho de IP enviado pelo cliente é confiado: o IP vem de
  `context.ip` do Netlify.
- **Sem IA, sem GitHub Pages, sem chamadas a URLs de destino.**
