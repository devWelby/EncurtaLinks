# Dados e privacidade (inventário técnico)

Este documento descreve **o que o código faz**. Ele não é parecer jurídico e o EncurtaLinks
**não declara conformidade** com LGPD, GDPR ou qualquer outra norma — isso depende de como o
proprietário opera o serviço, dos textos publicados e de avaliação profissional.

## O que é guardado

| Dado | Onde | Por quê | Retenção |
|---|---|---|---|
| URL de destino e domínio | `app.links` | funcionamento do link | enquanto ativo; removido 180 dias após expirar ou na exclusão |
| HMAC-SHA256 do IP de quem criou | `app.links.creator_ip_hash` | limites de uso e investigação de abuso | 30 dias |
| Denúncia: motivo, detalhes, e-mail opcional, HMAC do IP | `app.reports` | moderação | IP: 30 dias; e-mail: 180 dias após resolução |
| Hash SHA-256 do ticket de continuação | `app.continuation_tickets` | uso único da continuação | 24 h após expirar |
| Contadores de limite (chave = prefixo do HMAC do IP ou da sessão) | `app.rate_limit_counters` | limites de uso | até o fim da janela |
| Contagens diárias agregadas | `app.daily_metrics`, `app.link_daily_metrics` | painel | 400 dias (por link) |
| Sessão administrativa (hash do token, ID/login do GitHub) | `app.admin_sessions` | login | 30 dias após expirar/revogar |
| Ações administrativas | `app.admin_audit_log` | rastreabilidade | sem expiração automática |

**Não** é guardado: IP bruto, user-agent, referer, impressão digital do navegador (fingerprint),
cookies de terceiros, conteúdo das páginas de destino. O IP vem de `context.ip` do Netlify
(cabeçalhos de IP enviados pelo cliente são ignorados) e é transformado com HMAC
(`IP_HASH_SECRET`) antes de qualquer uso.

## Cookies do EncurtaLinks

| Cookie | Site | Finalidade | Atributos |
|---|---|---|---|
| `el_ads_consent` | público | lembrar a escolha sobre anúncios | 180 dias, `SameSite=Lax`, legível por JS (não é segredo) |
| `__Host-el_admin` | painel | sessão administrativa | `Secure`, `HttpOnly`, `SameSite=Strict`, sem `Domain` |
| `__Host-el_oauth` | painel | `state` + PKCE durante o login | 10 min, `Secure`, `HttpOnly`, `SameSite=Lax` |

Nenhum token fica em `localStorage`/`sessionStorage` (regra de lint + teste E2E).

## Terceiros

- **Cloudflare Turnstile:** carregado só nas páginas de criar link e de denúncia.
- **Adsterra (opcional):** scripts só na página intermediária e, por padrão, **só após o
  consentimento**; recusar não impede o acesso. Revogação em *Preferências de anúncios*.
  O tratamento de dados pelo provedor segue a política dele.
- **GitHub:** somente no login do painel (escopo `read:user`).
- **Netlify e Neon:** hospedagem e banco (operadores de infraestrutura).

## Logs

Logs estruturados sem tokens, cookies, credenciais, IPs, e-mails, corpos de requisição nem URLs
de destino completas (só o domínio e o código). Campos com nomes sensíveis são descartados
automaticamente (`src/server/logger.ts`). Os logs da plataforma Netlify seguem a retenção do plano.

## Métricas separadas

Aberturas da página intermediária, continuações confirmadas pelo servidor e métricas do
Adsterra são números **diferentes** e nunca são somados ou convertidos entre si.
