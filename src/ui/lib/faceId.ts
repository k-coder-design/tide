/**
 * Face ID for the app lock (T21) through a passkey: iOS asks for Face ID before the passkey answers,
 * and the WebAuthn PRF extension makes the passkey return the same secret every time — the secret
 * that unwraps the data key in the Worker. No server: the challenge is random and nothing is verified
 * remotely. Needs iOS 18 or later; the passkey is kept by iCloud Keychain like any other.
 */

type Bytes = Uint8Array<ArrayBuffer>

interface PrfResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } }
}

export class FaceIdError extends Error {
  constructor(
    message: string,
    /** The person closed the Face ID sheet — not worth an error message. */
    readonly cancelled = false
  ) {
    super(message)
    this.name = 'FaceIdError'
  }
}

let busy = false
/** True while the system Face ID sheet may be on screen: auto-lock and updates wait for it. */
export const faceIdInProgress = (): boolean => busy

const random = (length: number): Bytes => crypto.getRandomValues(new Uint8Array(length))

export const faceIdSupported = (): boolean => typeof window.PublicKeyCredential === 'function' && Boolean(navigator.credentials)

async function run<T>(action: () => Promise<T>): Promise<T> {
  busy = true
  try {
    return await action()
  } catch (error) {
    if (error instanceof FaceIdError) throw error
    if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError')) {
      throw new FaceIdError('Face ID was cancelled', true)
    }
    console.error(error)
    throw new FaceIdError('Face ID is not available right now. Use the PIN.')
  } finally {
    busy = false
  }
}

function secretOf(credential: Credential | null): Bytes | null {
  const results = (credential as PublicKeyCredential | null)?.getClientExtensionResults() as PrfResults | undefined
  const first = results?.prf?.results?.first
  return first ? new Uint8Array(first.slice(0)) : null
}

/** Asks Face ID through the saved passkey and returns its secret. */
export function faceIdSecret(credentialId: Bytes, prfSalt: Bytes): Promise<Bytes> {
  return run(async () => {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: random(32),
        allowCredentials: [{ type: 'public-key', id: credentialId }],
        userVerification: 'required',
        timeout: 60_000,
        extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs
      }
    })
    const secret = secretOf(credential)
    if (!secret) throw new FaceIdError('Face ID did not return a key. Use the PIN.')
    return secret
  })
}

/** Creates the passkey for Tide (one Face ID, sometimes two) and returns what the Worker needs to wrap the key. */
export function createFaceIdKey(): Promise<{ credentialId: Bytes; prfSalt: Bytes; secret: Bytes }> {
  return run(async () => {
    if (!faceIdSupported()) throw new FaceIdError('Face ID for Tide needs iOS 18 or later.')
    const prfSalt = random(32)
    const credential = (await navigator.credentials.create({
      publicKey: {
        rp: { name: 'Tide' },
        user: { id: random(16), name: 'Tide', displayName: 'Tide' },
        challenge: random(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 }
        ],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
        timeout: 60_000,
        extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs
      }
    })) as PublicKeyCredential | null
    if (!credential) throw new FaceIdError('Face ID was cancelled', true)
    const credentialId = new Uint8Array(credential.rawId.slice(0))
    const prf = (credential.getClientExtensionResults() as PrfResults).prf
    if (!prf || prf.enabled === false) throw new FaceIdError('Face ID for Tide needs iOS 18 or later.')
    // Some versions return the secret only when the passkey is used, not when it is made.
    let secret = secretOf(credential)
    if (!secret) {
      busy = false
      secret = await faceIdSecret(credentialId, prfSalt)
      busy = true
    }
    return { credentialId, prfSalt, secret }
  })
}
