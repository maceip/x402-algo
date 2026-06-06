# tenet ⇄ x402 ⇄ Obscura integration

Design + reference for adding paid, **unlinkable** expert queries to the tenet
network (`maceip/sphinx-tahoe`).

- **[SPEC.md](SPEC.md)** — the `x402-tenet/v1` protocol: how a flat 0.10 USDC
  query payment is authorized at request time with x402 and settled privately
  through Obscura, without re-linking asker↔expert.
- **[OBSCURA-USDC.md](OBSCURA-USDC.md)** — feasibility + concrete change set to
  make `maceip/anonymous-usdc-algo` (Obscura) move **USDC** instead of ALGO, and
  why the *depositor ≠ withdrawer* case is handled by keeping settlement
  operator-side (Obscura's native same-secret model).
- **[SPONSORSHIP.md](SPONSORSHIP.md)** — custody modes (managed vs self-custody)
  and the tiered sponsorship policy (first 5 queries free per self-custody user,
  then they send their own ticket).
- **[tenet_x402.py](tenet_x402.py)** — dependency-light reference scaffolding to
  port into `tenet/payments/`: the envelope extension and the operator-side
  Obscura settlement wrapper.

## One-paragraph summary

tenet always routes through the mixnet, so the only thing that could re-link an
asker to an expert is the payment. We therefore split **authorization** from
**settlement**: x402 carries a per-query voucher *inside the encrypted envelope*
(routing hops stay blind; the expert verifies it and is the payee), while the
0.10 USDC is actually paid through the Obscura shielded pool — the operator
deposits uniform query credits and withdraws to the expert via an LSAG ring
proof, so on-chain the payout cannot be tied to the asker. Custodial + sponsored:
the operator holds the wallets and the note secrets (in tenet's attested
enclave) and funds both the USDC credits and the ALGO fees, so end users hold no
keys and need no funds.

## The two repos this spans

| Repo | Role | Change |
|---|---|---|
| `maceip/sphinx-tahoe` (tenet) | mixnet + experts | add the `x402` envelope field; expert verifies voucher; operator settlement hook |
| `maceip/anonymous-usdc-algo` (Obscura) | private settlement | swap ALGO→USDC ASA in the contract + bootstrap (crypto unchanged) |

This `x402-algo` repo holds the x402 building blocks and this integration spec.
