import { task } from "hardhat/config";
import { ethers } from "ethers";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { Recibo } from "../typechain-types/contracts/Recibo";
import type { GaslessToken } from "../typechain-types/contracts/mock/GaslessToken";
import { ReciboCrypto } from "../src/crypto/reciboCrypto";

const DEFAULT_METADATA = ReciboCrypto.generateEncryptMetadata({
  encryptAlgId: ReciboCrypto.NOENCRYPT,
});

const DEFAULT_DECIMALS = 18;

type ReciboInfoStruct = Recibo.ReciboInfoStruct;

type EncryptionCLIArgs = {
  encryptAlg?: string;
  encryptPubKeyfile?: string;
  responsePubKeyfile?: string;
  responseEncryptAlg?: string;
  metadata?: string;
  messagehex?: string;
};

async function buildMessagePayload(
  plaintext: string,
  args: EncryptionCLIArgs,
) {
  if (args.messagehex) {
    return {
      bytes: ethers.getBytes(args.messagehex),
      metadata: args.metadata ?? DEFAULT_METADATA,
    };
  }

  const encryptAlg =
    args.encryptAlg ?? ReciboCrypto.NOENCRYPT;

  const metadata =
    args.metadata ??
    ReciboCrypto.generateEncryptMetadata({
      encryptAlgId: encryptAlg,
      encryptPubKeyFile: args.encryptPubKeyfile,
      responsePubKeyFile: args.responsePubKeyfile,
      responseEncryptAlgId: args.responseEncryptAlg,
    });

  const bytes = await ReciboCrypto.encryptMessage(
    encryptAlg,
    args.encryptPubKeyfile,
    plaintext,
  );

  return { bytes, metadata };
}

function buildInfo(
  messageFrom: string,
  messageTo: string,
  metadata: string,
  message: Uint8Array,
  nonce: bigint = 0n,
  signature = "0x",
): ReciboInfoStruct {
  return {
    messageFrom,
    messageTo,
    metadata,
    message,
    nonce,
    signature,
  };
}

async function getReciboContract(
  hre: HardhatRuntimeEnvironment,
  address: string,
  signer: ethers.Signer,
) {
  return hre.ethers.getContractAt("Recibo", address, signer) as Promise<Recibo>;
}

async function getTokenContract(
  hre: HardhatRuntimeEnvironment,
  address: string,
  signer: ethers.Signer,
) {
  return hre.ethers.getContractAt(
    "GaslessToken",
    address,
    signer,
  ) as Promise<GaslessToken>;
}

async function createWallet(
  hre: HardhatRuntimeEnvironment,
  privateKey: string,
) {
  return new hre.ethers.Wallet(privateKey, hre.ethers.provider);
}

async function signPermitTypedData(
  wallet: ethers.Wallet,
  spender: string,
  value: bigint,
  deadline: bigint,
  token: GaslessToken,
) {
  const domain = {
    name: await token.name(),
    version: "1",
    chainId: (await wallet.provider!.getNetwork()).chainId,
    verifyingContract: await token.getAddress(),
  };

  const nonce = await token.nonces(wallet.address);

  const types = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  return ethers.Signature.from(
    await wallet.signTypedData(domain, types, {
      owner: wallet.address,
      spender,
      value,
      nonce,
      deadline,
    }),
  );
}

async function signTransferAuthorizationTypedData(
  wallet: ethers.Wallet,
  from: string,
  to: string,
  value: bigint,
  validAfter: bigint,
  validBefore: bigint,
  nonce: string,
  token: GaslessToken,
) {
  const domain = {
    name: await token.name(),
    version: "1",
    chainId: (await wallet.provider!.getNetwork()).chainId,
    verifyingContract: await token.getAddress(),
  };

  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };

  return wallet.signTypedData(domain, types, {
    from,
    to,
    value,
    validAfter,
    validBefore,
    nonce,
  });
}

function computeMessageNonce(
  messageFrom: string,
  messageTo: string,
  message: Uint8Array,
) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "bytes"],
      [messageFrom, messageTo, message],
    ),
  );
}

task("recibo:send-msg", "Send an on-chain message via Recibo")
  .addParam("recibo", "Recibo contract address")
  .addParam("ownerkey", "Private key of the message sender")
  .addParam("receiver", "Recipient address")
  .addParam("message", "Plaintext message")
  .addOptionalParam("metadata", "Metadata JSON")
  .addOptionalParam(
    "messagehex",
    "Hex encoded message (overrides --message)",
    "",
  )
  .addOptionalParam(
    "encryptAlg",
    "Encryption algorithm id",
    ReciboCrypto.NOENCRYPT,
  )
  .addOptionalParam(
    "encryptPubKeyfile",
    "Path to receiver public key (PGP)",
    "",
  )
  .addOptionalParam(
    "responseEncryptAlg",
    "Response encryption algorithm id",
    ReciboCrypto.ENCRYPT_PGP,
  )
  .addOptionalParam(
    "responsePubKeyfile",
    "Path to sender public key for responses",
    "",
  )
  .setAction(async (args, hre) => {
    const wallet = await createWallet(hre, args.ownerkey);
    const contract = await getReciboContract(hre, args.recibo, wallet);
    const { bytes, metadata } = await buildMessagePayload(args.message, args);

    const info = buildInfo(
      wallet.address,
      args.receiver,
      metadata ?? DEFAULT_METADATA,
      bytes,
    );

    const tx = await contract.sendMsg(info);
    console.log(`Sent message. Tx hash: ${tx.hash}`);
  });

task(
  "recibo:transfer-from",
  "Approve and transfer tokens with metadata via Recibo",
)
  .addParam("recibo", "Recibo contract address")
  .addParam("ownerkey", "Private key of token owner")
  .addParam("receiver", "Recipient address")
  .addParam("value", "Token amount (human readable, defaults to 18 decimals)")
  .addParam("message", "Plaintext message")
  .addOptionalParam("metadata", "Metadata JSON")
  .addOptionalParam("decimals", "Token decimals", DEFAULT_DECIMALS.toString())
  .addOptionalParam(
    "messagehex",
    "Hex encoded message",
    "",
  )
  .addOptionalParam(
    "encryptAlg",
    "Encryption algorithm id",
    ReciboCrypto.NOENCRYPT,
  )
  .addOptionalParam(
    "encryptPubKeyfile",
    "Path to receiver public key",
    "",
  )
  .addOptionalParam(
    "responseEncryptAlg",
    "Response encryption algorithm id",
    ReciboCrypto.ENCRYPT_PGP,
  )
  .addOptionalParam(
    "responsePubKeyfile",
    "Path to sender public key for responses",
    "",
  )
  .setAction(async (args, hre) => {
    const wallet = await createWallet(hre, args.ownerkey);
    const contract = await getReciboContract(hre, args.recibo, wallet);
    const tokenAddress = await contract._token();
    const token = await getTokenContract(hre, tokenAddress, wallet);

    const amount = ethers.parseUnits(args.value, Number(args.decimals));
    await (await token.approve(args.recibo, amount)).wait();

    const { bytes, metadata } = await buildMessagePayload(args.message, args);
    const info = buildInfo(
      wallet.address,
      args.receiver,
      metadata ?? DEFAULT_METADATA,
      bytes,
    );

    const tx = await contract.transferFromWithMsg(args.receiver, amount, info);
    console.log(`Transfer transaction hash: ${tx.hash}`);
  });

task("recibo:permit-with-msg", "Issue EIP-2612 permit with metadata")
  .addParam("recibo", "Recibo contract address")
  .addParam("ownerkey", "Owner private key")
  .addParam("spender", "Address receiving allowance")
  .addParam("value", "Allowance amount (human readable)")
  .addParam("message", "Plaintext metadata message")
  .addOptionalParam("metadata", "Metadata JSON")
  .addOptionalParam("deadline", "Permit deadline (unix, default max)")
  .addOptionalParam("decimals", "Token decimals", DEFAULT_DECIMALS.toString())
  .addOptionalParam(
    "messagehex",
    "Hex encoded message",
    "",
  )
  .addOptionalParam(
    "encryptAlg",
    "Encryption algorithm id",
    ReciboCrypto.NOENCRYPT,
  )
  .addOptionalParam(
    "encryptPubKeyfile",
    "Path to recipient public key",
    "",
  )
  .addOptionalParam(
    "responseEncryptAlg",
    "Response encryption algorithm id",
    ReciboCrypto.ENCRYPT_PGP,
  )
  .addOptionalParam(
    "responsePubKeyfile",
    "Path to response public key",
    "",
  )
  .setAction(async (args, hre) => {
    const wallet = await createWallet(hre, args.ownerkey);
    const contract = await getReciboContract(hre, args.recibo, wallet);
    const tokenAddress = await contract._token();
    const token = await getTokenContract(hre, tokenAddress, wallet);

    const amount = ethers.parseUnits(args.value, Number(args.decimals));
    const deadline =
      args.deadline !== undefined
        ? BigInt(args.deadline)
        : ethers.MaxUint256;

    const signature = await signPermitTypedData(
      wallet,
      args.spender,
      amount,
      deadline,
      token,
    );

    const { bytes, metadata } = await buildMessagePayload(args.message, args);
    const info = buildInfo(
      wallet.address,
      args.spender,
      metadata ?? DEFAULT_METADATA,
      bytes,
    );

    const tx = await contract.permitWithMsg(
      wallet.address,
      args.spender,
      amount,
      deadline,
      signature.v,
      signature.r,
      signature.s,
      info,
    );
    console.log(`permitWithMsg tx hash: ${tx.hash}`);
  });

task(
  "recibo:permit-and-transfer",
  "Permit Recibo contract and transfer tokens with message",
)
  .addParam("recibo", "Recibo contract address")
  .addParam("ownerkey", "Owner private key")
  .addParam("receiver", "Recipient of tokens")
  .addParam("value", "Amount to transfer (human readable)")
  .addParam("message", "Plaintext message")
  .addOptionalParam("metadata", "Metadata JSON")
  .addOptionalParam("deadline", "Permit deadline (unix, default max)")
  .addOptionalParam("decimals", "Token decimals", DEFAULT_DECIMALS.toString())
  .addOptionalParam(
    "messagehex",
    "Hex encoded message",
    "",
  )
  .addOptionalParam(
    "encryptAlg",
    "Encryption algorithm id",
    ReciboCrypto.NOENCRYPT,
  )
  .addOptionalParam(
    "encryptPubKeyfile",
    "Path to receiver public key",
    "",
  )
  .addOptionalParam(
    "responseEncryptAlg",
    "Response encryption algorithm id",
    ReciboCrypto.ENCRYPT_PGP,
  )
  .addOptionalParam(
    "responsePubKeyfile",
    "Path to response public key",
    "",
  )
  .setAction(async (args, hre) => {
    const wallet = await createWallet(hre, args.ownerkey);
    const contract = await getReciboContract(hre, args.recibo, wallet);
    const tokenAddress = await contract._token();
    const token = await getTokenContract(hre, tokenAddress, wallet);

    const amount = ethers.parseUnits(args.value, Number(args.decimals));
    const deadline =
      args.deadline !== undefined
        ? BigInt(args.deadline)
        : ethers.MaxUint256;

    const signature = await signPermitTypedData(
      wallet,
      args.recibo,
      amount,
      deadline,
      token,
    );

    const { bytes, metadata } = await buildMessagePayload(args.message, args);
    const info = buildInfo(
      wallet.address,
      args.receiver,
      metadata ?? DEFAULT_METADATA,
      bytes,
    );

    const tx = await contract.permitAndTransferFromWithMsg(
      args.receiver,
      amount,
      deadline,
      signature.v,
      signature.r,
      signature.s,
      info,
    );
    console.log(`permitAndTransferFromWithMsg tx hash: ${tx.hash}`);
  });

task(
  "recibo:transfer-with-authorization",
  "Execute ERC-3009 transferWithAuthorizationWithMsg",
)
  .addParam("recibo", "Recibo contract address")
  .addParam("ownerkey", "Owner private key")
  .addParam("receiver", "Recipient of tokens")
  .addParam("value", "Amount to transfer (human readable)")
  .addParam("message", "Plaintext message")
  .addOptionalParam("metadata", "Metadata JSON")
  .addOptionalParam("validafter", "validAfter timestamp", "0")
  .addOptionalParam(
    "validbefore",
    "validBefore timestamp",
    ethers.MaxUint256.toString(),
  )
  .addOptionalParam("decimals", "Token decimals", DEFAULT_DECIMALS.toString())
  .addOptionalParam(
    "messagehex",
    "Hex encoded message",
    "",
  )
  .addOptionalParam(
    "encryptAlg",
    "Encryption algorithm id",
    ReciboCrypto.NOENCRYPT,
  )
  .addOptionalParam(
    "encryptPubKeyfile",
    "Path to receiver public key",
    "",
  )
  .addOptionalParam(
    "responseEncryptAlg",
    "Response encryption algorithm id",
    ReciboCrypto.ENCRYPT_PGP,
  )
  .addOptionalParam(
    "responsePubKeyfile",
    "Path to response public key",
    "",
  )
  .setAction(async (args, hre) => {
    const wallet = await createWallet(hre, args.ownerkey);
    const contract = await getReciboContract(hre, args.recibo, wallet);
    const tokenAddress = await contract._token();
    const token = await getTokenContract(hre, tokenAddress, wallet);

    const amount = ethers.parseUnits(args.value, Number(args.decimals));
    const { bytes, metadata } = await buildMessagePayload(args.message, args);
    const nonce = computeMessageNonce(wallet.address, args.receiver, bytes);

    const signature = await signTransferAuthorizationTypedData(
      wallet,
      wallet.address,
      args.receiver,
      amount,
      BigInt(args.validafter),
      BigInt(args.validbefore),
      nonce,
      token,
    );

    const info = buildInfo(
      wallet.address,
      args.receiver,
      metadata ?? DEFAULT_METADATA,
      bytes,
    );

    const tx = await contract.transferWithAuthorizationWithMsg(
      wallet.address,
      args.receiver,
      amount,
      BigInt(args.validafter),
      BigInt(args.validbefore),
      nonce,
      signature,
      info,
    );
    console.log(`transferWithAuthorizationWithMsg tx hash: ${tx.hash}`);
  });

task("recibo:events", "List Recibo events for a recipient")
  .addParam("recibo", "Recibo contract address")
  .addParam("recipient", "Address used as messageTo")
  .addOptionalParam("fromblock", "Start block", "0")
  .addOptionalParam("toblock", "End block (number or 'latest')", "latest")
  .setAction(async (args, hre) => {
    const contract = await hre.ethers.getContractAt("Recibo", args.recibo);
    const fromBlock = Number(args.fromblock);
    const toBlock =
      args.toblock === "latest" ? "latest" : Number(args.toblock);

    const transferEvents = await contract.queryFilter(
      contract.filters.TransferWithMsg(
        null,
        null,
        null,
        args.recipient,
      ),
      fromBlock,
      toBlock,
    );
    const approveEvents = await contract.queryFilter(
      contract.filters.ApproveWithMsg(
        null,
        null,
        null,
        args.recipient,
      ),
      fromBlock,
      toBlock,
    );
    const sentEvents = await contract.queryFilter(
      contract.filters.SentMsg(null, null, args.recipient),
      fromBlock,
      toBlock,
    );

    console.log(
      JSON.stringify(
        {
          transferEvents: transferEvents.map((event) => ({
            txHash: event.transactionHash,
            from: event.args.from,
            to: event.args.to,
            messageFrom: event.args.messageFrom,
            messageTo: event.args.messageTo,
            value: event.args.value.toString(),
            blockNumber: event.blockNumber,
          })),
          approveEvents: approveEvents.map((event) => ({
            txHash: event.transactionHash,
            owner: event.args.owner,
            spender: event.args.spender,
            messageFrom: event.args.messageFrom,
            messageTo: event.args.messageTo,
            value: event.args.value.toString(),
            blockNumber: event.blockNumber,
          })),
          sentEvents: sentEvents.map((event) => ({
            txHash: event.transactionHash,
            from: event.args.from,
            messageFrom: event.args.messageFrom,
            messageTo: event.args.messageTo,
            blockNumber: event.blockNumber,
          })),
        },
        null,
        2,
      ),
    );
  });

