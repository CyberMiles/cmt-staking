const { ethers } = require("hardhat");
const config = require("../hardhat.config");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString());

    const cmtStakingProxy = config.addresses.cmt_new_deployed_proxyAddress;
    const cmtStaking = await ethers.getContractAt("CMTStaking", cmtStakingProxy, deployer);

    let tx;

    const validator = config.addresses.init_validator_addr;
    const unstakeAmount = ethers.utils.parseEther("0.2");
    tx = await cmtStaking.unstake(validator, unstakeAmount)
    confirm = await tx.wait();
    console.log(confirm.transactionHash);

}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
