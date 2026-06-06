# Obscura → USDC for tenet: feasibility & change set

**Question:** can we modify [`maceip/anonymous-usdc-algo`](https://github.com/maceip/anonymous-usdc-algo)
(Obscura) to (a) settle in **USDC** instead of ALGO and (b) act as the private
settlement rail for tenet's per-query payments?

**Verdict: feasible, low-risk.** Obscura is already a *fixed-denomination
shielded pool* (deposit a commitment, withdraw via an LSAG ring signature with a
key-image nullifier). Two properties make it a near-drop-in fit for tenet:

1. **Uniform denomination is required by the mixer and already true in tenet.**
   A ring-signature pool only provides anonymity when every note is identical.
   Every tenet query is exactly **0.10 USDC**, so the anonymity set is naturally
   uniform — no denomination engineering needed.
2. **Deposit↔withdraw unlinkability *is* asker↔expert unlinkability.** The whole
   point of Obscura is that a withdrawal cannot be linked to the deposit that
   funded it. Map *depositor → the sponsor funding a query credit* and
   *withdrawer → the expert being paid*, and the on-chain payment graph no longer
   mirrors the mixnet routing graph. That is exactly the guarantee tenet needs.

The cryptography (BN254 LSAG, key images, on-chain verification, opcode pooling
via the dummy app) is **unchanged**. Only value movement changes.

---

## What actually changes

### 1. Contract: `contract/obscura_contract.py`

Currently the pool moves **1 ALGO** via `Payment` txns. Switch to a **0.10 USDC
ASA** moved via `AssetTransfer`.

| Location | Now (ALGO) | Change (USDC ASA) |
|---|---|---|
| `deposit_amount = Int(1000000)` | 1 ALGO | `Int(100000)` — 0.10 USDC (6 decimals) |
| `on_deposit` group check | `Gtxn[1].type_enum() == Payment`, `.amount()`, `.receiver()` | `... == AssetTransfer`, assert `.xfer_asset() == Int(USDC_ID)`, `.asset_amount() == deposit_amount`, `.asset_receiver() == Global.current_application_address()` |
| `on_withdraw` inner txn | `InnerTxn{ type: Payment, receiver, amount: deposit_amount - min_fee - storage_cost, fee: min_fee }` | `InnerTxn{ type: AssetTransfer, xfer_asset: Int(USDC_ID), asset_receiver: recipient, asset_amount: deposit_amount, fee: min_fee }` — recipient gets the **full** 0.10 USDC; ALGO fee/MBR are sponsored separately, not netted out of the USDC |
| New branch `opt_in_asset` | — | one-time inner `AssetTransfer` of amount `0`, `xfer_asset: USDC_ID`, `asset_receiver: self` so the app account can hold the ASA |

The LSAG verification loop (`on_withdraw` lines ~96–131), the box model
(`Bytes("c")`/`Bytes("n")`), the nullifier double-spend check, and the opup loop
are untouched. `recipient` is already bound into the Fiat–Shamir hash
(`h = Sha256(recipient, L_i, R_i)`), so a withdrawal is cryptographically pinned
to the expert's address — no front-running of the payout.

### 2. Bootstrap: `contract/bootstrap_contract.py`

- After creating the app, fund it with extra ALGO for the **ASA min-balance**
  (+0.1 ALGO) plus **box MBR** (~0.041 ALGO per commitment box, ~0.016 ALGO per
  nullifier box) and inner-txn fees. All sponsored by the operator.
- Call the new `opt_in_asset` branch once so the app opts into USDC.
- Persist `USDC_ASSET_ID` (TestNet `10458941`) alongside the app id.

### 3. Prover / engine: **no change**

`core/obscura_engine.py` (`ZKLSAGSystem.compute_commitment`,
`generate_ring_signature`) and the proof packing in `core/backend_server.py`
operate only on the secret, the ring, and the recipient. They are value-agnostic
and need no edits for USDC.

### 4. Custody (deviation from upstream)

Obscura upstream is **non-custodial** (the secret `x` lives in browser
localStorage). tenet wants **managed/custodial**: store the per-credit secrets in
the operator's keystore — ideally inside the same **attested enclave** tenet
already uses for the matcher — and have the server-side prover look them up
instead of receiving them from a browser. This is an integration concern, not a
protocol change.

---

## Depositor ≠ withdrawer (the Tornado-style "same person" assumption)

Obscura, like Tornado Cash, is canonically used as a **self-unlinker**: one
person deposits, then later withdraws to a *fresh address* to break the link
between their own two addresses. In tenet the economic endpoints are two
*different* parties — the **asker** funds the query and the **expert** is paid.
Does the mixer still apply? Yes, with one clarification about what the protocol
actually requires.

**The protocol does not require the same *person* — it requires the same
*secret*.** A withdrawal is a proof of knowledge of the deposit secret `x` (it
derives the key-image `I = xH` and signs the ring). Whoever holds `x` can
withdraw to any recipient `m`. So `x` is a **bearer note**: a deposit can be paid
out by anyone who is given its secret.

That gives two ways to span "different entities":

1. **Naive note transfer (don't do this).** The asker deposits, then hands `x` to
   the expert (e.g. inside the envelope); the expert withdraws to itself. This
   *works cryptographically* but is unsafe: the asker still knows `x` and can
   **race-withdraw its own note back** after receiving the answer. The nullifier
   makes withdrawal winner-take-all, so a dishonest asker can reclaim its payment
   and stiff the expert. Recipient-binding doesn't save you, because the holder
   of `x` chooses `m` at withdraw time.

2. **Custodial issuance (what we use, and it matches Obscura's native shape).**
   The **operator** is *both* the depositor and the withdrawer-agent — exactly
   the same-entity model Obscura is built for. The operator deposits credits
   (holds every `x` inside the attested enclave) and, after an answer, withdraws
   one credit to the **expert's address** as the recipient `m`. The asker **never
   holds a note** — it only sends an x402 voucher authorizing "spend one of my
   prepaid credits," so it has nothing to race-withdraw. The expert never runs the
   prover or learns `x`; it just receives the inner USDC transfer.

So the *cryptographic* deposit/withdraw pair stays single-entity (operator →
operator-to-expert), satisfying Obscura's design, while the *economic* pair
(asker funds, expert earns) is decoupled by the custodial ledger above and by the
ring's on-chain unlinkability below. asker↔expert is hidden on-chain; the
operator knows the mapping, bounded by enclave attestation.

**Trust-minimized roadmap (operator shouldn't know asker↔expert either):** issue
the bearer notes via a **blind signature** so the operator can't link a note to
the asker that requested it (Chaumian ecash withdrawal), and prevent asker
double-spend by either (a) committing the payee into the deposit, or (b) keeping
issuance custodial-but-blinded. This is strictly more than launch needs.

## Sponsorship mapping ("sponsor the network fee *and* the application fee")

- **Application fee (0.10 USDC):** the operator pre-funds the pool by depositing
  0.10-USDC commitments as **query credits**. The asker spends a credit per
  query; at launch the operator funds the credits, so the asker pays nothing.
- **Network fee (ALGO):** the operator funds the app account's ALGO for box MBR,
  the ASA min-balance, the withdrawal inner-txn fee, and the `20n` opup inner
  calls (fee-pooled by the outer call). Askers and experts never need ALGO.

---

## Residual leakage & limits (be honest)

- **Ring size = anonymity.** Obscura's `recommendedRing` is `min(unspent, 5)`.
  Anonymity is only as large as the live unspent set; at cold start, pre-seed the
  pool with operator decoy deposits so early withdrawals aren't trivially linked.
- **Timing intersection.** A withdrawal still happens close in time to the query
  it pays for. Decouple with a settlement delay / batching window so the payout
  epoch doesn't pin a withdrawal to a single query. Obscura's recency-biased
  decoy selection already mitigates the deposit side.
- **Expert address reuse.** If an expert always withdraws to the same address,
  its *earnings* are observable (not linked to askers, but its volume is). Rotate
  recipient addresses per epoch if expert-volume privacy matters.
- **Operator trust.** Custodial + a custodial matcher means the operator could in
  principle observe asker↔expert internally. The attested enclave is what bounds
  that; Obscura ensures nothing leaks **on-chain** regardless.
- **Not audited for MainNet.** Obscura's README flags it as experimental research
  software. Keep the launch on TestNet (matching the rest of this repo) pending
  an independent audit.

---

## Effort estimate

| Task | Size |
|---|---|
| Contract: Payment→AssetTransfer + `opt_in_asset` branch | ~30 lines PyTeal |
| Bootstrap: ASA opt-in, ALGO funding for MBR, persist asset id | ~40 lines |
| Custodial keystore + server-side prover wiring | moderate (integration) |
| tenet wiring: credit deposits, expert withdrawal on answer (see SPEC.md) | moderate |
| Cryptography / verification | **0 — unchanged** |
