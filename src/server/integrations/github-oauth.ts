import * as oauth from 'oauth4webapi';
import { z } from 'zod';

/**
 * Login administrativo com OAuth 2.0 do GitHub (Authorization Code + PKCE),
 * implementado com a biblioteca `oauth4webapi` — sem protocolo próprio.
 *
 * O token de acesso do GitHub é usado uma única vez para ler o perfil
 * (id, login e se a conta tem 2FA) e é descartado; nunca é armazenado.
 * A autorização é feita pelo ID numérico (imutável), não pelo login.
 */

export const GITHUB_AS: oauth.AuthorizationServer = {
  // Metadados oficiais: https://github.com/.well-known/oauth-authorization-server/login/oauth
  issuer: 'https://github.com/login/oauth',
  authorization_response_iss_parameter_supported: true,
  authorization_endpoint: 'https://github.com/login/oauth/authorize',
  token_endpoint: 'https://github.com/login/oauth/access_token',
};

export interface GitHubOAuthSettings {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}

export async function createAuthorizationRequest(settings: GitHubOAuthSettings): Promise<{ url: URL; state: string; codeVerifier: string }> {
  const state = oauth.generateRandomState();
  const codeVerifier = oauth.generateRandomCodeVerifier();
  const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
  const url = new URL(GITHUB_AS.authorization_endpoint ?? '');
  url.searchParams.set('client_id', settings.clientId);
  url.searchParams.set('redirect_uri', settings.redirectUri);
  // read:user é necessário para ler "two_factor_authentication" no perfil privado.
  url.searchParams.set('scope', 'read:user');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('allow_signup', 'false');
  return { url, state, codeVerifier };
}

const userSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1).max(100),
  two_factor_authentication: z.boolean().optional(),
});

export interface GitHubIdentity {
  id: number;
  login: string;
  twoFactorAuthentication: boolean | null;
}

export class OAuthCallbackError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = 'OAuthCallbackError';
    this.code = code;
  }
}

export async function completeAuthorization(
  settings: GitHubOAuthSettings,
  callbackUrl: URL,
  expectedState: string,
  codeVerifier: string,
): Promise<GitHubIdentity> {
  const client: oauth.Client = { client_id: settings.clientId };
  const clientAuth = oauth.ClientSecretPost(settings.clientSecret);
  const fetchOptions = settings.fetchImpl ? { [oauth.customFetch]: settings.fetchImpl } : {};

  let params: URLSearchParams;
  try {
    params = oauth.validateAuthResponse(GITHUB_AS, client, callbackUrl.searchParams, expectedState);
  } catch {
    throw new OAuthCallbackError('invalid_callback');
  }

  let accessToken: string;
  try {
    const response = await oauth.authorizationCodeGrantRequest(GITHUB_AS, client, clientAuth, params, settings.redirectUri, codeVerifier, {
      ...fetchOptions,
      signal: AbortSignal.timeout(8000),
    });
    const result = await oauth.processAuthorizationCodeResponse(GITHUB_AS, client, response);
    accessToken = result.access_token;
  } catch {
    throw new OAuthCallbackError('token_exchange_failed');
  }

  const fetchImpl = settings.fetchImpl ?? fetch;
  let user: z.infer<typeof userSchema>;
  try {
    const response = await fetchImpl('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'EncurtaLinks-Admin',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('status');
    user = userSchema.parse(await response.json());
  } catch {
    throw new OAuthCallbackError('profile_failed');
  }
  return { id: user.id, login: user.login, twoFactorAuthentication: user.two_factor_authentication ?? null };
}
