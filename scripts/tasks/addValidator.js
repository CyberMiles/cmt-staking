module.exports = async function (_taskArgs, { ethers, network }) {
    console.log(`working on network: ${network.name}`);
    const [owner] = await ethers.getSigners();
    console.log("operate contracts with the account:", owner.address);
    console.log("account balance:", (await owner.getBalance()).toString());

    const CMTStakingAddress = _taskArgs.cmtContract;
    const cmtStaking = await ethers.getContractAt('CMTStaking', CMTStakingAddress);

    console.log(`talking to cmt proxy ${CMTStakingAddress}`);
    console.log(`add new validator ${_taskArgs.validatorAddress}...`)
    const tx = await cmtStaking.addValidator(_taskArgs.validatorAddress);
    const confirm = await tx.wait();
    console.log(`Transaction ${confirm.transactionHash} succeed with gasUsed ${confirm.gasUsed}`);
}