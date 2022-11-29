const { ethers } = require('hardhat');

const feePerc = 1;
const validatorRewardPerc = 2;
const stakerRewardPerc = 6;

const ONE_DAY = 60 * 60 * 24;
const ONE_YEAR = ONE_DAY * 365;
const stakeAmount = ethers.utils.parseEther("1");

async function main() {

    for (let i = 1; i <= 365; i++) {
        const stakeReward = getStakerReward(i * ONE_DAY);
        const unstakeAmount = getUnstakeAmount(stakeReward);
        console.log(`\
time interval: ${i} days
stakeAmount:   ${stakeAmount.toString()}
unstakeAmount: ${unstakeAmount.toString()}\n`);
    }
}

function getStakerReward(stakingInterval) {
    return stakeAmount.mul(stakingInterval).mul(stakerRewardPerc).div(ONE_YEAR * 100);
}

function getUnstakeAmount(stakerReward) {
    return stakeAmount.add(stakerReward).mul(99).div(100);
}


main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
