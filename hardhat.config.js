require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");

require("dotenv").config();

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        version: "0.8.4",
        settings: {
            optimizer: {
              enabled: true,
              runs: 200,
            },
          },
    },
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
        cmt_new: {
            url: `http://3.85.226.255`,
            chainId: 20,
            accounts: [PRIVATE_KEY],
            gas: 10e6,
        },
        hardhat: {
            chainId: 1337,
            accounts: {
                count: 40
            },
            initialDate: "2023-01-01"
        }
    },
    etherscan: {
        apiKey: {
            goerli: `${ETHERSCAN_API_KEY}`,
            bscTestnet: `${BSCSCAN_API_KEY}`
        }
    }
};
