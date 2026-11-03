# Limitações, dependências externas e riscos residuais

## O que foi verificado e onde

| Item | Implementado | Testado localmente | Validado em produção |
|---|---|---|---|
| Criação, página intermediária, tickets, denúncias, textos legais | sim | sim (integração + E2E) | **não** (nenhum deploy feito por este trabalho) |
| Painel (OAuth GitHub, sessões, CSRF, moderação, métricas, interruptores) | sim | sim; OAuth contra GitHub **simulado** | **não** |
| Publicidade (consentimento, falhas, bloqueador, interruptor) | sim | sim, com anúncios **simulados** | **não** (depende de aprovação no Adsterra) |
| Migrações, limites de uso, limpeza, persistência após "redeploy" | sim | sim (PostgreSQL real local) | **não** |
| Ensaio de backup/restauração | sim | só o caminho de erro (sem `pg_dump` na máquina) | roda no CI |
| Rotas e cabeçalhos do Netlify | sim (`netlify.toml`) | no emulador local | **não**: conferir com o checklist de [deploy.md](deploy.md) |
| Rate limiting da plataforma Netlify | configurado | **não** reproduzível localmente | **não** |

## Limitações conhecidas

- **Segurança não é absoluta.** Validação de URL não detecta phishing ou malware: o destino
  nunca é acessado, e um domínio legítimo hoje pode servir conteúdo malicioso amanhã. A
  moderação depende de denúncias e da ação do administrador.
- **Homógrafos (IDN):** a heurística barra casos comuns, mas não todos; a página mostra o
  domínio em ASCII para conferência.
- **Limites de uso por IP** podem afetar usuários atrás do mesmo IP (redes móveis/empresas) e
  não impedem ataques distribuídos; o limite global e o interruptor de criação são a contenção.
- **Disponibilidade:** depende de Netlify, Neon, Cloudflare (Turnstile) e GitHub (login). Sem o
  banco, links respondem `503` (falha segura, mas indisponível). No plano Free, esgotar os
  créditos do Netlify **pausa os dois sites**; esgotar o compute do Neon suspende o banco até o
  próximo ciclo ([custos.md](custos.md)).
- **Latência:** o Neon suspende o compute após 5 min sem uso; a primeira consulta depois disso
  leva mais tempo.
- **Role único no banco:** o aplicativo conecta com o role dono do schema `app`. RLS está ativo
  sem políticas (bloqueia outros roles e APIs automáticas), mas não há separação de privilégios
  entre migração e aplicação.
- **Métricas aproximadas:** aberturas incluem robôs e recarregamentos; continuações não provam
  visualização de anúncio; o painel não mostra receita.
- **Sem recuperação de links por usuários:** não há conta, listagem nem edição; quem perde o
  link curto não o recupera (decisão de escopo).
- **Textos legais padrão** são modelos genéricos: precisam ser revisados e completados pelo
  proprietário. Não há declaração automática de conformidade jurídica.
- **Backups no Free:** histórico de 6 h e 1 snapshot no Neon; backups de longo prazo dependem de
  `pg_dump` periódico feito pelo proprietário.
- **Emulador local:** reproduz rotas, cabeçalhos e funções, mas não o empacotamento, a CDN, o
  rate limiting e as funções agendadas do Netlify.
- **PKCE no GitHub:** o fluxo usa PKCE (S256), suportado pelo GitHub em OAuth Apps; foi testado
  contra respostas simuladas, não contra o GitHub real.

## Dependências externas

| Serviço | Para quê | Se falhar |
|---|---|---|
| Netlify (CDN + Functions) | hospedagem dos dois sites | site fora do ar |
| Neon (PostgreSQL) | todos os dados | links `503`, criação falha, páginas estáticas no ar |
| Cloudflare Turnstile | antiautomação | criação e denúncias `503` (falha segura) |
| GitHub OAuth | login do painel | sem novos logins; sessões ativas continuam até expirar |
| Adsterra (opcional) | anúncios | espaços recolhidos; acesso normal |

Dependências npm de execução (versões fixadas, `package-lock.json`): `pg`, `oauth4webapi`, `zod`,
`react`, `react-dom`.

## Configuração manual que continua pendente

1. Criar os dois sites no Netlify (nomes livres), o projeto Neon, o widget Turnstile e o OAuth App.
2. Preencher as variáveis por contexto ([configuracao.md](configuracao.md)).
3. Desativar previews e branch deploys no site do painel.
4. Revisar e publicar Termos e Política de Privacidade (responsável e contato).
5. Ativar 2FA em todas as contas (GitHub, Netlify, Neon, Cloudflare, Adsterra).
6. (Opcional) Proteger a branch `main` exigindo o CI.
7. (Opcional) Adsterra: aprovação, tags e ativação ([adsterra.md](adsterra.md)).
8. Rodar o checklist pós-deploy e agendar `pg_dump` periódico.
