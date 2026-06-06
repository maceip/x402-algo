# `x402-tenet/v1` — paid, unlinkable expert queries

This is the protocol extension that adds payment to the tenet expert network
(`maceip/sphinx-tahoe`) using x402 for request-time authorization and Obscura
(`maceip/anonymous-usdc-algo`) for private on-chain settlement.

## Goals

1. Every query costs a flat **0.10 USDC**, which is earned by the **expert** that
   answers it.
2. **Custodial + sponsored at launch:** the operator manages client wallets and
   pays both the application fee (USDC) and the network fee (ALGO). End users
   hold no keys and need no funds.
3. **Preserve mixnet unlinkability:** nothing in the payment layer may link an
   asker to an expert. The mixnet hides the route; the payment rail must not
   re-expose it.

## Why the obvious approach fails

tenet always routes through the mixnet — there is no direct asker→expert
connection. So the *only* thing that could re-link asker and expert is the
**payment**. Stock x402 settles as an on-chain transfer `payer → payTo` per
request; with `payTo = expert` that is a direct `asker → expert` edge on a public
ledger, timing-correlated with the query, from a stable asker wallet. That single
edge undoes the mixnet. **The payment graph must not mirror the routing graph.**

## Roles

| x402 / tenet role | Who | Notes |
|---|---|---|
| Asker | tenet client | Custodial wallet operated by the operator. |
| Routing hop(s) | any public client | Forward opaque Sphinx bytes. Not the payee. Always present (no direct connections). |
| Resource server / verifier | the **expert** | Only node that decrypts the envelope; enforces payment; **is the payee**. |
| Facilitator | operator service | Verifies the voucher; drives Obscura settlement. Sponsors ALGO fees. |
| Settlement rail | **Obscura USDC pool** | Deposit = query credit; withdrawal = private payout to the expert. |

Routing hops stay **blind**: the payment travels encrypted inside the
`PromptRequestEnvelope`, so relays forward ciphertext and never see the query or
the payment. (Contrast: do **not** put a paywall on the relay.)

## Envelope extension

Add an x402 authorization to `tenet/envelope.py :: PromptRequestEnvelope`,
encrypted end-to-end to the expert (relays carry it opaquely):

```jsonc
{
  "version": "por.app.v1",
  "request_id": "…",
  "selected_peer_id": "expert-…",
  "prompt_payload": { "text": "…" },
  "x402": {                              // NEW — the x402-tenet/v1 extension
    "ext": "x402-tenet/v1",
    "amount": "100000",                  // 0.10 USDC, base units (6 dp)
    "asset": 10458941,                   // USDC ASA (TestNet)
    "network": "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=",
    "payee_hint": "expert",              // expert is the payee
    "voucher": "<base64 x402 PAYMENT-SIGNATURE>"  // signed by custodial wallet
  }
}
```

`client_extensions` advertises `x402-tenet/v1` so an expert can require it. The
`voucher` is produced exactly like a normal x402 payment payload
(`x402Client.createPaymentPayload(...)` → `encodePaymentSignatureHeader(...)`),
but it is **carried in the envelope**, not an HTTP header, and it is **not**
settled as `asker → expert`.

## Flow

```
asker (custodial)        routing hops          expert (verifier+payee)     operator/facilitator + Obscura
      │                       │                          │                              │
      │ 1. discover expert + 0.10 USDC requirement (free matcher)                       │
      │──────────────────────────────────────────────────────────────────────────────▶│
      │ 2. build envelope { query, x402.voucher }, sealed to expert                     │
      │ 3. send through mixnet (relays forward opaque bytes)                            │
      │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶ │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▶ │                              │
      │                       │   4. decrypt; verify voucher                            │
      │                       │      against requirements ──────────────────────────▶  │ verify()
      │                       │   5. answer (stream back) │                             │
      │ ◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │                              │
      │                       │                          │ 6. redeem credit ──────────▶│ Obscura WITHDRAW
      │                       │                          │    (ring sig) → expert addr  │   0.10 USDC, private
```

1. **Discover (free).** Asker queries the network for experts and the flat
   payment requirement (0.10 USDC, USDC ASA, network).
2. **Authorize.** Custodial agent signs an x402 voucher for this query and seals
   it inside the envelope.
3. **Route.** Envelope traverses the mixnet; hops forward opaque bytes.
4. **Verify.** The expert decrypts, checks the voucher against the requirements
   via the facilitator. No answer without a valid voucher.
5. **Answer.** Expert streams the reply over the return path.
6. **Settle privately.** The **operator** redeems one prepaid query credit by
   performing an **Obscura withdrawal of 0.10 USDC to the expert's address**,
   proven with an LSAG ring signature over decoy commitments. The withdrawal is
   unlinkable to the deposit that funded the credit, so the on-chain payout cannot
   be tied back to the asker.

## Settlement = Obscura, not stock x402

Obscura is a Tornado-style mixer: canonically the depositor and withdrawer are
the *same secret-holder*. We keep it that way — the **operator** is both — while
the *economic* parties differ (asker funds, expert earns). See
OBSCURA-USDC.md → *Depositor ≠ withdrawer* for why this is the safe construction
(a naive asker→expert note hand-off lets a dishonest asker race-withdraw its own
payment back).

- **Pre-funding (sponsor):** the operator deposits 0.10-USDC commitments into the
  Obscura pool as **query credits** (one note = one prepaid query). Every secret
  `x` stays in the operator's attested keystore; the asker never holds a note.
- **Authorization:** the asker's voucher (in the envelope) authorizes spending
  one of its prepaid credits — it is accounting, not a bearer secret, so there is
  nothing for the asker to double-spend.
- **Payout:** answering a query consumes one credit; the **operator** withdraws
  0.10 USDC to the **expert's address** (`recipient = m`) using a ring proof. The
  expert never runs the prover or learns `x`. The key-image nullifier prevents
  double-spend (one credit = one paid query).
- **On-chain graph:** only `operator → pool` deposits and `pool → expert`
  ring-signed withdrawals — both uniform 0.10 USDC, neither linkable to an asker.
- **Batching / delay:** disburse on an epoch boundary (not synchronously with the
  answer) to break query↔withdrawal timing correlation. See OBSCURA-USDC.md.

## What each party can and cannot learn

| Party | Learns | Cannot learn |
|---|---|---|
| On-chain observer | pool deposits & withdrawals (uniform 0.10 USDC) | which asker, which expert-for-which-asker, query timing→payout |
| Routing hop | previous/next hop, ciphertext size | query, voucher, endpoints |
| Expert | the query, that a valid credit exists | which asker sent it (mixnet return path) |
| Operator | matching inputs inside the **attested enclave** | bounded by attestation; nothing leaks on-chain |

## Known limitations

See OBSCURA-USDC.md → *Residual leakage & limits*: ring-size floor at cold start,
timing intersection (mitigated by batching), expert address reuse, operator trust
(bounded by attestation), and TestNet-only / unaudited status.

## Honesty note on enforcement

The expert is the enforcement point because it is the only node that can decrypt
the envelope. A dishonest expert could answer without a valid voucher and forgo
its own payout — self-defeating, and at launch experts are operator-managed, so
this is acceptable. A future version can bind the answer's return-path delivery
to a settlement proof.
