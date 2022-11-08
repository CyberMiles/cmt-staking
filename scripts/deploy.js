const {ethers, upgrades} = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString());

    const CMTStaking = await ethers.getContractFactory("CMTStaking");
    console.log("Deploying...")
    const proxy = await upgrades.deployProxy(CMTStaking, {initializer: 'initialize', kind: 'uups'})

    console.log("Proxy address", proxy.address)
    console.log("Waiting for deployed...")
    await proxy.deployed();

    const implAddress = await upgrades.erc1967.getImplementationAddress(proxy.address)
    console.log("Implementation address", implAddress)
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
