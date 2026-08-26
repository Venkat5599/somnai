/**
 * Contract fragments PRISM calls directly.
 *
 * Deliberately minimal. The protocol ABIs live in the SDK
 * (`binaryPoolWriteAbi`, `binarySettlementAbi`, `binaryModuleWriteAbi`) and are
 * used from there so they cannot drift from the code that encodes the calls.
 * What is vendored here is only what PRISM reads on its own — ERC-20 balances
 * and transfer logs — where pulling the whole SDK would be overkill.
 */

/** ERC-20 balance read. Used for every collateral check and verification. */
export const ERC20_BALANCE_OF = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * Transfer event.
 *
 * /proof decodes this to prove collateral actually moved, rather than trusting
 * a remembered number: it is the difference between claiming a trade settled
 * and showing that it did.
 */
export const ERC20_TRANSFER_EVENT = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
] as const;

/** Verified on Shannon. Read from live rows and confirmed against receipts. */
export const SHANNON_ADDRESSES = {
  collateral: "0x70a86d8842fb63c4ad2b7cdddf530ebf1bb25d8e",
  orderPool: "0x645b9b09b085326afa00efd9daf5c61f8401a694",
  settlement: "0x3ecc694cef705358864a646142ac17a90e29e388",
  outcomeToken: "0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9",
} as const;
