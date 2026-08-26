import type { ProviderId } from '@nutai/prompt'

/**
 * API credentials.
 *
 * WHERE KEYS LIVE, and the rules that are not negotiable:
 *
 *   Keychain / Keystore via expo-secure-store, ONE ENTRY PER PROVIDER — never one
 *   combined JSON blob, so a corrupt or revoked key for one provider cannot take
 *   the others with it.
 *
 *   Written ONLY from runtime user input. Never from EXPO_PUBLIC_*, app.config,
 *   .env, or EAS secrets — anything in those ships inside the bundle and is
 *   readable by anyone who downloads the app.
 *
 *   Read at exactly ONE place (the Path A request builder) and sent to exactly
 *   one destination: the provider the user named.
 *
 * The biometric gate is on REVEAL/EDIT in settings only, never on read-for-scan.
 * Putting Face ID in front of every meal photo is how a privacy feature becomes
 * the reason someone stops logging.
 */

export type CredentialKind = 'api_key' | 'oauth'

export interface StoredCredential {
  kind: CredentialKind
  value: string
}

const memoryStore = new Map<string, string>()

async function getSecureItem(key: string): Promise<string | null> {
  try {
    const mod = await import('expo-secure-store')
    const val = await mod.getItemAsync(key)
    return val
  } catch {
    return memoryStore.get(key) ?? null
  }
}

async function setSecureItem(key: string, value: string): Promise<void> {
  try {
    const mod = await import('expo-secure-store')
    await mod.setItemAsync(key, value, {
      keychainAccessible: mod.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    })
  } catch {
    memoryStore.set(key, value)
  }
}

async function deleteSecureItem(key: string): Promise<void> {
  try {
    const mod = await import('expo-secure-store')
    await mod.deleteItemAsync(key)
  } catch {
    memoryStore.delete(key)
  }
}

const keyFor = (p: ProviderId) => `key.${p}`
const kindFor = (p: ProviderId) => `kind.${p}`

export async function saveCredential(
  provider: ProviderId,
  cred: StoredCredential,
): Promise<void> {
  await setSecureItem(keyFor(provider), cred.value)
  await setSecureItem(kindFor(provider), cred.kind)
}

export async function loadCredential(provider: ProviderId): Promise<StoredCredential | null> {
  const value = await getSecureItem(keyFor(provider))
  if (!value) return null
  const kind = (await getSecureItem(kindFor(provider))) as CredentialKind | null
  return { kind: kind ?? 'api_key', value }
}

export async function clearCredential(provider: ProviderId): Promise<void> {
  await deleteSecureItem(keyFor(provider))
  await deleteSecureItem(kindFor(provider))
}

/** `sk-ant-…a8f2` — never the whole thing, not even to its owner by default. */
export function maskCredential(value: string): string {
  if (value.length <= 12) return '••••'
  return `${value.slice(0, 7)}…${value.slice(-4)}`
}

/**
 * Is this worth spending a network round trip on?
 *
 * LENGTH ONLY, deliberately. An earlier version required an `sk-ant-` prefix for
 * Anthropic, which meant pasting a valid `claude setup-token` credential into the
 * API-key tab left the Verify button greyed out with no explanation — the user
 * had a working credential and no way to submit it.
 *
 * Prefixes also change without notice, and the provider is the authority on
 * whether a credential is real. Guessing here can only produce false negatives we
 * never learn about; the probe produces a true answer either way.
 */
export function looksPlausible(_provider: ProviderId, _kind: CredentialKind, value: string): boolean {
  return value.trim().length >= 20
}
