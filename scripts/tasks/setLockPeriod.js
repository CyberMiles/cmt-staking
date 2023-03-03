module.exports = async function (_taskArgs, { ethers, network }) {
    console.log(`working on network: ${network.name}`);
    const [owner] = await ethers.getSigners();
    console.log("Operate contracts with the account:", owner.address);
    console.log("Account balance:", (await owner.getBalance()).toString());

    const CMTStakingAddress = _taskArgs.cmtContract;
    const cmtStaking = await ethers.getContractAt('CMTStaking', CMTStakingAddress);

    console.log(`talking to cmt proxy ${CMTStakingAddress}`);
    console.log(`set lock period to ${_taskArgs.lockPeriod}...`)
    const tx = await cmtStaking.setLockPeriod(_taskArgs.lockPeriod);
    const confirm = await tx.wait();
    console.log(`Transaction ${confirm.transactionHash} succeed with gasUsed ${confirm.gasUsed}`);
}