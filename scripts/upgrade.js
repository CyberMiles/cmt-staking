const { ethers, upgrades, run } = require("hardhat");

const proxyAddress = '0xce65f24445068782d0B6B70d8bA3eA4C82504ef2'

async function main() {
    // upgrade proxy
    console.log("Input proxy address", proxyAddress)

    // new implementation
    const CMTStakingMock = await ethers.getContractFactory('CMTStakingMock');
    const MIN_STAKE_AMOUNT = ethers.utils.parseEther('0.0001');
    const MIN_WITHDRAW_AMOUNT = ethers.utils.parseEther('0.0001');
    const constructorParams = [MIN_STAKE_AMOUNT, MIN_WITHDRAW_AMOUNT];
    console.log("Upgrading ...");
    console.log(`Constructor params: ${constructorParams}`);
    const proxy = await upgrades.upgradeProxy(proxyAddress, CMTStakingMock, { kind: 'uups', constructorArgs: constructorParams, unsafeAllow: ['state-variable-immutable'] })
    console.log("Waiting for upgraded ...")
    await proxy.deployed();

    const implAddress = await upgrades.erc1967.getImplementationAddress(proxy.address)
    console.log("Implementation address", implAddress)

    try {
        await run("verify:verify", {
            address: implAddress,
            constructorArguments: constructorParams
        });
    } catch (error) {
        console.log(error);
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
