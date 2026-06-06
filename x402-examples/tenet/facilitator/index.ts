/**
 * tenet x402 Sponsored Facilitator
 * --------------------------------
 * Verifies and settles the 0.10 USDC query payments on Algorand TestNet. This is
 * the "sponsor all costs at launch" piece: the facilitator account submits the
 * settlement transaction and covers the ALGO network fee, so neither the asker
 * nor the relay needs ALGO to move USDC.
 *
 * It is the standard x402 facilitator (verify / settle / supported). The
 * sponsorship is operational: fund AVM_MNEMONIC's account with ALGO and run this
 * as the FACILITATOR_URL for the expert and (optionally) the client.
 */

import express from 'express';
import { config } from 'dotenv';
import { x402Facilitator } from '@x402/core/facilitator';
import {
  type PaymentPayload,
  type PaymentRequirements,
  type SettleResponse,
  type VerifyResponse,
} from '@x402/core/types';
import { toFacilitatorAvmSigner, ALGORAND_TESTNET_CAIP2 } from '@x402/avm';
import { ExactAvmScheme } from '@x402/avm/exact/facilitator';
import { seedFromMnemonic } from '@algorandfoundation/algokit-utils/algo25';
import {
  ed25519SigningKeyFromWrappedSecret,
  type WrappedEd25519Seed,
} from '@algorandfoundation/algokit-utils/crypto';

config();

const PORT = process.env.PORT || '4022';

if (!process.env.AVM_MNEMONIC) {
  console.error('❌ AVM_MNEMONIC environment variable is required (sponsoring account)');
  process.exit(1);
}

const secretKey = await getSecretKeyFromMnemonic(process.env.AVM_MNEMONIC as string);
const avmSigner = toFacilitatorAvmSigner(secretKey);
console.info(`Sponsoring facilitator account: ${avmSigner.getAddresses()[0]}`);

const facilitator = new x402Facilitator()
  .onAfterSettle(async context => {
    console.log('settled — fee sponsored by facilitator', context);
  })
  .onSettleFailure(async context => {
    console.log('settle failure', context);
  });

facilitator.register(ALGORAND_TESTNET_CAIP2, new ExactAvmScheme(avmSigner));

const app = express();
app.use(express.json());

app.post('/verify', async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: 'Missing paymentPayload or paymentRequirements' });
    }
    const response: VerifyResponse = await facilitator.verify(paymentPayload, paymentRequirements);
    res.json(response);
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.post('/settle', async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body;
    if (!paymentPayload || !paymentRequirements) {
      return res.status(400).json({ error: 'Missing paymentPayload or paymentRequirements' });
    }
    const response: SettleResponse = await facilitator.settle(
      paymentPayload as PaymentPayload,
      paymentRequirements as PaymentRequirements,
    );
    res.json(response);
  } catch (error) {
    console.error('Settle error:', error);
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.get('/supported', async (_req, res) => {
  try {
    res.json(facilitator.getSupported());
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

app.listen(parseInt(PORT), () => {
  console.log(`🚀 Sponsored facilitator listening on http://localhost:${PORT}`);
});

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
