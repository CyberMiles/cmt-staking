const { ethers, upgrades, run } = require("hardhat");
const config = require("../hardhat.config");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString());

    const CMTStaking = await ethers.getContractFactory('CMTStaking');
    const ownerAddr = config.addresses.owner_addr;
    const initValidatorAddr = config.addresses.init_validator_addr;
    const initializeParams = [ownerAddr, initValidatorAddr];
    console.log("Deploying ...");
    console.log(`Initialize params: ${initializeParams}`);
    const proxy = await upgrades.deployProxy(CMTStaking, initializeParams, { initializer: 'initialize', kind: 'uups', constructorArgs: [], unsafeAllow: ['state-variable-immutable'] })

    console.log("Proxy address", proxy.address)
    console.log("Waiting for deployed ...")
    await proxy.deployed();

    const implAddress = await upgrades.erc1967.getImplementationAddress(proxy.address)
    console.log("Implementation address", implAddress)

    try {
        await run("verify:verify", {
            address: proxy.address,
            constructorArguments: []
        });
    } catch (error) {
        console.log(error);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
