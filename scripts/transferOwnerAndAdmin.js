const { ethers } = require("hardhat");
const config = require("../hardhat.config");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString());

    const cmtStakingProxy = config.addresses.cmt_new_deployed_proxyAddress;
    const cmtStaking = await ethers.getContractAt("CMTStaking", cmtStakingProxy, deployer);

    let tx;
    // should modify admin first before lost owner privilege
    const curAdmin = await cmtStaking.admin();
    console.log(`cur admin is: ${curAdmin}`);
    const newAdmin = config.addresses.cmt_new_admin;
    console.log(`transfer new admin from ${curAdmin} to ${newAdmin} ...`)
    tx = await cmtStaking.setAdmin(newAdmin);
    confirm = await tx.wait();
    console.log(`cur admin is: ${await cmtStaking.admin()}`);

    const curOwner = await cmtStaking.owner();
    console.log(`cur owner is: ${curOwner}`);
    const newOwner = config.addresses.cmt_new_owner;
    console.log(`transfer ownership from ${curOwner} to ${newOwner} ...`)
    tx = await cmtStaking.transferOwnership(newOwner);
    confirm = await tx.wait();
    console.log(`cur owner is: ${await cmtStaking.owner()}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
