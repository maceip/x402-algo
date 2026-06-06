/**
 * tenet x402 Client — dual custody + tiered sponsorship
 * -----------------------------------------------------
 * A tenet asker. Every query costs a flat 0.10 USDC, earned by the expert that
 * answers. How that 0.10 (and the ALGO network fee) is funded depends on the
 * user:
 *
 *   - No wallet  -> MANAGED CUSTODIAL: the operator runs a wallet for the user
 *     and funds everything. Always sponsored.
 *   - Has wallet -> SELF-CUSTODY: the operator sponsors the user's network fee
 *     + 0.10 USDC app fee for the FIRST 5 queries. From the 6th query on, the
 *     user "sends their own ticket" — they pay from their own wallet.
 *
 * The per-user sponsorship counter is kept by the operator (the facilitator
 * service, GET /sponsorship and POST /sponsorship/consume).
 */

import { config } from 'dotenv';
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from '@x402/fetch';
import { ExactAvmScheme } from '@x402/avm/exact/client';
import { managedWallet, selfWallet, type TenetWallet } from './wallet.js';

config();

const userId = process.env.USER_ID ?? 'user-demo';
const userMnemonic = process.env.AVM_MNEMONIC; // present => the user has their own wallet
const operatorMnemonic = process.env.OPERATOR_MNEMONIC; // operator's sponsoring/custodial wallet
const hopUrl = process.env.HOP_URL ?? 'http://localhost:4030';
const facilitatorUrl = process.env.FACILITATOR_URL ?? 'http://localhost:4022';
const prompt = process.env.PROMPT ?? 'In one sentence, name one Monet painting technique.';

async function main(): Promise<void> {
  // 1. Discover an expert and the flat query price (free).
  const match = await (await fetch(`${hopUrl}/v1/match`)).json();
  const expert = match.experts?.[0];
  console.log(
    `🔎 expert peer_id=${expert?.peer_id} via hop=${match.hop?.hop_id} ` +
      `price=${match.payment?.price} payee=${match.payment?.payee_hint}`,
  );

  // 2. Decide who pays this query: managed, sponsored self, or self-funded.
  const { wallet, sponsored } = await resolvePayer();
  const banner = !userMnemonic
    ? `managed custodial wallet (operator-run) — sponsored`
    : sponsored
      ? `self-custody, within free tier — operator sponsoring fee + 0.10 USDC`
      : `self-custody, free tier used up — sending your own ticket (self-paid)`;
  console.log(`👤 user=${userId} mode=${wallet.mode} payer=${wallet.address}\n   ${banner}`);

  // 3. Pay/authorize and route the query through the mixnet hop.
  const client = new x402Client().register('algorand:*', new ExactAvmScheme(wallet.signer));
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
  if (settle) console.log('\n💳 settled:', JSON.stringify(settle, null, 2));

  // 4. If this was a sponsored query for a self-custody user, burn one of the
  //    5 free credits. Managed users are unlimited (the operator runs them).
  if (sponsored && userMnemonic) {
    const after = await consumeSponsorship();
    console.log(`🎟️  free queries left: ${after.remaining}/${after.limit}`);
  }

  const answer = await response.json();
  console.log('\n✅ answer:', JSON.stringify(answer, null, 2));
}

async function resolvePayer(): Promise<{ wallet: TenetWallet; sponsored: boolean }> {
  // No wallet -> managed custodial, always operator-funded.
  if (!userMnemonic) {
    if (!operatorMnemonic) throw new Error('Managed user requires OPERATOR_MNEMONIC.');
    return { wallet: await managedWallet(operatorMnemonic, userId), sponsored: true };
  }

  // Has wallet -> sponsored for the first 5 queries, then self-funded.
  const status = await getSponsorship();
  if (status.sponsored) {
    if (!operatorMnemonic) throw new Error('Sponsored query requires OPERATOR_MNEMONIC.');
    return { wallet: await managedWallet(operatorMnemonic, userId), sponsored: true };
  }
  return { wallet: await selfWallet(userMnemonic), sponsored: false };
}

interface SponsorshipStatus {
  used: number;
  limit: number;
  remaining: number;
  sponsored: boolean;
}

async function getSponsorship(): Promise<SponsorshipStatus> {
  return (await fetch(`${facilitatorUrl}/sponsorship?user=${encodeURIComponent(userId)}`)).json();
}

async function consumeSponsorship(): Promise<SponsorshipStatus> {
  return (
    await fetch(`${facilitatorUrl}/sponsorship/consume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: userId }),
    })
  ).json();
}

main().catch(error => {
  console.error(error?.response?.data?.error ?? error);
  process.exit(1);
});
