# Contracts

**PRISM deploys no contracts.** It is a client of DreamDEX's, and this directory
documents the ones it talks to — addresses, ABIs, and what each is for.

That distinction matters: an empty `contracts/` folder, or a stub Solidity file,
would imply PRISM owns on-chain code it does not. What it owns is the client
that drives these.

## Verified on Somnia Shannon (chain 50312)

| Contract | Address | Role |
|---|---|---|
| tUSDC | `0x70a86d8842fb63c4ad2b7cdddf530ebf1bb25d8e` | Collateral. **6 decimals**, not 18 |
| Order pool | `0x645b9b09b085326afa00efd9daf5c61f8401a694` | Order placement — verified in the buy tx |
| Settlement | `0x3ecc694cef705358864a646142ac17a90e29e388` | Redemption — verified in the redeem tx |
| Outcome token | `0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9` | ERC-6909 singleton holding YES/NO ids |

Addresses were read off live market rows and confirmed against transaction
receipts, not copied from a deployment manifest. The bot kit warns that venue
ids move; the same caution applies here.

## Verified interactions

```
buy     0xd6f0a3e2831b5fdea150e9d026234f9dfc5bd62e33064510117e114f9ffef65e
        -> order pool  0x645b9b09…
redeem  0x1b21a41150cd019ca1fdc1472f416563de7e3a6158499e4b1844aa0cfc793206
        -> settlement  0x3ecc694c…
```

## ABIs

`abis.ts` carries only the fragments PRISM actually calls. The full protocol
ABIs ship with `@somnia-chain/markets-sdk` (`binaryPoolWriteAbi`,
`binaryModuleWriteAbi`, `binarySettlementAbi`) and are used directly from there
rather than vendored, so they cannot drift from the SDK that encodes the calls.

## Why no Solidity here

A venue operator would deploy market contracts and need this directory for
source. PRISM composes *existing* Event Contracts into strategies — the
interesting code is the client, in `sdk/` and `backend/`.
