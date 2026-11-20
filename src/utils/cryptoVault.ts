/**
 * Client-side Web Crypto AES-GCM key vault for optional persistent AI provider keys.
 * Uses a user-supplied passphrase derived via PBKDF2-SHA256 with random salt & IV.
 * Never uses any hardcoded encryption key.
 */

const VAULT_STORAGE_KEY = 'cryptolens_ai_vault_v1';
const SESSION_KEY_PREFIX = 'cryptolens_ai_session_';

interface EncryptedEntry {
  saltB64: string;
  ivB64: string;
  cipherB64: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 120_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export function setSessionApiKey(profileId: string, apiKey: string): void {
  sessionStorage.setItem(`${SESSION_KEY_PREFIX}${profileId}`, apiKey);
}

export function getSessionApiKey(profileId: string): string {
  return sessionStorage.getItem(`${SESSION_KEY_PREFIX}${profileId}`) || '';
}

export function clearSessionApiKey(profileId: string): void {
  sessionStorage.removeItem(`${SESSION_KEY_PREFIX}${profileId}`);
}

export async function saveEncryptedApiKey(
  profileId: string,
  apiKey: string,
  passphrase: string,
): Promise<void> {
  if (!passphrase || passphrase.length < 6) {
    throw new Error('Passphrase must be at least 6 characters.');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const encoded = new TextEncoder().encode(apiKey);
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);

  const raw = localStorage.getItem(VAULT_STORAGE_KEY);
  const vault: Record<string, EncryptedEntry> = raw ? JSON.parse(raw) : {};
  vault[profileId] = {
    saltB64: toBase64(salt),
    ivB64: toBase64(iv),
    cipherB64: toBase64(new Uint8Array(cipherBuf)),
  };
  localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(vault));
  setSessionApiKey(profileId, apiKey);
}

export async function unlockEncryptedApiKey(
  profileId: string,
  passphrase: string,
): Promise<string> {
  const raw = localStorage.getItem(VAULT_STORAGE_KEY);
  if (!raw) throw new Error('No encrypted key stored for this profile.');
  const vault: Record<string, EncryptedEntry> = JSON.parse(raw);
  const entry = vault[profileId];
  if (!entry) throw new Error('No encrypted key found for this profile.');

  const salt = fromBase64(entry.saltB64);
  const iv = fromBase64(entry.ivB64);
  const cipher = fromBase64(entry.cipherB64);
  const key = await deriveKey(passphrase, salt);

  try {
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      cipher as BufferSource,
    );
    const apiKey = new TextDecoder().decode(plainBuf);
    setSessionApiKey(profileId, apiKey);
    return apiKey;
  } catch {
    throw new Error('Incorrect passphrase. Unable to decrypt API key.');
  }
}

export function hasEncryptedApiKey(profileId: string): boolean {
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return false;
    const vault = JSON.parse(raw) as Record<string, EncryptedEntry>;
    return Boolean(vault[profileId]);
  } catch {
    return false;
  }
}

export function removeStoredApiKey(profileId: string): void {
  clearSessionApiKey(profileId);
  try {
    const raw = localStorage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return;
    const vault = JSON.parse(raw) as Record<string, EncryptedEntry>;
    delete vault[profileId];
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(vault));
  } catch {
    // ignore
  }
}
