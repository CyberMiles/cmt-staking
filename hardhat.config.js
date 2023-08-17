require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");

require("dotenv").config();

const setLockPeriod = require("./scripts/tasks/setLockPeriod");
const addValidator = require("./scripts/tasks/addValidator");

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;
const BSCSCAN_API_KEY = process.env.BSCSCAN_API_KEY;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

task("setLockPeriod", "Owner can set lock perod", setLockPeriod)
    .addParam("cmtContract", "cmt proxy contract address")
    .addParam("lockPeriod", "the lock period in seconds");

task("addValidator", "Owner can add validator", addValidator)
    .addParam("cmtContract", "cmt proxy contract address")
    .addParam("validatorAddress", "the validator address");

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
            url: `https://cmt-stg-rpc-full.bttcdn.com/`,
            chainId: 18,
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
    },
    addresses: {
        owner_addr: "0x455878F0893a77C6fB7035DF13c7881A2261F88F",
        init_validator_addr: "0x38672b2206b095e0dd47f9be052c1279a1edcca5",
        cmt_new_deployed_proxyAddress: "0xe5B22d8240F479f34aBA4913A67964f3Df9dAFCc",
        cmt_new_admin: "0xfbDBb09C82E05D7ebc7d26D5bfCe325082D8294b",
        cmt_new_owner: "0xE64ff54eB33be3b9b97A224813D61ADc722d509a",
    }
};
