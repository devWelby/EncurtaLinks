# Operação: backup, emergências, rollback e retenção

## Backup e restauração

### O que existe

| Camada | Cobertura | Limite no Free |
|---|---|---|
| Histórico do Neon (restauração a um ponto no tempo / branch) | erros recentes (ex.: exclusão acidental) | **6 horas** |
| Snapshot manual do Neon | antes de mudanças arriscadas | 1 snapshot |
| `pg_dump` próprio (recomendado) | desastres, troca de provedor, erros descobertos tarde | depende de onde você guarda |
| Ensaio `npm run db:restore-drill` | prova que um dump restaura e confere o conteúdo | roda no CI a cada push |

### Backup com `pg_dump` (recomendado: semanal e antes de cada migração)

Use a URL **direta** (sem `-pooler`) e ferramentas cliente da **mesma versão principal** do
servidor (PostgreSQL 17). As credenciais vão por variáveis de ambiente, não pela linha de comando:

```sh
export PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=... PGSSLMODE=verify-full
pg_dump --format=custom --schema=app --no-owner --no-privileges \
  --file "encurtalinks-$(date -u +%Y%m%dT%H%MZ).dump"
```

- O dump contém **dados pessoais** (hashes de IP recentes, e-mails de contato de denúncias) e
  destinos de links: guarde **criptografado**, fora do repositório (o `.gitignore` já ignora
  `*.dump` e `backups/`), com acesso restrito, e apague cópias antigas conforme a retenção.
- Confira que o backup restaura (sem tocar na origem):

```sh
RESTORE_DRILL_SOURCE_URL="postgres://...direta..." PG_BIN_DIR=/caminho/para/pg17/bin \
  npm run db:restore-drill
```

O ensaio lê a origem **somente para leitura**, restaura num banco local descartável (embarcado
na porta 54333, ou `RESTORE_DRILL_DATABASE_URL` em localhost), compara migrações, contagem de
linhas por tabela, sequências e RLS, e apaga tudo no final.

### Restaurar em produção

1. Desligue a **Criação de links** no painel (se ele estiver acessível).
2. Crie um banco novo (projeto ou branch Neon) — **não** restaure por cima do banco atual.
3. `pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --dbname <novo> arquivo.dump`
4. Rode `npm run db:migrate` contra o banco novo (aplica migrações posteriores ao dump, se houver).
5. Valide com `RESTORE_DRILL_SOURCE_URL=<novo>` (somente leitura) e uma consulta a um link conhecido.
6. Troque `DATABASE_URL`/`DATABASE_MIGRATION_URL` nos **dois** sites e faça novo deploy de ambos.
7. Reative a criação de links. Links criados entre o backup e a restauração são **perdidos**
   (passam a dar "Link não encontrado"). Como os códigos são aleatórios (≈ 58 bits), a chance
   de um desses códigos perdidos ser emitido de novo é desprezível, mas não é zero.

## Emergências

| Situação | Ação imediata (painel) | Efeito |
|---|---|---|
| Link malicioso | *Links* → buscar → **Bloquear** | vale no próximo acesso, inclusive para quem já está na página intermediária |
| Campanha num domínio | *Domínios bloqueados* → adicionar | bloqueia links existentes e novos do domínio e subdomínios |
| Abuso em massa na criação | *Configurações* → desligar **Criação de links** | `503` em `POST /api/links`; links existentes seguem funcionando |
| Problema com anúncios | *Configurações* → desligar **Publicidade** | próxima página sem scripts nem origens do provedor na CSP |
| Ataque ao formulário de denúncias | *Configurações* → desligar **Denúncias** | `503` em `POST /api/reports` |
| Sessão administrativa suspeita | *Configurações* → **Encerrar todas as minhas sessões** | todas as sessões revogadas no servidor |

Toda ação fica na **Auditoria**.

### Se o painel estiver indisponível (SQL direto, com a URL direta)

```sql
-- Bloquear um link
UPDATE app.links SET status = 'blocked', status_reason = 'Bloqueio emergencial', status_changed_at = now()
 WHERE slug = 'CODIGO' AND status = 'active';
-- Bloquear um domínio (minúsculas, punycode)
INSERT INTO app.blocked_domains (domain, reason, created_by) VALUES ('dominio.exemplo', 'emergência', 'sql')
ON CONFLICT (domain) DO NOTHING;
-- Desligar criação / publicidade / denúncias
UPDATE app.app_settings SET value = 'false'::jsonb, updated_at = now(), updated_by = 'sql'
 WHERE key IN ('link_creation_enabled', 'ads_enabled', 'reports_enabled');
-- Revogar todas as sessões administrativas
UPDATE app.admin_sessions SET revoked_at = now() WHERE revoked_at IS NULL;
```

Não há cache das decisões de bloqueio: o efeito é imediato.

### Administrador comprometido

1. Encerre as sessões (painel ou SQL acima).
2. Remova o ID de `ADMIN_GITHUB_USER_IDS` e gere novo `GITHUB_CLIENT_SECRET` no OAuth App;
   atualize as variáveis e faça novo deploy do painel.
3. Revise a **Auditoria** e reverta alterações indevidas.
4. Se houver suspeita sobre o banco, troque a senha do role no Neon e atualize `DATABASE_URL`
   nos dois sites.

### Último recurso: parar tudo

Remova `DATABASE_URL` do site público e faça novo deploy: todas as rotas de link passam a
responder `503` (nunca redirecionam) e a criação falha; as páginas estáticas continuam.

## Rollback

### Código

*Netlify → Deploys →* escolha o último deploy bom → **Publish deploy**. Funções e arquivos
estáticos voltam juntos (deploy atômico). Faça nos dois sites se a mudança afetou ambos.
Use *Stop auto publishing* para impedir que um push publique por cima enquanto investiga.

### Banco (expand/contract)

As migrações **não** são desfeitas no rollback do código. Por isso:

1. **Expandir:** a migração só adiciona (colunas anuláveis/com padrão, tabelas, índices) e o
   código antigo continua funcionando com ela.
2. Publicar o código novo que usa as estruturas novas.
3. **Contrair** (remover o que ficou sem uso) só numa migração posterior, quando não houver mais
   chance de voltar à versão antiga.

O migrador aceita um banco com migrações **mais novas** que o código publicado (avisa e segue),
então o build do rollback não falha. Ele **interrompe** o deploy se houver migrações pendentes
com o banco adiantado, ou se o histórico divergir (checksum diferente).

## Retenção e limpeza (função agendada diária)

| Dado | Retenção |
|---|---|
| Tickets de continuação | apagados 24 h após expirar |
| Contadores de limite de uso | apagados ao expirar a janela |
| Hash HMAC do IP de quem criou o link / denunciou | removido após **30 dias** |
| E-mail de contato da denúncia | removido **180 dias** após a resolução |
| Destino de link expirado | removido **180 dias** após a expiração (o código continua reservado) |
| Métricas diárias por link | **400 dias** |
| Sessões administrativas expiradas/revogadas | **30 dias** |
| Auditoria, denúncias (sem dados pessoais), links ativos | sem expiração automática |

Os prazos estão em `src/server/domain/cleanup.ts` e devem ser refletidos na Política de
Privacidade publicada. A função só roda no deploy de produção publicado; teste com *Run now*.

## Monitoramento

- **Logs do Netlify** (JSON por linha): `config_invalid`, `config_warning`, `interstitial_failed`,
  `antibot_unavailable`, `create_rate_limited`, `admin_login_denied`, `cleanup_failed`.
  Os logs nunca contêm tokens, cookies, IPs, e-mails nem URLs de destino completas.
- **Uso:** créditos do Netlify e CU-hora do Neon ([custos.md](custos.md)).
- **Dependabot** abre PRs semanais de atualização; revise e deixe o CI validar.
