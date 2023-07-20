const { ethers, upgrades, run } = require("hardhat");
const config = require("../hardhat.config");

const proxyAddress = config.addresses.cmt_new_deployed_proxyAddress;

async function main() {
    // upgrade proxy
    console.log("Input proxy address", proxyAddress)

    // new implementation
    const CMTStakingMock = await ethers.getContractFactory('CMTStakingMock');
    const constructorParams = [];
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
