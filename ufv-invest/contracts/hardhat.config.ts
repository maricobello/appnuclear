import "dotenv/config";
import { HardhatUserConfig, subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";
import "@nomicfoundation/hardhat-toolbox";

/**
 * Compilador: solcjs (WASM) do pacote npm `solc`, versão fixada em 0.8.28.
 *
 * O ambiente de CI/desenvolvimento não alcança binaries.soliditylang.org, então substituímos a
 * subtask que baixaria o solc nativo para usar o soljson.js local. O bytecode gerado é idêntico ao
 * do solc nativo da mesma versão (mesmo commit), o que permite verificar no BscScan normalmente.
 */
const SOLC_VERSION = "0.8.28";
const SOLC_LONG_VERSION = "0.8.28+commit.7893614a";

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(
  async (args: { solcVersion: string }, _hre, runSuper) => {
    if (args.solcVersion !== SOLC_VERSION) return runSuper(args);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const solcPkg = require("solc/package.json") as { version: string };
    if (solcPkg.version !== SOLC_VERSION) {
      throw new Error(`pacote solc ${solcPkg.version} instalado, esperado ${SOLC_VERSION}`);
    }
    return {
      compilerPath: require.resolve("solc/soljson.js"),
      isSolcJs: true,
      version: SOLC_VERSION,
      longVersion: SOLC_LONG_VERSION,
    };
  },
);

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY?.trim();
const accounts = deployerKey ? [deployerKey.startsWith("0x") ? deployerKey : `0x${deployerKey}`] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: SOLC_VERSION,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      metadata: { bytecodeHash: "ipfs" },
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      // Os testes usam blocos com timestamp real (outubro/2026 em diante) e viajam no tempo.
      hardfork: "cancun",
      // HARDHAT_CHAIN_ID=97 faz o `hardhat node` se passar pela BSC testnet (teste ponta a ponta do site)
      chainId: Number(process.env.HARDHAT_CHAIN_ID) || 31337,
    },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
      chainId: 97,
      accounts,
    },
    bsc: {
      url: process.env.BSC_RPC_URL || "https://bsc-dataseed.bnbchain.org",
      chainId: 56,
      accounts,
    },
  },
  etherscan: {
    // API v2 do Etherscan (multichain): a mesma chave atende BSC (56) e BSC testnet (97).
    apiKey: process.env.ETHERSCAN_API_KEY || process.env.BSCSCAN_API_KEY || "",
  },
  sourcify: { enabled: false },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    offline: true,
    reportPureAndViewMethods: false,
    excludeContracts: ["src/mocks/"],
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
  mocha: {
    timeout: 120_000,
  },
};

export default config;
