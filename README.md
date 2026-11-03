# EncurtaLinks

Encurtador de links **gratuito**, sem cadastro, em português. Quem abre um link curto vê
primeiro uma página intermediária com o **domínio de destino** e um único botão **Continuar**.
Essa página pode exibir publicidade identificada (Adsterra, **opcional e desligada por padrão**),
que é a única forma de monetização — e fica com o proprietário do serviço.

- Site público e painel administrativo em **dois sites Netlify** separados.
- **PostgreSQL** gerenciado (Neon) com migrações, limites de uso e retenção de dados.
- Testes unitários, de integração (PostgreSQL real) e E2E (Playwright, desktop e celular).

> **Situação:** implementado e testado localmente. **Ainda não publicado** — nada foi validado
> em produção. Veja [docs/limitacoes.md](docs/limitacoes.md) para o que foi verificado onde.

## Funcionalidades

**Visitante**
- Criar link curto (validade opcional), copiar com um clique, sem conta.
- Página intermediária com domínio e URL completa, aviso de responsabilidade e denúncia.
- Páginas próprias para link inexistente, expirado, removido ou bloqueado.
- Denúncia de links, termos de uso, política de privacidade e preferências de anúncios.

**Administrador** (GitHub com 2FA)
- Busca paginada de links; bloquear, desbloquear e excluir.
- Denúncias (resolver, descartar, bloquear o link), domínios bloqueados.
- Métricas agregadas, interruptores (criação de links, publicidade, denúncias), edição dos
  textos legais, auditoria e encerramento de sessões.

**Fora do escopo (de propósito):** listagem ou estatística pública, edição do destino, códigos
personalizados, upload de arquivos, pré-visualização remota, pagamento a usuários, IA.

## Como funciona (resumo)

```
/            SPA React (CDN)            → POST /api/links  (Turnstile, validação, limites)
/s/CODIGO    função: página intermediária → POST /s/CODIGO/continue (ticket único) → 303 destino
painel       outro site: GitHub OAuth + PKCE, sessão no servidor, CSRF, CSP estrita
```

Detalhes e decisões (inclusive por que **Neon** e não o Netlify Database no plano Free):
[docs/arquitetura.md](docs/arquitetura.md).

## Começando (desenvolvimento local)

Requisitos: **Node.js 24** (`.nvmrc`). Não é preciso instalar PostgreSQL: o projeto usa os
binários oficiais via `embedded-postgres`.

```sh
npm ci
npm run dev
```

- Site público: <http://localhost:8888>
- Painel: <http://127.0.0.1:8889> — login local em <http://127.0.0.1:8889/__dev/admin-login>
  (só existe no ambiente local e some quando `GITHUB_CLIENT_ID` está definido).

O `dev` sobe um PostgreSQL persistente em `.local-db/`, aplica as migrações, compila o frontend
(recompila ao salvar) e emula as rotas e funções do Netlify. O antiautomação é simulado e os
anúncios aparecem como um espaço de teste — nenhum serviço externo é chamado.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | ambiente local completo |
| `npm run lint` | ESLint (zero avisos) |
| `npm run typecheck` | TypeScript estrito (navegador, servidor e E2E) |
| `npm test` | Vitest: unidade + integração com PostgreSQL real descartável |
| `npm run test:e2e` | Playwright (Chromium desktop e Pixel 5), rede isolada, anúncios simulados |
| `npm run build` | build de produção dos dois sites em `dist/` |
| `npm run check:secrets` | procura segredos no build publicado |
| `npm run db:migrate` | aplica migrações (`DATABASE_MIGRATION_URL` ou `DATABASE_URL`) |
| `npm run db:restore-drill` | ensaio isolado de backup/restauração (exige `pg_dump`/`pg_restore` 17) |
| `npm run verify` | lint, tipos, testes, build, segredos e E2E em sequência |

Primeira execução do E2E: `npx playwright install chromium`.

## Estrutura

```
apps/public/   site público: SPA, netlify.toml, funções (netlify/functions/*.mts)
apps/admin/    painel: SPA, netlify.toml, funções
src/server/    regras de negócio, segurança, banco, renderização da página intermediária
src/shared/    tipos e constantes comuns
src/ui/        componentes React compartilhados
db/migrations/ SQL das migrações
scripts/       migração, verificação de segredos, ensaio de restauração, ambiente local/E2E
tests/         unit/, integration/, e2e/
docs/          documentação
```

## Documentação

| Documento | Conteúdo |
|---|---|
| [docs/deploy.md](docs/deploy.md) | publicar os dois sites, Neon, Turnstile, OAuth e checklist pós-deploy |
| [docs/configuracao.md](docs/configuracao.md) | variáveis de ambiente por site e contexto (ver também `.env.example`) |
| [docs/adsterra.md](docs/adsterra.md) | ativar e desligar publicidade |
| [docs/custos.md](docs/custos.md) | limites dos planos gratuitos (fontes de 2026-11-02) e consumo estimado |
| [docs/operacao.md](docs/operacao.md) | backup/restauração, bloqueio emergencial, rollback, retenção |
| [docs/api.md](docs/api.md) | rotas públicas e administrativas |
| [docs/arquitetura.md](docs/arquitetura.md) | fluxos e decisões técnicas |
| [docs/dados-e-privacidade.md](docs/dados-e-privacidade.md) | inventário de dados, cookies e logs |
| [docs/limitacoes.md](docs/limitacoes.md) | limitações, dependências externas e pendências manuais |
| [SECURITY.md](SECURITY.md) | controles de segurança, MFA e como relatar vulnerabilidades |

## Avisos

- O EncurtaLinks não verifica nem garante o conteúdo dos destinos.
- Não há promessa de segurança absoluta, receita com anúncios ou disponibilidade ilimitada:
  os planos gratuitos têm limites e os serviços externos podem falhar.
- Os textos legais padrão são modelos; o projeto não declara conformidade jurídica.
