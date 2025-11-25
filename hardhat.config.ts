import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import "./tasks/recibo";

dotenv.config();

const ARC_RPC_URL =
  process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network";
const ARC_PRIVATE_KEY = process.env.ARC_PRIVATE_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    arcTestnet: {
      url: ARC_RPC_URL,
      chainId: 5042002,
      accounts: ARC_PRIVATE_KEY ? [ARC_PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    customChains: [
      {
        network: "arcTestnet",
        chainId: 5042002,
        urls: {
          apiURL: "https://testnet.arcscan.app/api",
          browserURL: "https://testnet.arcscan.app",
        },
      },
    ],
  },
};

export default config;

