-- EncurtaLinks — dados padrão (idempotentes).

INSERT INTO app.app_settings (key, value, updated_by) VALUES
  ('link_creation_enabled', 'true'::jsonb, 'migration'),
  -- Publicidade desligada por padrão. Só ligue após a aprovação do Adsterra
  -- e da configuração das tags (veja docs/adsterra.md).
  ('ads_enabled', 'false'::jsonb, 'migration'),
  ('reports_enabled', 'true'::jsonb, 'migration')
ON CONFLICT (key) DO NOTHING;

-- Encurtadores de terceiros: bloqueados por padrão para impedir cadeias de
-- redirecionamento que escondem o destino real. O administrador pode remover.
INSERT INTO app.blocked_domains (domain, reason, created_by) VALUES
  ('bit.ly', 'Encurtador de terceiros (evita cadeias que escondem o destino)', 'migration'),
  ('tinyurl.com', 'Encurtador de terceiros (evita cadeias que escondem o destino)', 'migration'),
  ('is.gd', 'Encurtador de terceiros (evita cadeias que escondem o destino)', 'migration'),
  ('v.gd', 'Encurtador de terceiros (evita cadeias que escondem o destino)', 'migration'),
  ('cutt.ly', 'Encurtador de terceiros (evita cadeias que escondem o destino)', 'migration'),
  ('ow.ly', 'Encurtador de terceiros (evita cadeias que escondem o destino)', 'migration'),
  ('rebrand.ly', 'Encurtador de terceiros (evita cadeias que escondem o destino)', 'migration'),
  ('shorturl.at', 'Encurtador de terceiros (evita cadeias que escondem o destino)', 'migration'),
  ('tiny.cc', 'Encurtador de terceiros (evita cadeias que escondem o destino)', 'migration'),
  ('rb.gy', 'Encurtador de terceiros (evita cadeias que escondem o destino)', 'migration'),
  ('s.id', 'Encurtador de terceiros (evita cadeias que escondem o destino)', 'migration'),
  ('t.ly', 'Encurtador de terceiros (evita cadeias que escondem o destino)', 'migration'),
  ('adf.ly', 'Encurtador com publicidade de terceiros', 'migration'),
  ('shorte.st', 'Encurtador com publicidade de terceiros', 'migration'),
  ('ouo.io', 'Encurtador com publicidade de terceiros', 'migration'),
  ('linkvertise.com', 'Encurtador com publicidade de terceiros', 'migration')
ON CONFLICT (domain) DO NOTHING;

INSERT INTO app.legal_documents (kind, title, body, updated_by) VALUES
(
  'terms',
  'Termos de uso',
  $terms$# Aviso importante
Este texto é um modelo inicial e precisa ser revisado pelo responsável pelo serviço, de preferência com orientação jurídica, antes da publicação. Ele não garante conformidade legal.

# Quem oferece o serviço
O EncurtaLinks é oferecido por [PREENCHER: nome ou razão social], contato: [PREENCHER: e-mail de contato].

# O que o serviço faz
- Gera um endereço curto que leva o visitante a uma página intermediária antes do destino informado.
- A página intermediária mostra o domínio de destino e pode exibir publicidade claramente identificada.
- O serviço é gratuito para quem cria os links. Toda receita de publicidade pertence ao responsável pelo serviço; não há pagamento, comissão ou carteira para usuários.

# Uso proibido
- Phishing, golpes, fraudes, malware, downloads enganosos ou qualquer conteúdo ilegal.
- Spam, envio em massa não solicitado ou tentativas de burlar filtros.
- Encadear encurtadores para esconder o destino real.
- Automatizar a criação de links ou contornar limites de uso.

# Moderação
- Links podem ser bloqueados ou excluídos a qualquer momento em caso de denúncia, abuso ou violação destes termos.
- O destino de um link não pode ser alterado depois da criação.
- O EncurtaLinks não verifica o conteúdo dos sites de destino, que pode mudar a qualquer momento.

# Disponibilidade
- O serviço é oferecido sem garantia de disponibilidade contínua e pode ter limites de uso, interrupções ou ser encerrado.
- Links podem expirar no prazo escolhido na criação.

# Denúncias
Use a página "Denunciar link" para relatar abusos.$terms$,
  'migration'
),
(
  'privacy',
  'Política de privacidade',
  $privacy$# Aviso importante
Este texto é um modelo inicial e precisa ser revisado pelo responsável pelo serviço, de preferência com orientação jurídica, antes da publicação. Ele não garante conformidade com a LGPD ou outras leis.

# Responsável pelo tratamento
[PREENCHER: nome ou razão social], contato: [PREENCHER: e-mail do encarregado ou responsável].

# Dados tratados
- Endereço de destino informado ao criar um link e o domínio correspondente.
- Data de criação e de expiração do link.
- Um identificador pseudonimizado derivado do endereço IP (HMAC com chave secreta), usado para limitar abusos. O IP bruto não é armazenado no banco da aplicação. Pseudonimização não é anonimização.
- Em denúncias: motivo, descrição e, se você informar, um e-mail de contato.
- Contagens agregadas por dia (aberturas da página intermediária e continuações). Uma abertura não representa uma pessoa única.

# Finalidades
- Prestar o serviço de encurtamento e redirecionamento.
- Prevenir abuso, fraude e automação (inclusive com o Cloudflare Turnstile nos formulários).
- Atender denúncias e moderar conteúdo.

# Retenção
- Identificadores pseudonimizados de IP: removidos após 30 dias.
- Contadores de limite de uso: removidos após o fim da janela de contagem.
- E-mail informado em denúncias: removido 180 dias após a resolução.
- Destino de links expirados: removido 180 dias após a expiração; o código curto não é reutilizado.

# Publicidade
- A página intermediária pode exibir anúncios do Adsterra somente após o seu consentimento, quando exigido.
- Recusar a publicidade não impede o acesso ao destino.
- Você pode alterar a escolha a qualquer momento em "Preferências de anúncios".
- O provedor de anúncios pode tratar dados conforme a política dele: https://adsterra.com/privacy-policy-managed/

# Provedores
- Hospedagem e funções: Netlify.
- Banco de dados: [PREENCHER: provedor PostgreSQL utilizado].
- Proteção contra automação: Cloudflare Turnstile.

# Seus direitos
Para exercer direitos de titular (acesso, correção, eliminação e outros), entre em contato pelo e-mail indicado acima.$privacy$,
  'migration'
)
ON CONFLICT (kind) DO NOTHING;
