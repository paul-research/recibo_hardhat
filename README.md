# Recibo (Hardhat)

## License
This work is licensed under `SPDX-License-Identifier: Apache-2.0`. It has not been audited, comes with no guarantees, and is provided as is. Use at your own risk.

## About
Recibo is a model smart contract that lets payers add encrypted memos to transactions. It works with standard ERC-20 tokens and also supports gasless transactions using ERC-2612 and ERC-3009. Payers route transactions through Recibo to record their memos as function calldata. Recibo can be used for invoicing, SWIFT ISO20022 messages, BSA Travel Rule, and other applications.

Recibo provides functions to route transactions to target tokens:
- `transferFromWithMsg`: Transfers tokens from msg.sender to receiver with an attached message.
- `permitWithMsg`: Approves token spending using ERC-2612 permit with an attached message.
- `permitAndTransferFromWithMsg`: Performs ERC-2612 permit and transfer with an attached message.
- `transferWithAuthorizationWithMsg`: Transfers tokens using ERC-3009 authorization with an attached message.

This repository contains the Hardhat/TypeScript implementation of the Recibo smart contracts, tests, and CLI tooling, configured for the Arc testnet.

## Quick Start

### Prerequisites
- Node.js v18+ and npm
- Hardhat
- Arc Testnet RPC endpoint (default: `https://rpc.testnet.arc.network`)
- Account private key funded with Arc testnet USDC (gas token)

### Install
```bash
npm install
cp env.sample .env   # set ARC_RPC_URL and ARC_PRIVATE_KEY
```

### Build & Test
```bash
npm run compile
npm run test
```

The test suite covers all contract scenarios including messaging, EIP-712 relay, ERC-2612 permits, ERC-3009 authorizations, and event emission.

### Deploy to Arc Testnet
The `hardhat.config.ts` file includes configuration for the `arcTestnet` network.

```bash
npx hardhat run scripts/deploy.ts --network arcTestnet
```

## Hardhat Tasks

CLI functionality is provided via Hardhat tasks defined in `tasks/recibo.ts`.

| Task | Description |
| --- | --- |
| `recibo:send-msg` | Send on-chain messages (direct or relayed) |
| `recibo:transfer-from` | Approve + transfer tokens with metadata |
| `recibo:permit-with-msg` | Issue EIP-2612 permits with metadata |
| `recibo:permit-and-transfer` | Permit Recibo contract and transfer in one call |
| `recibo:transfer-with-authorization` | Execute ERC-3009 transferWithAuthorizationWithMsg |
| `recibo:events` | Query Transfer/Approve/Sent events for a recipient |

### Examples

**Plain text message**
```bash
npx hardhat recibo:send-msg \
  --network arcTestnet \
  --recibo <RECIBO_CONTRACT_ADDRESS> \
  --ownerkey <PRIVATE_KEY> \
  --receiver <RECEIVER_ADDRESS> \
  --message "hello world" \
  --encryptAlg none
```

**PGP encrypted message**
```bash
npx hardhat recibo:send-msg \
  --network arcTestnet \
  --recibo <RECIBO_CONTRACT_ADDRESS> \
  --ownerkey <PRIVATE_KEY> \
  --receiver <RECEIVER_ADDRESS> \
  --message "secret" \
  --encryptAlg pgp \
  --encryptPubKeyfile path/to/receiver_pub.asc \
  --responseEncryptAlg pgp \
  --responsePubKeyfile path/to/sender_pub.asc
```

Tasks accept `--encryptAlg`, `--encryptPubKeyfile`, `--response*`, and `--messagehex` arguments to control message formatting and encryption.

## Crypto Layer (TypeScript)

The project includes a TypeScript implementation of the encryption layer:
- `src/crypto/encryptPgp.ts`: `openpgp`-based key generation, encryption, and decryption.
- `src/crypto/encryptNone.ts`: Passthrough implementation for plaintext usage.
- `src/crypto/reciboCrypto.ts`: Utilities for metadata generation and algorithm selection.

## Project Layout

```
.
├─ contracts/        # Recibo.sol, ReciboEvents.sol, mock/*
├─ test/             # Hardhat tests
├─ scripts/deploy.ts # Deployment script
├─ tasks/recibo.ts   # Hardhat CLI tasks
├─ src/crypto/       # Encryption helpers
├─ hardhat.config.ts # Hardhat configuration
└─ env.sample        # Environment variable template
```
