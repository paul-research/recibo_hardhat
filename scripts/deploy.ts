import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const token = await ethers.deployContract("GaslessToken", [
    "Recibo Gasless Token",
    "RGT",
    2000,
  ]);
  await token.waitForDeployment();
  console.log("GaslessToken deployed to:", await token.getAddress());

  const recibo = await ethers.deployContract("Recibo", [
    await token.getAddress(),
  ]);
  await recibo.waitForDeployment();
  console.log("Recibo deployed to:", await recibo.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

