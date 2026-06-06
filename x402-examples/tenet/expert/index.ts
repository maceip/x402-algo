/**
 * tenet x402 Expert Node
 * ----------------------
 * The expert is the only node that decrypts the query envelope, so it is the
 * payment enforcement point — and, per the protocol, the **payee**: each query
 * earns the expert 0.10 USDC.
 *
 * This file demonstrates the x402 *request-time authorization* layer: the expert
 * verifies the payment voucher carried (encrypted) inside the query envelope and
 * only then answers. The relay (../relay) forwards opaque bytes and never sees
 * any of this.
 *
 * SETTLEMENT IS DIFFERENT FROM STOCK x402. A direct on-chain `asker → expert`
 * transfer would re-link the asker and expert and defeat the mixnet. In
 * production the 0.10 USDC is settled through the Obscura shielded pool as an
 * unlinkable withdrawal to this expert's address — see
 * ../tenet-integration/SPEC.md and ../tenet-integration/OBSCURA-USDC.md. The
 * `payTo` below models the expert as payee for the local/standalone demo.
 */

import { config } from 'dotenv';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { paymentMiddleware } from '@x402/hono';
import { x402ResourceServer, HTTPFacilitatorClient } from '@x402/core/server';
import { ExactAvmScheme } from '@x402/avm/exact/server';
import { ALGORAND_TESTNET_CAIP2, USDC_TESTNET_ASA_ID } from '@x402/avm';

config();

// The expert's own Algorand address — the payee. In production the payout is an
// Obscura withdrawal to this address, not a direct transfer from the asker.
const expertAddress = process.env.EXPERT_AVM_ADDRESS;
const facilitatorUrl = process.env.FACILITATOR_URL;
const peerId = process.env.EXPERT_PEER_ID ?? 'expert-local-dev';
const port = Number(process.env.PORT ?? 4031);

if (!expertAddress || !facilitatorUrl) {
  console.error('Missing environment variables: EXPERT_AVM_ADDRESS or FACILITATOR_URL');
  process.exit(1);
}

// Flat price of one expert query.
const QUERY_PRICE = '$0.10';

const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
const server = new x402ResourceServer(facilitatorClient);
server.register(ALGORAND_TESTNET_CAIP2, new ExactAvmScheme());

const app = new Hono();

app.use(
  paymentMiddleware(
    {
      'POST /v1/answer': {
        accepts: [
          {
            scheme: 'exact',
            price: QUERY_PRICE,
            network: ALGORAND_TESTNET_CAIP2,
            // The expert earns the query fee.
            payTo: expertAddress,
            extra: { asset: USDC_TESTNET_ASA_ID },
          },
        ],
        description: 'Answer one routed tenet expert query',
        mimeType: 'application/json',
      },
    },
    server,
  ),
);

/**
 * Protected resource: the expert answers the (now-decrypted) query. Reached only
 * after the embedded x402 voucher verifies.
 */
app.post('/v1/answer', async c => {
  const body = await c.req.json().catch(() => ({}));
  const prompt = String(body.query ?? body.prompt ?? '');

  console.log(`expert event=answer peer_id=${peerId} chars=${prompt.length} earns=${QUERY_PRICE}`);

  // Stub: a real expert combines local corpus context with a frontier model and
  // streams the reply back over the mixnet return path.
  return c.json({ peer_id: peerId, answer: `[${peerId}] answer to: ${prompt}` });
});

app.get('/v1/status', c => c.json({ peer_id: peerId, price: QUERY_PRICE, ok: true }));

serve({ fetch: app.fetch, port }, () => {
  console.log(`tenet x402 expert node listening at http://localhost:${port}`);
  console.log(`  peer_id=${peerId}`);
  console.log(`  earns ${QUERY_PRICE} per query, payTo (expert)=${expertAddress}`);
  console.log(`  production settlement: Obscura withdrawal (see tenet-integration/SPEC.md)`);
});
