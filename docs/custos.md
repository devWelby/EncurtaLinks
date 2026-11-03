# Custos, limites e créditos

*Fontes consultadas em **2026-11-02**. Os provedores mudam preços e limites; confira os links
antes de decidir. Os valores de consumo por operação são **estimativas**, não medições de produção.*

**Nada neste projeto contrata, ativa ou recarrega planos pagos.** Upgrades, recargas e
add-ons são decisões manuais do proprietário.

## Limites dos planos gratuitos

### Netlify — plano Free (por equipe; os dois sites dividem a mesma cota)

| Item | Valor |
|---|---|
| Créditos | **300 por mês** |
| Deploy de produção | **15 créditos cada** |
| Compute (funções) | 10 créditos por GB-hora |
| Requisições web | 2 créditos por 10.000 |
| Banda | 20 créditos por GB |
| Ao esgotar | **todos os sites da equipe são pausados** ("Site not available") até o próximo ciclo; no Free não há compra de créditos |
| Regras de rate limit em código | 2 por projeto (usamos 2 em cada site) |
| Funções | 60 s síncronas, 30 s agendadas, 1024 MB, payload 6 MB; região padrão `cmh` (Ohio), fixa no Free |

Fontes: [preços](https://www.netlify.com/pricing/),
[FAQ de créditos](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/billing-faq-for-credit-based-plans/),
[rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/),
[configuração de funções](https://docs.netlify.com/build/functions/configuration/),
[funções agendadas](https://docs.netlify.com/build/functions/scheduled-functions/).

### Neon — plano Free (por projeto)

| Item | Valor |
|---|---|
| Compute | **100 CU-hora/mês** (0,25 CU ⇒ ~400 h ativas); autoscaling até 2 CU |
| Suspensão | após 5 min sem consultas (não desativável no Free); suspenso não consome |
| Armazenamento | 1 GB (escritas bloqueadas acima disso) |
| Transferência | 5 GB/mês |
| Histórico (restauração a um ponto no tempo) | 6 horas |
| Ao esgotar compute/transferência | compute suspenso até o próximo ciclo; dados mantidos |
| Cartão de crédito | não exigido |

Fontes: [preços](https://neon.com/pricing), [planos](https://neon.com/docs/introduction/plans).

### Outros

- **Cloudflare Turnstile Free:** gratuito, até 20 widgets e 10 hostnames por widget
  ([planos](https://developers.cloudflare.com/turnstile/plans/)).
- **GitHub Actions:** gratuito para repositórios públicos; repositórios privados consomem a
  cota de minutos da conta (cada execução do CI leva alguns minutos).
- **Adsterra:** sem custo para o publisher; receita não garantida.

## Consumo estimado por operação (Netlify)

Premissas: funções com 1024 MB (= 1 GB) e ~150 ms por execução com o banco acordado
(1 GB × 0,15 s ≈ 0,0000417 GB-h ≈ **0,0004 crédito**); página intermediária ≈ 10 KB;
arquivos da SPA em cache após a primeira visita.

| Operação | Requisições | Funções | Banda | Créditos (≈) |
|---|---|---|---|---|
| Visita a um link (abrir + continuar) | 2–3 | 2 | ~12 KB | **0,0016** |
| Criar link (página já em cache) | 1 | 1 | ~1 KB | 0,0006 |
| Primeira visita à página inicial | ~6 | 0 | ~80 KB comprimidos | 0,0028 |
| Ação no painel | 1–2 | 1–2 | ~2 KB | 0,001 |
| Limpeza diária | — | 1/dia | — | desprezível |
| **Push em `main` que muda os dois sites** | — | — | — | **30** (2 × 15) |

Ordem de grandeza: com ~10 pushes/mês (300 créditos), **os deploys sozinhos esgotam a cota**.
Sem deploys, 300 créditos cobririam ~180 mil visitas a links por mês — mas na prática o limite
vem antes do banco (abaixo). O comando `ignore` evita builds sem mudanças relevantes, e
Deploy Previews não aparecem como cobrança de deploy na tabela oficial.

## Consumo estimado no banco (Neon)

O compute fica acordado enquanto houver consultas e por mais 5 minutos depois da última.

| Padrão de tráfego | Compute aproximado (0,25 CU) | Situação no Free |
|---|---|---|
| Acessos esporádicos (poucas dezenas por dia, concentrados) | 20–60 CU-h/mês | cabe |
| Pelo menos 1 acesso a cada 5 min, o dia todo | ~180 CU-h/mês | **excede**: compute suspenso por volta do 16º dia |
| Limpeza diária sozinha | ~0,6 CU-h/mês | desprezível |

Armazenamento: um link ocupa ordem de 0,5–1 KB com índices ⇒ ~1 milhão de links por GB.
Tickets e contadores de limite são apagados pela limpeza diária.

**Quando o banco é suspenso, os links passam a responder `503` (sem redirecionar) e a criação
falha; as páginas estáticas continuam no ar.** É o comportamento seguro, mas é indisponibilidade.

## O que acompanhar

1. **Netlify → Usage & billing:** créditos consumidos por categoria (deploys, compute, banda).
2. **Neon → Usage:** CU-hora e armazenamento do mês.
3. **Painel do EncurtaLinks → Visão geral:** aberturas, continuações e criações por dia.

## Quando o gratuito não bastar (decisão manual)

- **Neon Launch:** cobrança por uso (US$ 0,106 por CU-hora; US$ 0,35 por GB-mês) — 180 CU-h
  ≈ US$ 19/mês, sem mínimo mensal ([preços](https://neon.com/pricing)).
- **Netlify Personal:** US$ 9/mês com 1.000 créditos ([preços](https://www.netlify.com/pricing/)).
- Reduzir consumo antes de pagar: agrupar deploys, desligar previews do site público se
  não forem usados, aumentar `RATE_LIMIT_*` com cautela, bloquear abuso cedo.
