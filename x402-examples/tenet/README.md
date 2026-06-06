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
- **Custodial + sponsored.** The operator manages client wallets and funds both
  the USDC query credit and the ALGO network fees. End users hold no keys.

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
| `client/` | custodial + sponsored asker; discovers an expert and authorizes 0.10 USDC | — |
| `facilitator/` | sponsored facilitator; verifies + covers ALGO fees | 4022 |
| `tenet-integration/` | the protocol spec, Obscura→USDC change set, and Python reference | — |

> Note: the local TS demo uses x402's standard on-chain settlement so it runs
> end-to-end on its own. Production swaps that settlement step for the
> Obscura-backed flow in the spec — the request-time x402 layer is identical.

## Run the local demo (Algorand TestNet)

Each package: copy `.env.template` → `.env`, fill it in, `pnpm install`, `pnpm start`.

```bash
# 1. sponsored facilitator (fund AVM_MNEMONIC with TestNet ALGO)
cd facilitator && pnpm install && pnpm start            # :4022

# 2. expert (set EXPERT_AVM_ADDRESS, FACILITATOR_URL)
cd ../expert && pnpm install && pnpm start              # :4031

# 3. routing hop (set EXPERT_URL=http://localhost:4031)
cd ../relay && pnpm install && pnpm start               # :4030

# 4. asker (set AVM_MNEMONIC custodial wallet, HOP_URL=http://localhost:4030)
cd ../client && pnpm install && pnpm start
```

**Prerequisites:** Algorand TestNet accounts with ALGO and USDC (ASA `10458941`).
