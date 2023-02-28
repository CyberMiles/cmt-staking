const { ethers, upgrades, run } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString());

    const CMTStaking = await ethers.getContractFactory('CMTStaking');
    const ownerAddr = '0x945e9704D2735b420363071bB935ACf2B9C4b814';
    const initValidatorAddr = '0x945e9704D2735b420363071bB935ACf2B9C4b814';
    const initializeParams = [ownerAddr, initValidatorAddr];
    const MIN_STAKE_AMOUNT = ethers.utils.parseEther('0.0001');
    const MIN_WITHDRAW_AMOUNT = ethers.utils.parseEther('0.0001');
    const constructorParams = [MIN_STAKE_AMOUNT, MIN_WITHDRAW_AMOUNT];
    console.log("Deploying ...");
    console.log(`Initialize params: ${initializeParams}`);
    console.log(`Constructor params: ${constructorParams}`);
    const proxy = await upgrades.deployProxy(CMTStaking, initializeParams, { initializer: 'initialize', kind: 'uups', constructorArgs: constructorParams, unsafeAllow: ['state-variable-immutable'] })

    console.log("Proxy address", proxy.address)
    console.log("Waiting for deployed ...")
    await proxy.deployed();

    const implAddress = await upgrades.erc1967.getImplementationAddress(proxy.address)
    console.log("Implementation address", implAddress)

    try {
        await run("verify:verify", {
            address: proxy.address,
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
