# Publicação (deploy) do EncurtaLinks

Resultado final: **dois sites Netlify** ligados ao mesmo repositório GitHub e um banco
PostgreSQL gerenciado (Neon). Tudo cabe nos planos gratuitos para tráfego baixo — veja os
limites e riscos em [custos.md](custos.md). **Nenhum upgrade pago é feito automaticamente.**

> Os nomes `*.netlify.app` são escolhidos na criação de cada site e precisam estar livres.
> Não presuma que um nome específico (por exemplo `atalholink.netlify.app`) está disponível;
> os exemplos abaixo usam `SEU-SITE` e `SEU-PAINEL`.

## 0. Pré-requisitos

- Conta GitHub com **verificação em duas etapas** ativa (de preferência chave de segurança
  ou passkey). Ela protege o código *e* o acesso ao painel.
- Contas no Netlify, Neon e Cloudflare, todas com 2FA ativo.
- Node.js 24 (veja `.nvmrc`) para rodar os comandos locais.

## 1. Banco de dados (Neon)

1. Crie um projeto com **PostgreSQL 17** na região **AWS US East 2 (Ohio)** — a mesma área
   da região padrão das funções do Netlify (`cmh`, Ohio), que não pode ser trocada no
   plano Free. Isso reduz a latência de cada consulta.
2. Em *Connection details* copie duas URLs do mesmo role (dono do banco):
   - **pooled** (host com `-pooler`) → `DATABASE_URL` das funções;
   - **direta** (sem `-pooler`) → `DATABASE_MIGRATION_URL` (migrações).
   Ambas com `?sslmode=require`; o código verifica o certificado (`DATABASE_SSL=verify`).
3. Crie **branches separadas** para previews/staging (ex.: `staging`) e use a URL dela nos
   contextos *Deploy Previews* e *Branch deploys*. **Nunca** use a URL de produção nesses
   contextos.

> O aplicativo usa o role dono do schema `app` (as tabelas têm RLS ativo e nenhuma política,
> então outros roles não leem nada). Separar um role só de aplicação exigiria políticas RLS
> e `GRANT`s adicionais — ver [limitacoes.md](limitacoes.md).

## 2. Site público no Netlify

1. *Add new project → Import an existing project → GitHub* e escolha o repositório.
2. Configuração de build:
   - **Base directory:** vazio (raiz do repositório)
   - **Package directory:** `apps/public`
   - Comando, pasta publicada e funções vêm de `apps/public/netlify.toml` (não preencha no painel).
   - Branch de produção: `main`.
3. Escolha um nome livre para o site (ex.: `encurtalinks-SEUSUFIXO`). A URL final será
   `https://SEU-SITE.netlify.app`.
4. **Cloudflare Turnstile:** crie um widget (modo *Managed*) com o hostname
   `SEU-SITE.netlify.app`. Guarde a *site key* e a *secret key*.
5. Variáveis de ambiente (*Site configuration → Environment variables*), com valores por
   contexto — detalhes em [configuracao.md](configuracao.md):

| Variável | Production | Deploy Previews / Branch deploys |
|---|---|---|
| `PUBLIC_SITE_URL` | `https://SEU-SITE.netlify.app` | não definir (fora de produção vale a origem da própria requisição) |
| `ADMIN_SITE_URL` | `https://SEU-PAINEL.netlify.app` | idem produção |
| `DATABASE_URL` | URL **pooled** de produção | URL da branch `staging` |
| `DATABASE_MIGRATION_URL` | URL **direta** de produção | (opcional) direta da `staging` |
| `IP_HASH_SECRET` | 48+ caracteres aleatórios | outro valor aleatório |
| `TURNSTILE_SECRET_KEY` | secret key do widget | chave de **teste** da Cloudflare |
| `VITE_TURNSTILE_SITE_KEY` | site key do widget | site key de **teste** da Cloudflare |
| `ADS_ENABLED` | `false` (ligar só depois — [adsterra.md](adsterra.md)) | **não definir** |

   Chaves de teste do Turnstile: veja a [documentação da Cloudflare](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
   O código **recusa chaves de teste em produção** e **recusa o modo de teste** em qualquer deploy.
6. Dispare o deploy. O build de produção roda `npm run db:migrate` (idempotente, com
   advisory lock), o build do frontend e `npm run check:secrets`.

## 3. Site do painel no Netlify

1. Crie **outro** site a partir do mesmo repositório, com **Package directory** `apps/admin`
   e um nome livre (ex.: `encurtalinks-painel-SEUSUFIXO`).
2. **GitHub OAuth App** (*GitHub → Settings → Developer settings → OAuth Apps → New*):
   - Homepage URL: `https://SEU-PAINEL.netlify.app`
   - Authorization callback URL: `https://SEU-PAINEL.netlify.app/auth/github/callback`
   - Não marque *Enable Device Flow*. Gere um *client secret*.
3. Descubra o **ID numérico** de cada administrador em `https://api.github.com/users/LOGIN`.
4. Variáveis (contexto Production): `PUBLIC_SITE_URL`, `ADMIN_SITE_URL`, `DATABASE_URL`,
   `DATABASE_MIGRATION_URL`, `IP_HASH_SECRET` (aleatório; pode ser o mesmo do site público),
   `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `ADMIN_GITHUB_USER_IDS`.
5. **Desative previews e branch deploys do painel:** *Site configuration → Build & deploy →
   Continuous deployment → Branches and deploy contexts* → *Deploy Previews: Don't deploy
   pull requests* e *Branch deploys: Deploy only the production branch*. O painel só deve
   existir em produção.
6. Dispare o deploy.

## 4. Verificação depois do deploy

Substitua `P=https://SEU-SITE.netlify.app` e `A=https://SEU-PAINEL.netlify.app`.
Resultados esperados entre colchetes.

```sh
# Site público: estáticos, fallback e rotas de função
curl -s -o /dev/null -w "%{http_code}\n" "$P/"                        # [200]
curl -sI "$P/" | grep -i content-security-policy                       # [CSP presente]
curl -s -o /dev/null -w "%{http_code}\n" "$P/termos"                  # [200]
curl -s -o /dev/null -w "%{http_code}\n" "$P/nao-existe"              # [404]
curl -s "$P/api/nao-existe"                                           # [404 JSON]
curl -sI "$P/s/AAAAAAAAAA" | grep -iE "^HTTP|cache-control"           # [404, no-store]
curl -s -o /dev/null -w "%{http_code}\n" "$P/s/AAAAAAAAAA/continue"   # [405]
curl -s "$P/api/legal/terms" | head -c 120                            # [JSON do documento]

# Antiautomação ativo e modo de teste recusado em produção
curl -s -X POST "$P/api/links" -H "content-type: application/json" \
  -d '{"url":"https://example.com","turnstileToken":"test-antibot-pass"}'   # [403 antibot_failed]

# O site público não expõe o painel
curl -s -o /dev/null -w "%{http_code}\n" "$P/api/admin/session"       # [404]

# Painel: sem sessão, cabeçalhos estritos
curl -s -o /dev/null -w "%{http_code}\n" "$A/api/admin/session"       # [401]
curl -sI "$A/" | grep -iE "content-security-policy|x-robots-tag"      # [default-src 'none'; noindex]

# URLs alternativas do mesmo deploy NÃO dão acesso à API do painel
# (copie o "Deploy permalink" em Deploys → último deploy, ex.: https://<id>--SEU-PAINEL.netlify.app)
curl -s -o /dev/null -w "%{http_code}\n" "https://<id>--SEU-PAINEL.netlify.app/api/admin/session"  # [404]
```

No navegador:

1. Crie um link em `$P` (desafio Turnstile real), abra o link curto e clique em **Continuar** —
   deve ir ao destino (resposta `303`).
2. Entre no painel com o GitHub autorizado; confira *Visão geral* e *Auditoria* (`admin.login`).
3. Bloqueie um link de teste e confirme a página "Este link foi bloqueado"; desbloqueie.
4. Edite os **Termos** e a **Política de Privacidade** (responsável, contato) — o texto padrão é
   um modelo e **não** constitui orientação jurídica.
5. *Deploys → Trigger deploy* no site público e confirme que os links continuam funcionando
   (persistência após redeploy).
6. Em *Logs → Functions*, confira que não há `config_invalid` nem `config_warning` inesperados
   (por exemplo, "Publicidade desativada: …" quando você não pretendia ligar anúncios).

Itens que só podem ser confirmados no Netlify (o emulador local não os reproduz): empacotamento
das funções, versão do Node em execução, limites de taxa da plataforma, função agendada
`cleanup` (roda só no deploy publicado de produção; use *Run now* para testar) e a precedência
das funções sobre a regra `/*` → `404`.

## 5. Atualizações seguintes

- Todo push em `main` gera **um deploy de produção por site** (15 créditos cada no plano
  Free — [custos.md](custos.md)). O comando `ignore` do `netlify.toml` pula o build quando
  nada relevante mudou. Agrupe mudanças antes de enviar.
- Migrações novas devem ser compatíveis com a versão anterior do código (expand/contract) —
  ver [operacao.md](operacao.md#rollback).
- O CI (`.github/workflows/ci.yml`) roda lint, tipos, testes, build, verificação de segredos,
  E2E e o ensaio de restauração. Considere proteger a branch `main` exigindo o CI verde.
