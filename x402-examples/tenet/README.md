# tenet × x402 — paid, unlinkable expert queries

This example brings the **x402 payment protocol** to the **tenet expert network**
(`maceip/sphinx-tahoe`): every query costs a flat **0.10 USDC**, earned by the
**expert** that answers it, settled so that the payment never re-links the asker
to the expert.

> Read **[tenet-integration/](tenet-integration/)** first — it is the source of
> truth (SPEC.md, OBSCURA-USDC.md). The TypeScript packages below are a runnable
> illustration of the *request-time* x402 layer; private settlement is described
> in the spec and is done via the Obscura USDC shielded pool.

## The model in four bullets

- **Always routed.** tenet has no direct asker→expert connection; queries cross
  the mixnet. Routing hops forward **opaque** bytes — they never see the query or
  the payment.
- **Payment rides inside the envelope.** The x402 voucher is sealed end-to-end to
  the expert, so only the expert (the one node that decrypts) verifies it. No
  paywall on the relay.
- **Expert is the payee.** The 0.10 USDC is the expert's fee.
- **Dual custody + tiered sponsorship.** A user with **no wallet** gets a
  **managed custodial** wallet the operator runs and fully funds. A user with
  **their own wallet** keeps custody and is sponsored (network fee + 0.10 USDC)
  for their **first 5 queries**, then **sends their own ticket** (self-funds).
  See [`tenet-integration/SPONSORSHIP.md`](tenet-integration/SPONSORSHIP.md).

## Why settlement is Obscura, not a direct transfer

A stock x402 `asker → expert` USDC transfer would put a timing-correlated edge on
a public ledger and undo the mixnet. Instead the 0.10 USDC is paid through the
**Obscura** shielded pool (LSAG ring signatures on Algorand): the operator
deposits uniform query credits and withdraws to the expert with a ring proof, so
the payout is unlinkable to the deposit that funded it. See
[`tenet-integration/SPEC.md`](tenet-integration/SPEC.md).

## Packages (runnable x402 request-layer demo)

| Dir | Role | Port |
|---|---|---|
| `expert/` | x402 resource server = the expert; verifies the voucher, answers, is the payee | 4031 |
| `relay/` | a tenet routing hop; forwards opaque bytes, **not** a payee | 4030 |
| `client/` | asker with dual-mode wallet (managed vs self) + tiered sponsorship | — |
| `facilitator/` | sponsored facilitator + per-user sponsorship ledger | 4022 |
| `tenet-integration/` | the protocol spec, Obscura→USDC change set, and Python reference | — |

> Note: the local TS demo uses HTTP/1.1 servers and x402's standard on-chain
> settlement so it runs end-to-end on its own. In tenet there is **no central
> server** — each handler is hosted by a **peer over WebTransport** (HTTP/3),
> which tenet already has the stack for; see
> [`tenet-integration/TRANSPORT.md`](tenet-integration/TRANSPORT.md). The
> request-time x402 layer is identical over either carrier. Production also swaps
> the settlement step for the Obscura-backed flow in the spec.

## Run the local demo (Algorand TestNet)

Each package: copy `.env.template` → `.env`, fill it in, `pnpm install`, `pnpm start`.

```bash
# 1. sponsored facilitator (fund AVM_MNEMONIC with TestNet ALGO)
cd facilitator && pnpm install && pnpm start            # :4022

# 2. expert (set EXPERT_AVM_ADDRESS, FACILITATOR_URL)
cd ../expert && pnpm install && pnpm start              # :4031

# 3. routing hop (set EXPERT_URL=http://localhost:4031)
cd ../relay && pnpm install && pnpm start               # :4030

# 4. asker — set OPERATOR_MNEMONIC + HOP_URL + FACILITATOR_URL.
#    Leave AVM_MNEMONIC empty for a MANAGED user (operator runs the wallet),
#    or set it for a SELF-CUSTODY user (sponsored 5 queries, then self-pays).
cd ../client && pnpm install && pnpm start
```

Run the self-custody client 6+ times (same `USER_ID`) to watch it graduate from
sponsored to "send your own ticket" after the 5th query.

**Prerequisites:** Algorand TestNet accounts with ALGO and USDC (ASA `10458941`).
