# Custody & sponsorship policy

tenet supports two kinds of users and meters sponsorship per user.

## Two custody modes

| | No wallet | Has a wallet |
|---|---|---|
| Mode | **Managed custodial** | **Self-custody** |
| Keys | operator runs a wallet for the user | user holds their own key |
| Who signs | operator | operator (while sponsored) → user (after) |
| Sponsorship | fully operator-funded | first **5** queries sponsored, then self-funded |

A user with no wallet never has to obtain one: the operator provisions and runs a
custodial account for them and funds every query. A user who brings their own
wallet keeps custody and is onboarded with a free allowance.

## Tiered sponsorship (self-custody users)

For a self-custody user, the operator sponsors **both** fees for the first
`SPONSORED_LIMIT` (default **5**) queries:

- **Network fee** — the ALGO transaction fee (paid by the operator / facilitator).
- **App fee** — the flat **0.10 USDC** query price (paid from the operator pool).

From query **6** onward the user **"sends their own ticket"**: they pay the 0.10
USDC (and their network fee) from their own wallet. In the Obscura settlement
model that literally means the user deposits their own query credit and spends it;
in the plain-x402 demo it means the client signs the payment with the user's own
key instead of the operator's.

```
self-custody user, query N:
  N <= 5   -> operator signs & funds (sponsored)         counter++
  N >  5   -> user signs & funds (sends their own ticket)
```

Managed (no-wallet) users are **not** metered against the 5-cap — the operator
runs them end to end.

## Where the policy lives

- The per-user counter is the **operator's** state, exposed by the facilitator:
  - `GET  /sponsorship?user=<id>` → `{ used, limit, remaining, sponsored }`
  - `POST /sponsorship/consume` `{ user }` → increments after a sponsored query.
- The client (`client/index.ts`) resolves the payer per query:
  - no wallet → `managedWallet(OPERATOR_MNEMONIC)` (sponsored, unlimited),
  - has wallet & `sponsored` → `managedWallet(OPERATOR_MNEMONIC)` (operator pays),
  - has wallet & tier used up → `selfWallet(AVM_MNEMONIC)` (user pays).

The demo counter is in-memory; back it with a real store and bind the user
identity to an authenticated session in production. Per-user managed accounts
should be derived/segregated from the operator master seed (see
`client/wallet.ts :: managedWallet`).
