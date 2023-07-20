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
    },
    addresses: {
        owner_addr: "0x945e9704D2735b420363071bB935ACf2B9C4b814",
        init_validator_addr: "0x945e9704D2735b420363071bB935ACf2B9C4b814",
        cmt_new_deployed_proxyAddress: "0xA859D61D5789EacCb3300407C17213af124f7472",
        cmt_new_admin: "0x4fbB8D1ef27f325A1656BAd3e2dBEDdd1049d3b3",
        cmt_new_owner: "0x45c71bDE87667c04eB452ba10fBcf6Bb00A4662A",
    }
};
