const {ethers, upgrades} = require("hardhat");

const proxyAddress = '0x6399Ae293a1F56EAD4C4bFc836135D6c2BcDe015'

async function main() {
    console.log("Input proxy address", proxyAddress)

    const CMTStaking = await ethers.getContractFactory("CMTStaking")
    console.log("Deploying...")
    const proxy = await upgrades.upgradeProxy(proxyAddress, CMTStaking)
    await proxy.deployed();
    
    const implAddress = await upgrades.erc1967.getImplementationAddress(proxy.address)
    console.log("Implementation address", implAddress)
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
