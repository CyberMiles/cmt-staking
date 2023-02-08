const { ethers, upgrades, run } = require("hardhat");

const proxyAddress = '0x5e6B5EF5C70d0C9970386253224f373eFFb67eE5'

async function main() {
    // upgrade proxy
    console.log("Input proxy address", proxyAddress)

    // new implementation
    const CMTStakingMock = await ethers.getContractFactory('CMTStakingV2Mock');
    const constructorParams = [ethers.utils.parseEther('0.0001')];
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
