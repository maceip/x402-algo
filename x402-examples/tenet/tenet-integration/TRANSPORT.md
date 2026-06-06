# Transport binding: x402-tenet over WebTransport

This resolves the "there is no server" point. tenet is a p2p mixnet — there is no
central server to host x402 endpoints or enforce policy. **WebTransport** makes
that a non-issue: every peer becomes a bidirectional, multiplexed, server-grade
endpoint over a single QUIC connection, reachable by other peers *and by
browsers*. The x402 "resource server" role is then just a peer with a
WebTransport listener — not a host anyone has to run centrally.

## tenet already has the stack

Almost nothing new is required; the H3-over-QUIC machinery exists:

| Piece | Where | Status |
|---|---|---|
| HTTP/3 over aioquic (Extended CONNECT) | `tenet/mixnet/quic_transport.py` (`H3Connection`, `H3WebSocketServer/Client`, ALPN `h3`) | present |
| `webtransport` transport id | `tenet/mixnet/peer_address.py` (`TRANSPORT_WEBTRANSPORT`) | declared |
| REACH transport bit for webtransport | `tenet/mixnet/reach_wire.py` (transport bitmask, bit 1) | reserved |
| Opaque QUIC forwarding by the relay | `tenet/mixnet/supernode.py` (`SupernodeForwarder`) | unchanged — forwards bytes |

### The change ("outfit tenet")

1. **Enable WebTransport on the existing H3 connection.** In
   `quic_transport.py`, construct the H3 connection with
   `H3Connection(self._quic, enable_webtransport=True)` and handle
   `WebTransportStreamDataReceived` / `DatagramReceived` alongside the current H3
   events. Accept the incoming `CONNECT` with `:protocol = webtransport`. This is
   a sibling of the existing `_H3WebSocketProtocol` / `H3WebSocketServer`.
2. **Advertise it.** Put `TRANSPORT_WEBTRANSPORT` in each peer's
   `supported_transports` / peer-address record and set the REACH transport bit,
   so dialers pick WebTransport. Constants already exist.
3. **Relay is untouched.** The reachability relay forwards opaque QUIC bytes; a
   WebTransport session is just QUIC to it. It still never reads the query or the
   payment.

## How x402 maps onto it

x402 is an HTTP protocol, and WebTransport runs over HTTP/3 — so **the x402 HTTP
binding is reused verbatim**, peer-to-peer:

- **The expert peer is the resource server.** It serves `POST /v1/answer` (the
  402 challenge + settle) over its WebTransport/H3 listener. No central server —
  the expert *is* the endpoint.
- **The payment voucher** rides in the request to the expert, end-to-end inside
  the encrypted envelope; routing hops forward opaque QUIC and see nothing
  (unchanged from SPEC.md).
- **The answer streams back** over WebTransport unidirectional streams (and/or
  QUIC datagrams for the mixnet packet path) — exactly the streaming return path
  tenet already models.
- **Discovery** (`GET /v1/match`) is likewise a peer-served H3 request.

In other words, the Hono/express servers in this example are the **local HTTP/1.1
stand-in**; in tenet each is the same handler hosted by a peer over WebTransport.
The x402 request/response semantics do not change — only the carrier.

## Why this closes the open questions

- **"No server" for x402.** Every peer (expert, hop, and any operator/enclave
  component) is a WebTransport endpoint. There is nothing central to host.
- **Browser-reachable managed clients.** WebTransport is a browser API, so a user
  **without a wallet** can run the managed-custodial client straight from a web
  page and reach experts through the relay — no native install, no wallet. That
  is the natural home for the managed custody mode in SPONSORSHIP.md.
- **Policy enforcement still isn't "the server."** WebTransport solves
  *transport*, not trust. The sponsorship cap and custody still belong on-chain
  (the Algorand credit/Obscura contracts) or in the attested enclave — those are
  the trustless coordination points. WebTransport just means the *peers and the
  enclave talk directly*, with no separate server tier in between.
