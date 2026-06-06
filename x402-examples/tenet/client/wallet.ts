/**
 * Dual-mode wallet for tenet askers.
 *
 *  - "managed": the operator runs a custodial wallet on behalf of a user who has
 *    no wallet of their own. The operator signs and funds everything.
 *  - "self": the user has their own wallet and signs with their own key.
 *
 * The signer is the same x402 AVM signer in both cases; only the key source
 * differs. Which one actually pays a given query is decided by the sponsorship
 * policy (see sponsorship in index.ts), not here.
 */

import { toClientAvmSigner } from '@x402/avm';
import {
  ed25519SigningKeyFromWrappedSecret,
  type WrappedEd25519Seed,
} from '@algorandfoundation/algokit-utils/crypto';
import { seedFromMnemonic } from '@algorandfoundation/algokit-utils/algo25';

export type WalletMode = 'managed' | 'self';

export interface TenetWallet {
  mode: WalletMode;
  address: string;
  signer: ReturnType<typeof toClientAvmSigner>;
}

/**
 * Operator-custodial wallet for a user without their own wallet.
 *
 * For the demo this is the operator's signing key. In production the operator
 * derives a segregated per-user custodial account (e.g. a KDF over a master
 * seed + userId) so balances and policy are tracked per user — wire that here.
 */
export async function managedWallet(
  operatorMnemonic: string,
  _userId: string,
): Promise<TenetWallet> {
  const signer = toClientAvmSigner(await secretKeyFromMnemonic(operatorMnemonic));
  return { mode: 'managed', address: signer.address, signer };
}

/** Self-custody wallet from the user's own mnemonic. */
export async function selfWallet(userMnemonic: string): Promise<TenetWallet> {
  const signer = toClientAvmSigner(await secretKeyFromMnemonic(userMnemonic));
  return { mode: 'self', address: signer.address, signer };
}

// Base64-encoded signing key for @x402/avm: 32-byte seed + 32-byte public key.
async function secretKeyFromMnemonic(mnemonic: string): Promise<string> {
  const seed = seedFromMnemonic(mnemonic);
  const seedCopy = new Uint8Array(seed);
  const wrappedSeed: WrappedEd25519Seed = {
    unwrapEd25519Seed: async () => seed,
    wrapEd25519Seed: async () => {},
  };
  const wrappedSecret = await ed25519SigningKeyFromWrappedSecret(wrappedSeed);
  return Buffer.concat([
    Buffer.from(seedCopy),
    Buffer.from(wrappedSecret.ed25519Pubkey),
  ]).toString('base64');
}
