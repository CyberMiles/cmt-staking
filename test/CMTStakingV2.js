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

        const CMTStakingMock = await ethers.getContractFactory('CMTStakingV2Mock');
        const newImpl = await CMTStakingMock.deploy(MINSTAKEAMOUNT);
        await newImpl.deployed();

        return { cmtStaking, owner, normalUser, validator1, addrs, newImpl };
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

            const allActiveValidators = await cmtStaking.activeValidators();
            expect(allActiveValidators.length).to.equal(validatorLimit);

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

    describe('Upgrade test', function () {
        it('cannot initialize twice', async function () {
            const { cmtStaking, normalUser } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(normalUser).initialize(normalUser.address, normalUser.address)).to.be.revertedWith('Initializable: contract is already initialized');
        })

        it('only owner can upgrade', async function () {
            const { cmtStaking, newImpl, normalUser } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(normalUser).upgradeTo(newImpl.address)).to.be.revertedWith('Ownable: caller is not the owner');
        })

        it('upgrade to version 2', async function () {
            const { cmtStaking, newImpl, owner } = await loadFixture(deployTokenFixture);
            expect(await newImpl.getVersion()).to.equal(2);
            await cmtStaking.connect(owner).upgradeTo(newImpl.address);
            expect(await cmtStaking.getVersion()).to.equal(2);
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

            // after pool update, compare the real distribution block and calculated distribution block
            // they should be the same
            expect(await cmtStaking.distributionBlock()).to.equal(distributionBlock);

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

        it('cannot stake amount less than mim stake amount', async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = ethers.utils.parseEther('0.000001');
            expect(await cmtStaking.MIN_STAKE_AMOUNT()).to.equal(MINSTAKEAMOUNT);
            await expect(cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount })).to.be.revertedWith('Stake amount must >= MIN_STAKE_AMOUNT.');
        })

        it('cannot stake on a invalid validator', async function () {
            const { cmtStaking, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const validator = addrs[1];
            const stakeAmount = ethers.utils.parseEther('1');
            expect(await cmtStaking.isActiveValidator(validator.address)).to.false;
            await expect(cmtStaking.connect(staker).stake(validator.address, { value: stakeAmount })).to.be.revertedWith('Validator not exist or has been removed.');
        })

        it('same staker is able to stake multi times', async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = ethers.utils.parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            const sInfo = await cmtStaking.stakeTable(validator1.address, staker.address);
            expect(sInfo.stakeAmount).to.equal(stakeAmount.mul(2));
        })

        it('staker does not exist when unstake', async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = ethers.utils.parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            const unstaker = addrs[1];
            await expect(cmtStaking.connect(unstaker).unstake(validator1.address, stakeAmount, staker.address)).to.be.revertedWith('Stake record not found.');
        })

        it('cannot unstake more than staked amount', async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = ethers.utils.parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            await cmtStaking.connect(staker).unstake(validator1.address, 0, staker.address);
            await expect(cmtStaking.connect(staker).unstake(validator1.address, stakeAmount.add(ethers.utils.parseEther('0.1')), staker.address)).to.be.revertedWith('Insufficient balance.');
        })

        it('validator cannot withdraw 0 reward or more than it has', async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = ethers.utils.parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            await expect(cmtStaking.connect(validator1).validatorWithdraw(validator1.address, stakeAmount)).to.be.revertedWith('Invalid amount or insufficient balance.');
            await expect(cmtStaking.connect(validator1).validatorWithdraw(validator1.address, 0)).to.be.revertedWith('Invalid amount or insufficient balance.');
        })

        it("failed to send native token if contract balance is insufficient", async function () {
            const { cmtStaking, validator1, addrs, owner } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = ethers.utils.parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            // travel to 1 day later
            const blocksInJan = 60 * 60 * 24 * 31;
            await mine(blocksInJan);

            // unstake
            await expect(cmtStaking.connect(staker).unstake(validator1.address, stakeAmount, staker.address)).to.be.revertedWith("Failed to send native token.");
        })

        it("staker cannot get reward if the staking's validator get deactivated (unstake after distribution)", async function () {
            const { cmtStaking, validator1, addrs, owner } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = ethers.utils.parseEther('1');
            let tx = await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });
            let confirm = await tx.wait();

            // travel to 1 day later
            const ONE_DAY_BLOCK = 60 * 60 * 24;
            await mine(ONE_DAY_BLOCK);

            // add one more validator to avoid error of Validators should be at least 1.
            const validator2 = addrs[1];
            await cmtStaking.connect(owner).addValidator(validator2.address);

            // deactivate validator1
            tx = await cmtStaking.connect(owner).removeValidator(validator1.address);
            confirm = await tx.wait();
            expect(await cmtStaking.isActiveValidator(validator1.address)).to.be.false;

            // travel to 1 month later
            const blocksInJan = 60 * 60 * 24 * 31;
            await mine(blocksInJan);

            // unstake
            const calcRewards = 5 * (ONE_DAY_BLOCK + 2);
            const miner = addrs[1];
            await setBalance(miner.address, ethers.utils.parseEther((calcRewards + 1).toString()));
            await miner.sendTransaction({
                to: cmtStaking.address,
                value: ethers.utils.parseEther(calcRewards.toString())
            })

            const calcStakerRewards = 4 * (ONE_DAY_BLOCK + 2);
            const estStakerRewards = await cmtStaking.estimatedRewards(validator1.address, staker.address);
            expect(estStakerRewards.dist).to.equal(ethers.utils.parseEther(calcStakerRewards.toString()));
            expect(estStakerRewards.locked).to.equal(0);

            const stakerReceiver = addrs[2];
            const balanceBefore = await stakerReceiver.getBalance();
            tx = await cmtStaking.connect(staker).unstake(validator1.address, stakeAmount, stakerReceiver.address);
            confirm = await tx.wait();
            const balanceAfter = await stakerReceiver.getBalance();
            const stakerUnstakeAmount = balanceAfter.sub(balanceBefore);
            expect(stakerUnstakeAmount).to.equal(stakeAmount.add(estStakerRewards.dist).mul(99).div(100));

            sInfo = await cmtStaking.stakeTable(validator1.address, staker.address);
            expect(sInfo.distReward).to.equal(0);
            expect(sInfo.stakeAmount).to.equal(0);

            // validator1 withdraw rewards
            const validatorRewardReceiver = addrs[3];
            const validatorReceiverBalanceBefore = await validatorRewardReceiver.getBalance();
            const calcValidatorDistReward = 1 * (ONE_DAY_BLOCK + 2);
            tx = await cmtStaking.connect(validator1).validatorWithdraw(validatorRewardReceiver.address, ethers.utils.parseEther(calcValidatorDistReward.toString()));
            confirm = await tx.wait();
            const validatorReceiverBalanceAfter = await validatorRewardReceiver.getBalance();
            expect(validatorReceiverBalanceAfter.sub(validatorReceiverBalanceBefore)).to.equal(ethers.utils.parseEther(calcValidatorDistReward.toString()));
            vInfo = await cmtStaking.stakeTable(ethers.constants.AddressZero, validator1.address);
            expect(vInfo.distReward).to.equal(0);
            expect(vInfo.stakeAmount).to.equal(0);
        })


        it("staker cannot get reward if the staking's validator get deactivated (unstake before distribution)", async function () {
            const { cmtStaking, validator1, addrs, owner } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = ethers.utils.parseEther('1');
            let tx = await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });
            let confirm = await tx.wait();

            // travel to 1 day later
            const ONE_DAY_BLOCK = 60 * 60 * 24;
            await mine(ONE_DAY_BLOCK);

            // add one more validator to avoid error of Validators should be at least 1.
            const validator2 = addrs[1];
            await cmtStaking.connect(owner).addValidator(validator2.address);

            // deactivate validator1
            tx = await cmtStaking.connect(owner).removeValidator(validator1.address);
            confirm = await tx.wait();
            expect(await cmtStaking.isActiveValidator(validator1.address)).to.be.false;

            // travel to 1 day later
            await mine(ONE_DAY_BLOCK);

            // unstake
            const calcRewards = 5 * (ONE_DAY_BLOCK + 2);
            const miner = addrs[1];
            await setBalance(miner.address, ethers.utils.parseEther((calcRewards + 1).toString()));
            await miner.sendTransaction({
                to: cmtStaking.address,
                value: ethers.utils.parseEther(calcRewards.toString())
            })

            const calcStakerRewards = 4 * (ONE_DAY_BLOCK + 2);
            const estStakerRewards = await cmtStaking.estimatedRewards(validator1.address, staker.address);
            expect(estStakerRewards.dist).to.equal(0);
            expect(estStakerRewards.locked).to.equal(ethers.utils.parseEther(calcStakerRewards.toString()));

            const stakerReceiver = addrs[2];
            const balanceBefore = await stakerReceiver.getBalance();
            tx = await cmtStaking.connect(staker).unstake(validator1.address, stakeAmount, stakerReceiver.address);
            confirm = await tx.wait();
            const balanceAfter = await stakerReceiver.getBalance();
            const stakerUnstakeAmount = balanceAfter.sub(balanceBefore);
            expect(stakerUnstakeAmount).to.equal(stakeAmount.mul(99).div(100));

            sInfo = await cmtStaking.stakeTable(validator1.address, staker.address);
            expect(sInfo.distReward).to.equal(0);
            expect(sInfo.lockedReward).to.equal(ethers.utils.parseEther(calcStakerRewards.toString()));
            expect(sInfo.stakeAmount).to.equal(0);

            // validator1 withdraw rewards
            const validatorRewardReceiver = addrs[3];
            const calcValidatorReward = 1 * (ONE_DAY_BLOCK + 2);
            // because the distReward = 0 yet.
            await expect(cmtStaking.connect(validator1).validatorWithdraw(validatorRewardReceiver.address, ethers.utils.parseEther(calcValidatorReward.toString()))).to.be.revertedWith('Invalid amount or insufficient balance.');
            vInfo = await cmtStaking.stakeTable(ethers.constants.AddressZero, validator1.address);
            expect(vInfo.distReward).to.equal(0);
            expect(vInfo.lockedReward).to.equal(ethers.utils.parseEther(calcValidatorReward.toString()));
            expect(vInfo.stakeAmount).to.equal(0);
        })

        it("accumulative unit rewards", async function () {
            const { cmtStaking, validator1, addrs, owner } = await loadFixture(deployTokenFixture);
            AUR_PREC = ethers.BigNumber.from('1000000000000000000');

            const staker0 = addrs[0];
            const stakeAmount = ethers.utils.parseEther('1');
            await cmtStaking.connect(staker0).stake(validator1.address, { value: stakeAmount });

            let sPool = await cmtStaking.stakerPool();
            expect(sPool.lastAUR).to.equal(0);
            expect(sPool.distAUR).to.equal(0);

            // travel to 1 day later
            const ONE_DAY_BLOCK = 60 * 60 * 24;
            await mine(ONE_DAY_BLOCK);

            const staker1 = addrs[1];
            await cmtStaking.connect(staker1).stake(validator1.address, { value: stakeAmount.mul(2) });

            let calcAUR = ethers.utils.parseEther((4 * (ONE_DAY_BLOCK + 1)).toString()).mul(AUR_PREC).div(stakeAmount);
            sPool = await cmtStaking.stakerPool();
            expect(sPool.lastAUR).to.equal(calcAUR);
            expect(sPool.distAUR).to.equal(0);

            let stake1RewardDebt = stakeAmount.mul(2).mul(sPool.lastAUR).div(AUR_PREC);

            // travel to 1 day later
            await mine(ONE_DAY_BLOCK);

            const staker2= addrs[2];
            await cmtStaking.connect(staker2).stake(validator1.address, { value: stakeAmount.mul(3) });

            calcAUR = calcAUR.add(ethers.utils.parseEther((4 * (ONE_DAY_BLOCK + 1)).toString()).mul(AUR_PREC).div(stakeAmount.mul(3)));
            sPool = await cmtStaking.stakerPool();
            expect(sPool.lastAUR).to.equal(calcAUR);
            expect(sPool.distAUR).to.equal(0);

            // travel to 1 day later
            await mine(ONE_DAY_BLOCK);

            // staker1 unstake 1 ether, and 1 ether left
            await cmtStaking.connect(staker1).unstake(validator1.address, stakeAmount, staker1.address);
            calcAUR = calcAUR.add(ethers.utils.parseEther((4 * (ONE_DAY_BLOCK + 1)).toString()).mul(AUR_PREC).div(stakeAmount.mul(6)));
            sPool = await cmtStaking.stakerPool();
            expect(sPool.lastAUR).to.equal(calcAUR);
            expect(sPool.distAUR).to.equal(0);

            let staker1Info = await cmtStaking.stakeTable(validator1.address, staker1.address);
            let staker1Reward = stakeAmount.mul(2).mul(sPool.lastAUR).div(AUR_PREC).sub(stake1RewardDebt);
            stake1RewardDebt = stakeAmount.mul(sPool.lastAUR).div(AUR_PREC);
            expect(staker1Info.rewardDebt).to.equal(stake1RewardDebt);
            expect(staker1Info.lockedReward).to.equal(staker1Reward);
            expect(staker1Info.stakeAmount).to.equal(stakeAmount);
        })
    })
});