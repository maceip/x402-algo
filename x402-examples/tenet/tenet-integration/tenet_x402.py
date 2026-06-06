"""
tenet_x402 — reference scaffolding for the `x402-tenet/v1` payment extension.

This is REFERENCE CODE meant to be ported into `maceip/sphinx-tahoe`
(e.g. `tenet/payments/`). It is intentionally dependency-light and uses plain
dicts so it reads next to tenet's existing style. It shows three things:

1. The envelope extension a tenet client adds (`attach_voucher`) and an expert
   checks (`read_voucher`).
2. The operator-side settlement using Obscura as a USDC shielded pool, where the
   operator is BOTH depositor and withdrawer (Obscura's native same-secret
   model) and the expert is only the recipient address. See SPEC.md /
   OBSCURA-USDC.md.

Nothing here moves real funds; the Obscura calls are shown as the integration
points (`ObscuraUsdcPool`) you wire to `core/obscura_engine.py`,
`core/backend_server.py`, and the modified `contract/obscura_contract.py`.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass, field
from typing import Protocol

EXT = "x402-tenet/v1"
USDC_TESTNET_ASA_ID = 10458941
ALGORAND_TESTNET_CAIP2 = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI="
QUERY_AMOUNT_BASE_UNITS = 100_000  # 0.10 USDC (6 decimals)


# --------------------------------------------------------------------------- #
# Envelope extension (asker side / expert side)
# --------------------------------------------------------------------------- #

def payment_requirements(payee_hint: str = "expert") -> dict:
    """The flat requirement advertised by discovery and echoed in the envelope."""
    return {
        "ext": EXT,
        "scheme": "exact",
        "network": ALGORAND_TESTNET_CAIP2,
        "asset": USDC_TESTNET_ASA_ID,
        "amount": str(QUERY_AMOUNT_BASE_UNITS),
        "payee_hint": payee_hint,
    }


def attach_voucher(envelope_dict: dict, voucher_b64: str) -> dict:
    """Client: seal an x402 voucher into the PromptRequestEnvelope.

    The voucher is an off-chain AUTHORIZATION to spend one prepaid credit — it is
    NOT a bearer secret, so the asker has nothing to double-spend. It is carried
    inside the envelope (encrypted end-to-end to the expert); routing hops never
    see it.
    """
    out = dict(envelope_dict)
    out["x402"] = {**payment_requirements(), "voucher": voucher_b64}
    return out


def read_voucher(envelope_dict: dict) -> dict | None:
    """Expert: pull the x402 extension out of a decrypted envelope."""
    x402 = envelope_dict.get("x402")
    if not isinstance(x402, dict) or x402.get("ext") != EXT:
        return None
    return x402


def require_voucher(envelope_dict: dict) -> dict:
    x402 = read_voucher(envelope_dict)
    if x402 is None:
        raise PaymentRequired("missing x402-tenet/v1 voucher")
    if x402.get("amount") != str(QUERY_AMOUNT_BASE_UNITS):
        raise PaymentRequired("unexpected amount")
    return x402


class PaymentRequired(Exception):
    """Raised by an expert that refuses to answer without a valid voucher."""


# --------------------------------------------------------------------------- #
# Operator-side private settlement via the Obscura USDC pool
# --------------------------------------------------------------------------- #
# The operator is BOTH depositor and withdrawer (same secret-holder, exactly as
# Obscura/Tornado expect). The expert is only `recipient`. The asker is never a
# deposit/withdraw party and never holds a note secret.

class ObscuraEngine(Protocol):
    """Subset of core/obscura_engine.py :: ZKLSAGSystem we rely on (unchanged)."""

    def compute_commitment(self, secret: str) -> str: ...

    def generate_ring_signature(
        self, secret: str, commitments: list[str], signer_index: int, recipient_hex: str
    ) -> dict: ...


@dataclass
class Credit:
    """A prepaid query credit: a deposited 0.10-USDC note. Secret stays operator-side."""

    secret: str
    commitment: str
    spent: bool = False


@dataclass
class ObscuraUsdcPool:
    """Wraps the (USDC-modified) Obscura contract + prover for tenet.

    Wire `submit_deposit_group` / `submit_withdraw` to py-algorand-sdk against the
    modified contract (Payment->AssetTransfer, see OBSCURA-USDC.md). `engine` is
    the unchanged ZKLSAGSystem.
    """

    engine: ObscuraEngine
    credits: list[Credit] = field(default_factory=list)

    # --- deposit side (sponsor pre-funds query credits) ---------------------- #
    def mint_credit(self, secret: str) -> Credit:
        """Operator deposits a 0.10-USDC commitment; returns the credit it funds.

        On-chain: TxGroup[Deposit(P), AssetTransfer(0.10 USDC, asset=USDC)].
        """
        commitment = self.engine.compute_commitment(secret)
        self.submit_deposit_group(commitment)  # integration point
        credit = Credit(secret=secret, commitment=commitment)
        self.credits.append(credit)
        return credit

    # --- withdraw side (operator pays the expert, privately) ----------------- #
    def pay_expert(self, expert_address_hex: str, ring_size: int = 5) -> dict:
        """Spend one unspent credit, paying 0.10 USDC to the expert via a ring proof.

        Unlinkable to which deposit funded it. On-chain: Withdraw(I, sigma, m, R)
        with an inner AssetTransfer of 0.10 USDC to `expert_address_hex`.
        """
        credit = next((c for c in self.credits if not c.spent), None)
        if credit is None:
            raise RuntimeError("no unspent credit; operator must top up the pool")

        ring = self.select_ring(credit.commitment, ring_size)  # decoys + own commitment
        signer_index = ring.index(credit.commitment)
        sig = self.engine.generate_ring_signature(
            credit.secret, ring, signer_index, expert_address_hex
        )
        result = self.submit_withdraw(
            nullifier=sig["nullifier"], proof=self._pack_proof(ring, sig), recipient=expert_address_hex
        )  # integration point
        credit.spent = True
        return result

    # --- integration points (implement against py-algorand-sdk) -------------- #
    def submit_deposit_group(self, commitment_hex: str) -> None:
        raise NotImplementedError("wire to modified Obscura deposit (USDC axfer)")

    def submit_withdraw(self, *, nullifier: str, proof: str, recipient: str) -> dict:
        raise NotImplementedError("wire to modified Obscura withdraw (USDC axfer)")

    def select_ring(self, own_commitment: str, ring_size: int) -> list[str]:
        raise NotImplementedError("recency-biased decoy selection from the indexer")

    @staticmethod
    def _pack_proof(commitments: list[str], sig: dict) -> str:
        # Mirrors core/backend_server.py proof packing for the PyTeal verifier.
        proof = bytes([len(commitments)])
        for c in commitments:
            proof += bytes.fromhex(c)
        proof += bytes.fromhex(sig["c0"][2:])
        for s in sig["s"]:
            proof += bytes.fromhex(s[2:])
        return proof.hex()


def _b64json(obj: dict) -> str:
    return base64.b64encode(json.dumps(obj, separators=(",", ":")).encode()).decode()
