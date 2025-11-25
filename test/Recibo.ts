import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("Recibo", function () {
  async function deployReciboFixture() {
    const [deployer, alice] = await ethers.getSigners();

    const token = await ethers.deployContract("GaslessToken", [
      "Recibo Gasless Token",
      "RGT",
      ethers.parseEther("2000"),
    ]);
    await token.waitForDeployment();

    const recibo = await ethers.deployContract("Recibo", [
      await token.getAddress(),
    ]);
    await recibo.waitForDeployment();

    return { token, recibo, deployer, alice };
  }

  it("emits SentMsg when sending a message", async function () {
    const { recibo, deployer, alice } = await loadFixture(deployReciboFixture);

    const info = {
      messageFrom: deployer.address,
      messageTo: alice.address,
      metadata: "{}",
      message: ethers.toUtf8Bytes("hello world"),
      nonce: ethers.hexlify(ethers.randomBytes(32)),
      signature: "0x",
    };

    await expect(recibo.sendMsg(info))
      .to.emit(recibo, "SentMsg")
      .withArgs(deployer.address, deployer.address, alice.address);
  });

  it("transfers tokens alongside metadata", async function () {
    const { recibo, token, deployer, alice } =
      await loadFixture(deployReciboFixture);

    const amount = ethers.parseEther("10");
    await token
      .connect(deployer)
      .approve(await recibo.getAddress(), amount);

    const info = {
      messageFrom: deployer.address,
      messageTo: alice.address,
      metadata: "{\"purpose\":\"test\"}",
      message: ethers.toUtf8Bytes("invoice #1"),
      nonce: ethers.hexlify(ethers.randomBytes(32)),
      signature: "0x",
    };

    await expect(recibo.transferFromWithMsg(alice.address, amount, info))
      .to.emit(recibo, "TransferWithMsg")
      .withArgs(
        deployer.address,
        alice.address,
        deployer.address,
        alice.address,
        amount,
      );

    await expect(await token.balanceOf(alice.address)).to.equal(amount);
  });
});

