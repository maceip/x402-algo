/**
 * tenet routing hop (opaque mixnet forwarder)
 * -------------------------------------------
 * tenet always routes through the mixnet — there is no direct asker→expert
 * connection — but a routing hop is NOT a special role and is NOT the payee. Any
 * public client can forward bytes for an expert behind NAT. Its whole job here is
 * to pass opaque bytes through: it never parses the query, never parses the
 * payment voucher, and holds no x402 logic. The expert is the payee (see
 * ../expert and ../tenet-integration/SPEC.md).
 *
 * In the live network the forwarded bytes are an encrypted Sphinx payload. Here
 * we forward the HTTP request verbatim to the expert so the example runs over
 * plain HTTP; the hop still treats the body and the end-to-end x402 headers as
 * opaque.
 */

import { config } from 'dotenv';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { ALGORAND_TESTNET_CAIP2, USDC_TESTNET_ASA_ID } from '@x402/avm';

config();

const expertUrl = process.env.EXPERT_URL ?? 'http://localhost:4031';
const hopId = process.env.HOP_ID ?? 'hop-local-dev';
const port = Number(process.env.PORT ?? 4030);

const QUERY_PRICE = '$0.10';

const app = new Hono();

/**
 * Free discovery — "a tenet client queries the network for experts."
 * Advertises the flat query price; the concrete payee (the expert's address)
 * arrives in the expert's own 402 challenge, sealed end-to-end.
 */
app.get('/v1/match', c =>
  c.json({
    hop: { hop_id: hopId },
    payment: {
      ext: 'x402-tenet/v1',
      scheme: 'exact',
      network: ALGORAND_TESTNET_CAIP2,
      price: QUERY_PRICE,
      asset: USDC_TESTNET_ASA_ID,
      payee_hint: 'expert', // the expert earns the fee; settled via Obscura
    },
    experts: [{ peer_id: 'expert-local-dev', expertise: 'demo', p50_latency_ms: 480 }],
  }),
);

/**
 * Opaque forward. Copies method, headers (including the end-to-end x402 bytes it
 * cannot read) and body straight to the expert, and the response straight back.
 * Logs only the size of what it forwarded — never the contents.
 */
app.post('/v1/answer', async c => {
  const rawBody = await c.req.arrayBuffer();
  console.log(`hop event=forward hop_id=${hopId} bytes=${rawBody.byteLength} dst=${expertUrl} (opaque)`);

  const upstream = await fetch(`${expertUrl}/v1/answer`, {
    method: 'POST',
    headers: c.req.raw.headers,
    body: rawBody,
  });

  const respBody = await upstream.arrayBuffer();
  return new Response(respBody, { status: upstream.status, headers: upstream.headers });
});

serve({ fetch: app.fetch, port }, () => {
  console.log(`tenet routing hop (opaque forwarder) listening at http://localhost:${port}`);
  console.log(`  hop_id=${hopId} — not a payee, forwards opaque bytes only`);
  console.log(`  forwarding to expert at ${expertUrl}`);
});
