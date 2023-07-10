const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:", deployer.address);
    console.log("Account balance:", (await deployer.getBalance()).toString());

    const cmtStakingProxy = "0xA859D61D5789EacCb3300407C17213af124f7472";
    const cmtStaking = await ethers.getContractAt("CMTStaking", cmtStakingProxy, deployer);

    let tx;
    // should modify admin first before lost owner privilege
    const curAdmin = await cmtStaking.admin();
    console.log(`cur admin is: ${curAdmin}`);
    // cur admin is: 0x945e9704D2735b420363071bB935ACf2B9C4b814
    const newAdmin = "0x4fbB8D1ef27f325A1656BAd3e2dBEDdd1049d3b3";
    console.log(`transfer new admin from ${curAdmin} to ${newAdmin} ...`)
    tx = await cmtStaking.setAdmin(newAdmin);
    confirm = await tx.wait();
    console.log(`cur admin is: ${await cmtStaking.admin()}`);

    const curOwner = await cmtStaking.owner();
    console.log(`cur owner is: ${curOwner}`);
    // cur owner is: 0x945e9704D2735b420363071bB935ACf2B9C4b814
    const newOwner = "0x45c71bDE87667c04eB452ba10fBcf6Bb00A4662A";
    console.log(`transfer ownership from ${curOwner} to ${newOwner} ...`)
    tx = await cmtStaking.transferOwnership(newOwner);
    confirm = await tx.wait();
    console.log(`cur owner is: ${await cmtStaking.owner()}`);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
