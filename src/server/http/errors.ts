/** Erro HTTP com mensagem segura para o cliente (sem detalhes internos). */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSeconds: number | undefined;
  readonly headers: Record<string, string>;

  constructor(status: number, code: string, message: string, options: { retryAfterSeconds?: number; headers?: Record<string, string> } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.headers = options.headers ?? {};
  }
}

export const Errors = {
  methodNotAllowed: (allow: string[]) =>
    new HttpError(405, 'method_not_allowed', 'Método não permitido.', { headers: { Allow: allow.join(', ') } }),
  unsupportedMediaType: (expected: string) =>
    new HttpError(415, 'unsupported_media_type', `Envie o corpo como ${expected}.`),
  payloadTooLarge: () => new HttpError(413, 'payload_too_large', 'O corpo da requisição é grande demais.'),
  badRequest: (message = 'Requisição inválida.', code = 'bad_request') => new HttpError(400, code, message),
  forbidden: (message = 'Acesso negado.', code = 'forbidden') => new HttpError(403, code, message),
  unauthorized: () => new HttpError(401, 'unauthorized', 'Faça login para continuar.'),
  notFound: (message = 'Não encontrado.') => new HttpError(404, 'not_found', message),
  conflict: (message: string, code = 'conflict') => new HttpError(409, code, message),
  rateLimited: (retryAfterSeconds: number) =>
    new HttpError(429, 'rate_limited', `Muitas tentativas. Tente novamente em ${retryAfterSeconds} segundo(s).`, {
      retryAfterSeconds,
      headers: { 'Retry-After': String(retryAfterSeconds) },
    }),
  unavailable: (message = 'Serviço temporariamente indisponível. Tente novamente em instantes.', code = 'unavailable') =>
    new HttpError(503, code, message, { headers: { 'Retry-After': '30' } }),
};
