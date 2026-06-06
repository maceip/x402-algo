/**
 * tenet x402 Client (custodial / sponsored asker)
 * -----------------------------------------------
 * A tenet asker: it queries the network for an expert, then routes a query
 * through the mixnet. With x402 the query costs 0.10 USDC, earned by the
 * **expert** that answers — settled privately via the Obscura shielded pool so
 * the payout cannot be linked back to this asker (see ../tenet-integration).
 *
 * Custodial + sponsored launch model:
 *   - Custodial: this client signs with a managed wallet (AVM_MNEMONIC held by
 *     the tenet service on the asker's behalf). End users do not manage keys.
 *   - Sponsored: the operator funds the query credit (USDC) and the facilitator
 *     (../facilitator) covers ALGO fees, so askers need no funds at launch.
 *
 * The client talks to a routing hop, which forwards opaquely to the expert; the
 * 402 challenge and the signed voucher travel end-to-end between this client and
 * the expert, exactly as they would be sealed inside the tenet envelope.
 */

import { config } from 'dotenv';
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from '@x402/fetch';
import { toClientAvmSigner } from '@x402/avm';
import { ExactAvmScheme } from '@x402/avm/exact/client';
import {
  ed25519SigningKeyFromWrappedSecret,
  type WrappedEd25519Seed,
} from '@algorandfoundation/algokit-utils/crypto';
import { seedFromMnemonic } from '@algorandfoundation/algokit-utils/algo25';

config();

// Custodial wallet the tenet service operates on the asker's behalf.
const avmMnemonic = process.env.AVM_MNEMONIC;
const hopUrl = process.env.HOP_URL ?? process.env.RELAY_URL ?? 'http://localhost:4030';
const prompt = process.env.PROMPT ?? 'In one sentence, name one Monet painting technique.';

if (!avmMnemonic) {
  throw new Error('Missing AVM_MNEMONIC (custodial signing wallet) in your .env file.');
}

async function main(): Promise<void> {
  // 1. Discover an expert and the flat query price (free).
  const matchRes = await fetch(`${hopUrl}/v1/match`);
  const match = await matchRes.json();
  const expert = match.experts?.[0];
  console.log(
    `🔎 discovered expert peer_id=${expert?.peer_id} via hop=${match.hop?.hop_id} ` +
      `price=${match.payment?.price} payee=${match.payment?.payee_hint}`,
  );

  // 2. Build the custodial signer.
  const secretKey = await getSecretKeyFromMnemonic(avmMnemonic!);
  const avmSigner = toClientAvmSigner(secretKey);
  console.info(`💼 custodial signer: ${avmSigner.address}`);

  const client = new x402Client().register('algorand:*', new ExactAvmScheme(avmSigner));

  // 3. Route the query through the mixnet hop, authorizing 0.10 USDC.
  //    The voucher is verified by the expert; production settlement is an
  //    Obscura withdrawal to the expert, not a direct transfer from this asker.
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  const response = await fetchWithPayment(`${hopUrl}/v1/answer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ peer_id: expert?.peer_id, query: prompt }),
  });

  if (!response.ok) {
    console.log(`\n❌ no payment settled (status ${response.status})`);
    console.log(await response.text());
    process.exit(1);
  }

  const settle = new x402HTTPClient(client).getPaymentSettleResponse(name =>
    response.headers.get(name),
  );
  if (settle) {
    console.log('\n💳 query authorized (expert payee):', JSON.stringify(settle, null, 2));
  }

  const answer = await response.json();
  console.log('\n✅ answer:', JSON.stringify(answer, null, 2));
}

// Base64-encoded signing key for @x402/avm: 32-byte seed + 32-byte public key.
async function getSecretKeyFromMnemonic(mnemonic: string): Promise<string> {
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

main().catch(error => {
  console.error(error?.response?.data?.error ?? error);
  process.exit(1);
});
