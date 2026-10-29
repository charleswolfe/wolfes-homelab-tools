// JWT (RFC 7519) decoding. Never verifies signatures: it only reads the token.
import { base64ToBytes, utf8OrNull } from './base64.js';

function decodeSegment(segment, name) {
  let bytes;
  try {
    bytes = base64ToBytes(segment);
  } catch (err) {
    throw new Error(`${name} is not valid Base64URL: ${err.message}`);
  }
  const text = utf8OrNull(bytes);
  if (text === null) throw new Error(`${name} is not UTF-8 text.`);
  return text;
}

export function decodeJwt(input) {
  const token = input.trim().replace(/^bearer\s+/i, '');
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 && parts.length !== 5) {
    throw new Error(`A JWT has 3 dot-separated parts (signed) or 5 (encrypted); this has ${parts.length}.`);
  }
  const headerText = decodeSegment(parts[0], 'Header');
  let header;
  try {
    header = JSON.parse(headerText);
  } catch {
    throw new Error('Header is not valid JSON.');
  }

  const result = { parts, header, kind: parts.length === 5 ? 'JWE' : 'JWS', warnings: [] };
  if (result.kind === 'JWE') {
    result.warnings.push('This is an encrypted token (JWE). Only the header can be read without the decryption key.');
    return result;
  }

  const payloadText = decodeSegment(parts[1], 'Payload');
  try {
    result.payload = JSON.parse(payloadText);
  } catch {
    result.payloadText = payloadText; // JWS payloads need not be JSON
  }
  try {
    result.signature = base64ToBytes(parts[2]);
  } catch {
    throw new Error('Signature is not valid Base64URL.');
  }

  const alg = String(header.alg ?? '');
  if (alg.toLowerCase() === 'none') result.warnings.push('alg is “none”: this token is unsigned and must not be trusted.');
  if (!alg) result.warnings.push('Header has no “alg” parameter.');
  if (result.payload && typeof result.payload === 'object' && !('exp' in result.payload)) {
    result.warnings.push('No “exp” claim: this token never expires.');
  }
  return result;
}

export const CLAIMS = {
  iss: 'Issuer', sub: 'Subject', aud: 'Audience', exp: 'Expires', nbf: 'Not before', iat: 'Issued at',
  jti: 'JWT ID', auth_time: 'Authenticated at', nonce: 'Nonce', azp: 'Authorized party', scope: 'Scope',
  sid: 'Session ID', name: 'Name', email: 'Email', email_verified: 'Email verified', updated_at: 'Updated at',
  preferred_username: 'Username', roles: 'Roles', groups: 'Groups', client_id: 'Client ID', typ: 'Type', tid: 'Tenant ID',
};
export const TIME_CLAIMS = new Set(['exp', 'nbf', 'iat', 'auth_time', 'updated_at']);

export const HEADER_PARAMS = {
  alg: 'Algorithm', typ: 'Type', kid: 'Key ID', cty: 'Content type', jku: 'JWK set URL',
  x5u: 'X.509 URL', x5t: 'X.509 thumbprint', enc: 'Encryption', zip: 'Compression',
};

export const ALG_NAMES = {
  HS256: 'HMAC + SHA-256', HS384: 'HMAC + SHA-384', HS512: 'HMAC + SHA-512',
  RS256: 'RSA PKCS#1 v1.5 + SHA-256', RS384: 'RSA PKCS#1 v1.5 + SHA-384', RS512: 'RSA PKCS#1 v1.5 + SHA-512',
  PS256: 'RSA-PSS + SHA-256', PS384: 'RSA-PSS + SHA-384', PS512: 'RSA-PSS + SHA-512',
  ES256: 'ECDSA P-256 + SHA-256', ES384: 'ECDSA P-384 + SHA-384', ES512: 'ECDSA P-521 + SHA-512',
  EdDSA: 'Edwards-curve (Ed25519/Ed448)', none: 'Unsigned',
};

// Overall validity from exp / nbf at `nowSec`.
export function tokenStatus(payload, nowSec = Date.now() / 1000) {
  if (!payload || typeof payload !== 'object') return { state: 'unknown' };
  const { exp, nbf } = payload;
  if (typeof nbf === 'number' && nbf > nowSec) return { state: 'pending', at: nbf };
  if (typeof exp === 'number') return exp <= nowSec ? { state: 'expired', at: exp } : { state: 'valid', at: exp };
  return { state: 'no-expiry' };
}
