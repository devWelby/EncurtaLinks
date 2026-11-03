# Segurança do EncurtaLinks

## Como relatar uma vulnerabilidade

Use o recurso **Report a vulnerability** do GitHub neste repositório (aba *Security*; o
proprietário precisa ativar *Private vulnerability reporting* em *Settings → Code security*)
ou o contato publicado na Política de Privacidade do site. Não abra issue pública com detalhes
de exploração. Inclua passos para reproduzir e o impacto esperado.

Não teste contra a instância de produção de forma que afete outras pessoas (negação de serviço,
criação em massa, spam de denúncias). Use o ambiente local (`npm run dev`).

## O que o projeto protege — e o que não promete

O EncurtaLinks aplica as medidas abaixo, mas **nenhum sistema é absolutamente seguro**. O
serviço não verifica o conteúdo dos destinos e não garante que um link seja seguro.

### Controles implementados

- **Destinos:** só `http`/`https`; sem credenciais, portas personalizadas, IPs (todas as
  notações IPv4/IPv6), nomes locais/reservados, DNS curinga para IPs, laços para o próprio
  serviço e domínios bloqueados; IDN em punycode com heurística contra homógrafos. O servidor
  **nunca acessa** a URL de destino.
- **Redirecionamento:** só via `POST` com ticket de uso único (hash no banco, consumo atômico),
  destino sempre lido do banco, estado revalidado no clique, `303` sem cache, sem
  redirecionamentos permanentes; falha ao verificar o estado ⇒ não redireciona.
- **Códigos:** 10 caracteres aleatórios (CSPRNG, ≈ 58 bits), `UNIQUE` no banco, nunca reutilizados.
- **Antiautomação:** Cloudflare Turnstile validado no servidor (ação e hostname); modo de teste
  impossível em deploys.
- **Limites de uso:** contadores atômicos no PostgreSQL (`429` + `Retry-After`) e regras de
  rate limit do Netlify; IP somente de `context.ip`, nunca de cabeçalhos do cliente.
- **Injeção:** consultas parametrizadas; HTML do servidor com escape automático; React sem
  `dangerouslySetInnerHTML`; textos legais renderizados sem HTML. O único cabeçalho com dado
  enviado por usuário é o `Location` do `303`, com a URL já validada (sem CR/LF nem caracteres
  de controle).
- **Cabeçalhos:** CSP com nonce na página intermediária (e só as origens das tags de anúncio
  configuradas), CSP `default-src 'none'` no painel, `frame-ancestors 'none'`, `nosniff`,
  `Referrer-Policy`, `COOP`, `CORP`, HSTS, `Permissions-Policy`.
- **Painel isolado:** outra origem (outro site Netlify), sem anúncios nem scripts de terceiros,
  sem CORS com credenciais, sem cookie com `Domain` amplo, `noindex`.
- **Autenticação do painel:** GitHub OAuth com PKCE (biblioteca `oauth4webapi`, sem protocolo
  próprio), lista de IDs numéricos, 2FA obrigatório na conta GitHub, sessão no servidor com
  expiração absoluta e por inatividade, revogação, cookie `__Host-` `Secure`/`HttpOnly`/
  `SameSite=Strict`. Sem senha padrão nem chave administrativa.
- **CSRF:** token por sessão em cabeçalho + `Origin` obrigatório + `Sec-Fetch-Site` em toda
  alteração; autorização verificada no servidor em **todas** as rotas.
- **URLs alternativas de deploy:** a API do painel só responde quando a origem é exatamente
  `ADMIN_SITE_URL`; em `https://<id>--site.netlify.app` ou `https://<branch>--site.netlify.app`
  responde `404`. O cookie `__Host-` também não é enviado a outros hosts. Recomenda-se ainda
  desativar previews e branch deploys do site do painel.
- **Segredos:** só em variáveis de ambiente do Netlify; `.env*` ignorados pelo git; variáveis
  `VITE_` desconhecidas recusadas no build; `npm run check:secrets` em todos os builds.
- **Banco:** TLS com verificação de certificado obrigatória em produção; schema `app` com RLS e
  `REVOKE` de `PUBLIC`; migrações transacionais com advisory lock.
- **Privacidade:** IP só como HMAC, com retenção curta; logs sem tokens, cookies, IPs, e-mails
  ou URLs completas ([docs/dados-e-privacidade.md](docs/dados-e-privacidade.md)).
- **Cadeia de suprimentos:** poucas dependências com versões exatas e lockfile; GitHub Actions
  com permissões somente leitura, ações oficiais fixadas por SHA, sem `pull_request_target`
  nem secrets no CI; Dependabot sem merge automático.

### Autenticação multifator (MFA)

| Conta | Recomendação |
|---|---|
| GitHub dos administradores | **obrigatório** pelo próprio EncurtaLinks (`ADMIN_REQUIRE_GITHUB_2FA=true`); prefira passkey ou chave de segurança, não SMS |
| GitHub do repositório/organização | 2FA exigido para todos com acesso de escrita |
| Netlify, Neon, Cloudflare, Adsterra | 2FA ativo; menor número possível de membros |

O EncurtaLinks verifica o campo `two_factor_authentication` da conta no login; ele **não** sabe
qual método de 2FA foi usado.

### Riscos residuais

Veja [docs/limitacoes.md](docs/limitacoes.md). Os principais: links legítimos que passam a
servir conteúdo malicioso, homógrafos não detectados, abuso distribuído abaixo dos limites,
comprometimento de uma conta GitHub autorizada (mitigado por 2FA, expiração e auditoria) e
indisponibilidade dos provedores.

## Resposta a incidentes

Procedimentos de bloqueio emergencial, revogação de sessões, troca de segredos e rollback:
[docs/operacao.md](docs/operacao.md).
