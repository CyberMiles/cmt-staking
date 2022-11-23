require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");

require("dotenv").config();

const ALCHEMY_API_KEY = "cKfSSw9dViP7kNXAzXsTS4uUj0EZbKw8";
const ETHERSCAN_API_KEY = "QA8SAPQZVKZJ6W684VQZJ3PZH6AB5TX9BA"
const BSCSCAN_API_KEY = "N7IS8JC3BRGM2G667A2N3V5IZHH3XUKG84"
const PRIVATE_KEY = process.env.PRIVATEKEY;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: "0.8.4",
    networks: {
        goerli: {
            url: `https://eth-goerli.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
            gas: 15000000,
            accounts: [PRIVATE_KEY]
        },
        bsc_testnet: {
            url: `https://data-seed-prebsc-1-s1.binance.org:8545/`,
            chainId: 97,
            accounts: [PRIVATE_KEY],
            gas: 10e6,
        },
        hardhat: {
            chainId: 1337
        }
    },
    etherscan: {
        apiKey: {
            goerli: `${ETHERSCAN_API_KEY}`,
            bscTestnet: `${BSCSCAN_API_KEY}`
        }
    }
};
