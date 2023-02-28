const { ethers } = require("hardhat");

async function main() {
    const [owner] = await ethers.getSigners();
    console.log("Operate contracts with the account:", owner.address);
    console.log("Account balance:", (await owner.getBalance()).toString());

    const CMTStakingAddress = "0xe5B22d8240F479f34aBA4913A67964f3Df9dAFCc";
    const cmtStaking = await ethers.getContractAt('CMTStaking', CMTStakingAddress);

    const ONE_DAY = 60 * 60 * 24;
    console.log(`set lock period to ${ONE_DAY}...`)
    const tx = await cmtStaking.setLockPeriod(ONE_DAY);
    const confirm = await tx.wait()
    console.log(confirm);
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
