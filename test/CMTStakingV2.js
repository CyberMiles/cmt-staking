const { loadFixture, time, mine, setBalance } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

describe('CMTStakingV2 contract', function () {

    const MINSTAKEAMOUNT = ethers.utils.parseEther('0.0001');
    const WRONGMINSTAKEAMOUNT = ethers.utils.parseUnits('0.1', 'gwei');

    async function deployTokenFixture() {

        const [deployer, owner, normalUser, validator1, ...addrs] = await ethers.getSigners();
        const CMTStaking = await ethers.getContractFactory('CMTStakingV2');
        await expect(upgrades.deployProxy(CMTStaking, [owner.address, validator1.address], { initializer: 'initialize', kind: 'uups', constructorArgs: [WRONGMINSTAKEAMOUNT], unsafeAllow: ['state-variable-immutable'] })).to.be.revertedWith('Invalid minimal stake amount.');
        const cmtStaking = await upgrades.deployProxy(CMTStaking, [owner.address, validator1.address], { initializer: 'initialize', kind: 'uups', constructorArgs: [MINSTAKEAMOUNT], unsafeAllow: ['state-variable-immutable'] })
        await cmtStaking.deployed();
        expect(cmtStaking.deployTransaction.from).to.equal(deployer.address);

        return { cmtStaking, owner, normalUser, validator1, addrs };
    }

    describe('Basis test', function () {
        it('version', async function () {
            const { cmtStaking } = await loadFixture(deployTokenFixture);
            const version = 1;
            expect(await cmtStaking.getVersion()).to.equal(version);
        });

        it('constructor', async function () {
            const { cmtStaking } = await loadFixture(deployTokenFixture);
            expect(await cmtStaking.MIN_STAKE_AMOUNT()).to.equal(MINSTAKEAMOUNT);
        })

        it('initialize', async function () {
            const { cmtStaking, owner, validator1 } = await loadFixture(deployTokenFixture);

            expect(await cmtStaking.paused()).to.be.false;
            expect(await cmtStaking.owner()).to.equal(owner.address);
            expect(await cmtStaking.validatorLimit()).to.equal(21);

            expect(await cmtStaking.validatorRewardPerBlock()).to.equal(ethers.utils.parseEther('1'));
            expect(await cmtStaking.stakerRewardPerBlock()).to.equal(ethers.utils.parseEther('4'));

            expect(await cmtStaking.isActiveValidator(validator1.address)).to.be.true;
        })
    })

    describe('Owner basis functions test', function () {
        it('only owner can set validator limit', async function () {
            const { cmtStaking, normalUser } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(normalUser).setValidatorLimit(21)).to.be.revertedWith('Ownable: caller is not the owner');
        })

        it('new validator limit should greater or equal activatedValidatorCount', async function () {
            const { cmtStaking, owner } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(owner).setValidatorLimit(0)).to.be.revertedWith('Invalid limit value.');

            const newLimit = 10;
            await cmtStaking.connect(owner).setValidatorLimit(newLimit);
            expect(await cmtStaking.validatorLimit()).to.equal(newLimit);
        })

        it('only owner can add validator', async function () {
            const { cmtStaking, normalUser } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(normalUser).addValidator(normalUser.address)).to.be.revertedWith('Ownable: caller is not the owner');
        })

        it('cannot add zero address as validator', async function () {
            const { cmtStaking, owner } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(owner).addValidator(ethers.constants.AddressZero)).to.be.revertedWith('Invalid address.');
        })

        it('keep at most 21 validators', async function () {
            const { cmtStaking, owner, addrs } = await loadFixture(deployTokenFixture);
            const validatorLimit = await cmtStaking.validatorLimit();
            let i;
            for (i = 0; i < validatorLimit - 1; i++) {
                await cmtStaking.connect(owner).addValidator(addrs[i].address);
            }
            // add the (validatorLimit + 1)th validator
            await expect(cmtStaking.connect(owner).addValidator(addrs[i].address)).to.be.revertedWith('Validators are full.');
        })

        it('cannot repeat adding same validator', async function () {
            const { cmtStaking, owner, validator1 } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(owner).addValidator(validator1.address)).to.be.revertedWith('Validator had been added.');
        })

        it('only owner can remove validator', async function () {
            const { cmtStaking, normalUser } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(normalUser).removeValidator(normalUser.address)).to.be.revertedWith('Ownable: caller is not the owner');
        })

        it('keep at least 1 validator', async function () {
            const { cmtStaking, owner, validator1 } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(owner).removeValidator(validator1.address)).to.be.revertedWith('Cannot remove the only validator.');
        })

        it('cannot remove not existed validator and cannot remove a validator more than once', async function () {
            const { cmtStaking, validator1, owner, addrs } = await loadFixture(deployTokenFixture);
            let i;
            // added 2 validators, has total 3 validators
            for (i = 0; i < 2; i++) {
                await cmtStaking.connect(owner).addValidator(addrs[i].address);
            }
            // cannot remove addrs[2] because it has not be added yet
            await expect(cmtStaking.connect(owner).removeValidator(addrs[i].address)).to.be.revertedWith('Validator not exist or has been removed.');

            // remove validator1
            await cmtStaking.connect(owner).removeValidator(validator1.address);
            expect(await cmtStaking.isActiveValidator(validator1.address)).to.false;

            // cannot remove validator1 again
            await expect(cmtStaking.connect(owner).removeValidator(validator1.address)).to.be.revertedWith('Validator not exist or has been removed.');
        })

        it('only owner can withdraw fee', async function () {
            const { cmtStaking, normalUser } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(normalUser).withdrawFee(normalUser.address, 1)).to.be.revertedWith('Ownable: caller is not the owner');
        })

        it('withdraw fee address cannot be address 0', async function () {
            const { cmtStaking, owner } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(owner).withdrawFee(ethers.constants.AddressZero, 1)).to.be.revertedWith('Invalid address.');
        })

        it('withdraw fee amount should not be 0 or greater than feeUntaken', async function () {
            const { cmtStaking, owner } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(owner).withdrawFee(owner.address, 0)).to.be.revertedWith('Invalid amount or insufficient balance.');
            await expect(cmtStaking.connect(owner).withdrawFee(owner.address, (await cmtStaking.feeUntaken()).add(1))).to.be.revertedWith('Invalid amount or insufficient balance.');
        })

        it('only owner can set reward per block', async function () {
            const { cmtStaking, owner, normalUser } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(normalUser).setRewardPerBlock(ethers.utils.parseEther('10'))).to.be.revertedWith('Ownable: caller is not the owner');

            await cmtStaking.connect(owner).setRewardPerBlock(ethers.utils.parseEther('10'));
            expect(await cmtStaking.validatorRewardPerBlock()).to.equal(ethers.utils.parseEther('2'));
            expect(await cmtStaking.stakerRewardPerBlock()).to.equal(ethers.utils.parseEther('8'));
        })

        it('cannot set 0 reward per block', async function () {
            const { cmtStaking, owner } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(owner).setRewardPerBlock(0)).to.be.revertedWith('Invalid reward per block.');
        })
    })

    describe('Pause test', function () {
        it('only owner can pause and unpanse', async function () {
            const { cmtStaking, normalUser } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(normalUser).unpause()).to.be.revertedWith('Ownable: caller is not the owner');
            await expect(cmtStaking.connect(normalUser).pause()).to.be.revertedWith('Ownable: caller is not the owner');
        })

        it('can pause when only unpaused and vice versa', async function () {
            const { cmtStaking, owner } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(owner).unpause()).to.be.revertedWith('Pausable: not paused');

            await cmtStaking.connect(owner).pause();
            await expect(cmtStaking.connect(owner).pause()).to.be.revertedWith('Pausable: paused');
        })

        it('staker cannot stake when paused', async function () {
            const { cmtStaking, owner, normalUser } = await loadFixture(deployTokenFixture);
            await cmtStaking.connect(owner).pause();
            expect(await cmtStaking.paused()).to.be.true;
            await expect(cmtStaking.connect(normalUser).stake(normalUser.address)).to.be.revertedWith('Pausable: paused');
        })

        it('staker cannot unstake when paused', async function () {
            const { cmtStaking, owner, normalUser } = await loadFixture(deployTokenFixture);
            await cmtStaking.connect(owner).pause();
            expect(await cmtStaking.paused()).to.be.true;
            await expect(cmtStaking.connect(normalUser).unstake(normalUser.address, 1, normalUser.address)).to.be.revertedWith('Pausable: paused');
        })

        it('validator cannot withdraw when paused', async function () {
            const { cmtStaking, owner, validator1 } = await loadFixture(deployTokenFixture);
            await cmtStaking.connect(owner).pause();
            expect(await cmtStaking.paused()).to.be.true;
            await expect(cmtStaking.connect(validator1).validatorWithdraw(validator1.address, 1)).to.be.revertedWith('Pausable: paused');
        })
    })

    describe('Staking and unstaking test', function () {
        it('staker get 4/5 and validator get 1/5 of all awards of staking period', async function () {
            const { cmtStaking, owner, validator1, addrs } = await loadFixture(deployTokenFixture);

            const staker = addrs[0];
            const initialBalance = ethers.utils.parseEther('10000');
            expect(await staker.getBalance()).to.equal(initialBalance);

            // stake 1 eth
            const stakeAmount = ethers.utils.parseEther('1');
            let tx = await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });
            let confirm =  await tx.wait();
            expect(await ethers.provider.getBalance(cmtStaking.address)).to.equal(stakeAmount);

            let vInfo = await cmtStaking.stakeTable(ethers.constants.AddressZero, validator1.address);
            let sInfo = await cmtStaking.stakeTable(validator1.address, staker.address);
            let activeStakeAmount = await cmtStaking.activeStakeAmount();
            let totalStakeAmount = await cmtStaking.totalStakeAmount();
            expect(vInfo.stakeAmount).to.equal(stakeAmount);
            expect(sInfo.stakeAmount).to.equal(stakeAmount);
            expect(activeStakeAmount).to.equal(stakeAmount);
            expect(totalStakeAmount).to.equal(stakeAmount);

            // ========================================= //
            // as the local testnet blockchain interval is constantly 1s
            // roll to next month by (60 * 60 * 24 * 31) blocks
            
            // Assume 4 tokens reward per block, 
            // the staker should receive 4 * 60 * 60 * 24 * 31 token reward)

            const blocksInJan = 60 * 60 * 24 * 31;
            const stakingStartBlock = await time.latestBlock();
            await mine(blocksInJan);
            expect(await time.latestBlock()).to.equal(stakingStartBlock + blocksInJan);

            const estStakerRewards = await cmtStaking.estimatedRewards(validator1.address, staker.address);
            const calcTotalStakerRewards = 4 * blocksInJan;
            const estStakerTotalRewards = estStakerRewards.dist.add(estStakerRewards.locked);
            expect(estStakerTotalRewards).to.equal(ethers.utils.parseEther(calcTotalStakerRewards.toString()));

            const refBlock = await time.latestBlock();
            const refTimestamp = await time.latest();
            const distributionTime = await cmtStaking.lastDistributionTime();
            const distributionBlock = refBlock - (refTimestamp - distributionTime);

            const calcLockedRewards = 4 * (refBlock - distributionBlock);
            expect(estStakerRewards.locked).to.equal(ethers.utils.parseEther(calcLockedRewards.toString()));
            const calcDistRewards = 4 * (distributionBlock - stakingStartBlock);
            expect(estStakerRewards.dist).to.equal(ethers.utils.parseEther(calcDistRewards.toString()));

            // ========================================= //
            // EOA transfer rewards to contract
            const calcTotalRewards = 5 * blocksInJan;
            const miner = addrs[1];
            await setBalance(miner.address, ethers.utils.parseEther(calcTotalRewards.toString()).add(ethers.utils.parseEther('100')));
            await miner.sendTransaction({
                to: cmtStaking.address,
                value: ethers.utils.parseEther(calcTotalRewards.toString())
            })
            expect(await ethers.provider.getBalance(cmtStaking.address)).to.equal(stakeAmount.add(ethers.utils.parseEther(calcTotalRewards.toString())));
            
            // unstake
            const stakerReceiver = addrs[2];
            const stakerReceiverBalanceBefore = await stakerReceiver.getBalance();
            tx = await cmtStaking.connect(staker).unstake(validator1.address, stakeAmount, stakerReceiver.address);
            confirm = await tx.wait();
            const stakerReceiverBalanceAfter = await stakerReceiver.getBalance();

            // calculate unstakeAmount after fee
            const unstakeAmount = stakeAmount.add(estStakerRewards.dist).mul(99).div(100);
            expect(stakerReceiverBalanceAfter.sub(stakerReceiverBalanceBefore)).to.equal(unstakeAmount);

            sInfo = await cmtStaking.stakeTable(validator1.address, staker.address);
            activeStakeAmount = await cmtStaking.activeStakeAmount();
            totalStakeAmount = await cmtStaking.totalStakeAmount();
            expect(activeStakeAmount).to.equal(0);
            expect(totalStakeAmount).to.equal(0);
            expect(sInfo.distReward).to.equal(0);
            expect(sInfo.stakeAmount).to.equal(0);

            // validator get reward
            const validatorRewardReceiver = addrs[3];
            const validatorReceiverBalanceBefore = await validatorRewardReceiver.getBalance();
            const calcValidatorDistReward = 1 * (distributionBlock - stakingStartBlock);
            tx = await cmtStaking.connect(validator1).validatorWithdraw(validatorRewardReceiver.address, ethers.utils.parseEther(calcValidatorDistReward.toString()));
            confirm = await tx.wait();
            const validatorReceiverBalanceAfter = await validatorRewardReceiver.getBalance();
            expect(validatorReceiverBalanceAfter.sub(validatorReceiverBalanceBefore)).to.equal(ethers.utils.parseEther(calcValidatorDistReward.toString()));
            vInfo = await cmtStaking.stakeTable(ethers.constants.AddressZero, validator1.address);
            expect(vInfo.distReward).to.equal(0);
            expect(vInfo.stakeAmount).to.equal(0);

            // owner withdraw fee
            const feeCollector = addrs[4];
            const feeCollectorBalanceBefore = await feeCollector.getBalance();
            const calcFee = stakeAmount.add(estStakerRewards.dist).sub(unstakeAmount);
            tx = await cmtStaking.connect(owner).withdrawFee(feeCollector.address, calcFee);
            confirm = await tx.wait();
            const feeCollectorBalanceAfter = await feeCollector.getBalance();
            expect(feeCollectorBalanceAfter.sub(feeCollectorBalanceBefore)).to.equal(calcFee);
            expect(await cmtStaking.feeUntaken()).to.equal(0);
        })
    })
});