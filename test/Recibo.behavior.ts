import { expect } from "chai";
import { ethers } from "hardhat";
import type { Signer, TypedDataDomain } from "ethers";

import type { Recibo } from "../typechain-types/contracts/Recibo";
import type { GaslessToken } from "../typechain-types/contracts/mock/GaslessToken";

type ReciboInfoStruct = {
  messageFrom: string;
  messageTo: string;
  metadata: string;
  message: Uint8Array;
};

const PGP_METADATA =
  '{"version":"circle-0.2beta","encrypt":"pgp","response_encrypt_alg_id":1}';

const TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
  "0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267";

function utf8Bytes(text: string): Uint8Array {
  return ethers.toUtf8Bytes(text);
}

function hexFromBytes(data: Uint8Array): string {
  return ethers.hexlify(data);
}

function computeMessageNonce(
  from: string,
  to: string,
  messageBytes: Uint8Array,
): string {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "bytes"],
      [from, to, messageBytes],
    ),
  );
}

async function getChainId(signer: Signer): Promise<bigint> {
  const network = await signer.provider!.getNetwork();
  return network.chainId;
}

async function signPermit(
  owner: Signer,
  spender: string,
  value: bigint,
  deadline: bigint,
  token: GaslessToken,
) {
  const ownerAddress = await owner.getAddress();
  const domain: TypedDataDomain = {
    name: await token.name(),
    version: "1",
    chainId: await getChainId(owner),
    verifyingContract: await token.getAddress(),
  };

  const nonce = await token.nonces(ownerAddress);

  const types = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  const signature = await owner.signTypedData(domain, types, {
    owner: ownerAddress,
    spender,
    value,
    nonce,
    deadline,
  });

  return ethers.Signature.from(signature);
}

async function signTransferAuthorization(
  owner: Signer,
  from: string,
  to: string,
  value: bigint,
  validAfter: bigint,
  validBefore: bigint,
  nonce: string,
  token: GaslessToken,
) {
  const domain: TypedDataDomain = {
    name: await token.name(),
    version: "1",
    chainId: await getChainId(owner),
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

  return owner.signTypedData(domain, types, {
    from,
    to,
    value,
    validAfter,
    validBefore,
    nonce,
  });
}

describe("Recibo - full behavior", function () {
  async function deployFixture() {
    const [deployer, alice, bob, dave, relayer] = await ethers.getSigners();

    const token = (await ethers.deployContract("GaslessToken", [
      "Recibo Gasless Token",
      "RGT",
      ethers.parseUnits("2000", 18),
    ])) as unknown as GaslessToken;
    await token.waitForDeployment();

    // Deploy Recibo
    const recibo = (await ethers.deployContract("Recibo", [
      await token.getAddress(),
    ])) as unknown as Recibo;
    await recibo.waitForDeployment();

    // Give Recibo contract allowance for deployer for convenience in tests
    await token
      .connect(deployer)
      .approve(await recibo.getAddress(), ethers.MaxUint256);

    return {
      token,
      recibo,
      deployer,
      alice,
      bob,
      dave,
      relayer,
    };
  }

  describe("token introspection", function () {
    it("reports total supply and balances", async function () {
      const { token, deployer, alice } = await deployFixture();

      const totalSupply = await token.totalSupply();
      expect(totalSupply).to.equal(ethers.parseUnits("2000", 18));

      expect(await token.balanceOf(deployer.address)).to.equal(totalSupply);
      expect(await token.balanceOf(alice.address)).to.equal(0n);
    });
  });

  describe("sendMsg", function () {
    it("emits SentMsg for direct sender", async function () {
      const { recibo, deployer, alice } = await deployFixture();
      const message = utf8Bytes("hello world");

      const info: ReciboInfoStruct = {
        messageFrom: deployer.address,
        messageTo: alice.address,
        metadata: PGP_METADATA,
        message,
      };

      await expect(recibo.connect(deployer).sendMsg(info))
        .to.emit(recibo, "SentMsg")
        .withArgs(deployer.address, deployer.address, alice.address);
    });

    it("rejects spoofed sender", async function () {
        const { recibo, alice, bob, dave } = await deployFixture();
        const message = utf8Bytes("fake message");
  
        const info: ReciboInfoStruct = {
          messageFrom: alice.address, // Dave pretending to be Alice
          messageTo: bob.address,
          metadata: PGP_METADATA,
          message,
        };
  
        // Dave tries to send as Alice
        await expect(recibo.connect(dave).sendMsg(info))
          .to.be.revertedWith("Recibo: message sender mismatch");
      });
  });

  describe("transfer from with message", function () {
    it("transfers tokens and emits metadata", async function () {
      const { recibo, token, deployer, bob } = await deployFixture();
      const value = ethers.parseUnits("10", 18);

      const info: ReciboInfoStruct = {
        messageFrom: deployer.address,
        messageTo: bob.address,
        metadata: PGP_METADATA,
        message: utf8Bytes("invoice #1"),
      };

      await expect(recibo.connect(deployer).transferFromWithMsg(
        bob.address,
        value,
        info,
      ))
        .to.emit(recibo, "TransferWithMsg")
        .withArgs(
          deployer.address,
          bob.address,
          deployer.address,
          bob.address,
          value,
        );

      expect(await token.balanceOf(bob.address)).to.equal(value);
    });
  });

  describe("permit flows", function () {
    it("grants allowance via permitWithMsg", async function () {
      const { recibo, token, deployer, alice } = await deployFixture();
      const value = ethers.parseUnits("5", 18);
      const deadline = ethers.MaxUint256;

      const signature = await signPermit(
        deployer,
        alice.address,
        value,
        deadline,
        token,
      );

      const info: ReciboInfoStruct = {
        messageFrom: deployer.address,
        messageTo: alice.address,
        metadata: PGP_METADATA,
        message: utf8Bytes("permit test"),
      };

      await recibo.permitWithMsg(
        deployer.address,
        alice.address,
        value,
        deadline,
        signature.v,
        signature.r,
        signature.s,
        info,
      );

      expect(await token.allowance(deployer.address, alice.address)).to.equal(
        value,
      );
    });

    it("permits and transfers in one call", async function () {
      const { recibo, token, deployer, bob } = await deployFixture();
      const value = ethers.parseUnits("3", 18);
      const deadline = ethers.MaxUint256;

      const signature = await signPermit(
        deployer,
        await recibo.getAddress(),
        value,
        deadline,
        token,
      );

      const info: ReciboInfoStruct = {
        messageFrom: deployer.address,
        messageTo: bob.address,
        metadata: PGP_METADATA,
        message: utf8Bytes("permit transfer"),
      };

      await expect(
        recibo
          .connect(deployer)
          .permitAndTransferFromWithMsg(
            bob.address,
            value,
            deadline,
            signature.v,
            signature.r,
            signature.s,
            info,
          ),
      )
        .to.emit(recibo, "TransferWithMsg")
        .withArgs(
          deployer.address,
          bob.address,
          deployer.address,
          bob.address,
          value,
        );

      expect(await token.balanceOf(bob.address)).to.equal(value);
    });
  });

  describe("transfer with authorization", function () {
    it("consumes ERC-3009 authorization and enforces message hash nonce", async function () {
      const { recibo, token, deployer, bob } = await deployFixture();
      const value = ethers.parseUnits("7", 18);
      const validAfter = 0n;
      const validBefore = ethers.MaxUint256;
      const messageBytes = utf8Bytes("authorized transfer");
      const nonce = computeMessageNonce(
        deployer.address,
        bob.address,
        messageBytes,
      );

      const signature = await signTransferAuthorization(
        deployer,
        deployer.address,
        bob.address,
        value,
        validAfter,
        validBefore,
        nonce,
        token,
      );

      const info: ReciboInfoStruct = {
        messageFrom: deployer.address,
        messageTo: bob.address,
        metadata: PGP_METADATA,
        message: messageBytes,
      };

      // Bob submits the transaction, but the info.messageFrom is deployer (signer)
      // This is valid because we verified the signature against 'from' (deployer)
      // And we checked info.messageFrom == from
      await expect(
        recibo.connect(bob).transferWithAuthorizationWithMsg(
          deployer.address,
          bob.address,
          value,
          validAfter,
          validBefore,
          nonce,
          signature,
          info,
        ),
      )
        .to.emit(recibo, "TransferWithMsg")
        .withArgs(
          deployer.address,
          bob.address,
          deployer.address,
          bob.address,
          value,
        );

      expect(await token.balanceOf(bob.address)).to.equal(value);
    });
  });

  describe("event queries", function () {
    it("captures TransferWithMsg and ApproveWithMsg events", async function () {
      const { recibo, token, deployer, alice } = await deployFixture();
      const value = ethers.parseUnits("4", 18);
      const deadline = ethers.MaxUint256;

      const transferInfo: ReciboInfoStruct = {
        messageFrom: deployer.address,
        messageTo: alice.address,
        metadata: PGP_METADATA,
        message: utf8Bytes("event transfer"),
      };

      await token
        .connect(deployer)
        .approve(await recibo.getAddress(), value);

      const transferTx = await recibo
        .connect(deployer)
        .transferFromWithMsg(alice.address, value, transferInfo);
      const transferReceipt = await transferTx.wait();

      const permitSig = await signPermit(
        deployer,
        alice.address,
        value,
        deadline,
        token,
      );

      const permitInfo: ReciboInfoStruct = {
        messageFrom: deployer.address,
        messageTo: alice.address,
        metadata: PGP_METADATA,
        message: utf8Bytes("event permit"),
      };

      const approveTx = await recibo.permitWithMsg(
        deployer.address,
        alice.address,
        value,
        deadline,
        permitSig.v,
        permitSig.r,
        permitSig.s,
        permitInfo,
      );
      const approveReceipt = await approveTx.wait();

      const transferEvents = await recibo.queryFilter(
        recibo.filters.TransferWithMsg(),
        transferReceipt!.blockNumber,
        transferReceipt!.blockNumber,
      );
      const transferEvent = transferEvents.find(
        (event) => event.transactionHash === transferReceipt!.hash,
      );
      expect(transferEvent).to.not.be.undefined;
      expect(transferEvent!.args.from).to.equal(deployer.address);
      expect(transferEvent!.args.to).to.equal(alice.address);

      const approveEvents = await recibo.queryFilter(
        recibo.filters.ApproveWithMsg(),
        approveReceipt!.blockNumber,
        approveReceipt!.blockNumber,
      );
      const approveEvent = approveEvents.find(
        (event) => event.transactionHash === approveReceipt!.hash,
      );
      expect(approveEvent).to.not.be.undefined;
      expect(approveEvent!.args.owner).to.equal(deployer.address);
      expect(approveEvent!.args.spender).to.equal(alice.address);
    });
  });
});
