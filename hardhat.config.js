require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");

const ALCHEMY_API_KEY = "cKfSSw9dViP7kNXAzXsTS4uUj0EZbKw8";
const GOERLI_PRIVATE_KEY = "d5a1dcf421821e8723119583876c8bbd3e90579b9d27340b8858f954b2dc58a3";
const ETHERSCAN_API_KEY = "QA8SAPQZVKZJ6W684VQZJ3PZH6AB5TX9BA"

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: "0.8.4",
    networks: {
        goerli: {
            url: `https://eth-goerli.alchemyapi.io/v2/${ALCHEMY_API_KEY}`,
            gas: 15000000,
            accounts: [GOERLI_PRIVATE_KEY]
        },
        hardhat: {
            chainId: 1337
        }
    },
    etherscan: {
        apiKey: {
            goerli: `${ETHERSCAN_API_KEY}`
        }
    }
};
