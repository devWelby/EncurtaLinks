# Publicidade com Adsterra (opcional)

A publicidade é **opcional e vem desligada**. O EncurtaLinks funciona igual sem ela, e o
código não traz nenhum ID, código ou domínio do Adsterra: tudo vem das tags da **sua** conta.

> Não há garantia de aprovação do site, de exibição de anúncios nem de receita. Confira os
> termos e políticas **vigentes** do Adsterra antes de ativar; eles podem mudar.

## O que o EncurtaLinks faz e não faz

| Faz | Não faz (nem deve ser configurado para fazer) |
|---|---|
| Exibe **banners** e **native banners** só na página intermediária `/s/:slug` | Popunder, pop-up, *social bar*, redirecionamentos ou interstitials de anúncio |
| Coloca os anúncios **abaixo** do único botão **Continuar**, identificados como "Publicidade" | Botões falsos, cliques forçados, contagem regressiva obrigatória por anúncio |
| Pede **consentimento** antes de carregar qualquer script (padrão) | Contornar bloqueadores de anúncio ou insistir após recusa |
| Usa a tag **exatamente** como o Adsterra fornece | Alterar a tag ou colocá-la em iframe próprio (os termos do Adsterra consultados durante o desenvolvimento proíbem isso sem autorização por escrito) |
| Libera na CSP apenas as origens/hashes das tags configuradas | Anúncios no painel administrativo (outro site, CSP `default-src 'none'`) |
| Recolhe espaços vazios após 8 s (provedor fora do ar) | Anúncios em testes, CI ou Deploy Previews |

Métricas: o painel do EncurtaLinks mostra **aberturas** da página intermediária e
**continuações** confirmadas pelo servidor. Impressões, cliques e receita existem **somente**
no painel do Adsterra. Um ticket consumido **não** prova que um anúncio foi exibido ou visto.

## Passo a passo para ativar

1. **Publique sem anúncios** e confira o checklist de [deploy.md](deploy.md#4-verificação-depois-do-deploy).
2. **Termos e privacidade:** no painel, em *Termos e privacidade*, revise os textos — eles já
   mencionam a publicidade com consentimento, mas preencha responsável e contato e adapte
   à sua realidade (o texto padrão não é orientação jurídica).
3. **Conta de publisher no Adsterra:** cadastre-se, adicione o site
   `https://SEU-SITE.netlify.app` e aguarde a moderação.
4. **Gere os códigos** (*Websites → Get code*) apenas dos formatos **Banner** e/ou
   **Native Banner**. Copie cada código completo, sem editar.
5. **Variáveis do site público, somente no contexto Production:**
   - `ADSTERRA_SLOT_PRIMARY_HTML` = código do primeiro espaço;
   - `ADSTERRA_SLOT_SECONDARY_HTML` = código do segundo espaço (opcional);
   - `ADS_ENABLED=true`;
   - mantenha `ADS_REQUIRE_CONSENT=true`.
   Tags com `iframe`, `form`, `meta`, `link`, `object`, `embed` ou scripts sem `https` são
   **recusadas** (o site segue no ar, sem anúncios, e registra `config_warning` nos logs).
6. **Novo deploy** do site público (variáveis só valem após o deploy).
7. **Painel → Configurações → Publicidade:** ligue o interruptor.
8. **Teste em produção** num navegador sem bloqueador: abra um link curto, clique em
   *Permitir anúncios* e veja se os anúncios aparecem. Abra o console do navegador:
   se houver erros de *Content-Security-Policy*, adicione **somente** as origens indicadas
   nas variáveis `ADS_CSP_SCRIPT_SRC`, `ADS_CSP_FRAME_SRC`, `ADS_CSP_CONNECT_SRC`,
   `ADS_CSP_IMG_SRC` ou `ADS_CSP_STYLE_SRC` (origens `https://…` separadas por espaço) e
   faça novo deploy.
9. Teste também: *Não permitir* (nenhum script carregado, acesso normal) e
   *Preferências de anúncios* (revogar).

## Desligar (interruptor de emergência)

- **Imediato, sem deploy:** painel → *Configurações* → desligue *Publicidade*. A próxima
  página carregada já sai sem anúncios e com a CSP sem as origens do provedor.
- **Definitivo:** `ADS_ENABLED=false` (ou remova as tags) e faça novo deploy.

## Garantias automatizadas

- `loadAdsConfig` recusa tags inválidas e, em testes/CI, qualquer origem que não seja o
  servidor local de anúncios simulados.
- Os testes E2E cobrem: consentimento, recusa, revogação, provedor com falha (503),
  bloqueador de anúncios, posição abaixo do botão, botão único e o interruptor.
- Deploy Previews e Branch deploys não devem ter `ADS_ENABLED` definido; fora de
  produção, sem tags, aparece apenas um espaço simulado (`ADS_DEV_PLACEHOLDER`).
