const {ethers, upgrades} = require("hardhat");

const proxyAddress = '0x68B1D87F95878fE05B998F19b66F4baba5De1aed'

async function main() {
    console.log("Input proxy address", proxyAddress)

    const CMTStaking = await ethers.getContractFactory("CMTStaking")
    console.log("Deploying...")
    const proxy = await upgrades.upgradeProxy(proxyAddress, CMTStaking)

    const implAddress = await upgrades.erc1967.getImplementationAddress(proxy.address)
    console.log("Implementation address", implAddress)
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
