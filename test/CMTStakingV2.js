const { loadFixture, time, mine, setBalance } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

const { utils, constants, getSigners, getContractFactory, provider, BigNumber} = ethers;
const { parseEther, parseUnits } = utils;
const { AddressZero } = constants;
const { getBalance } = provider;

describe('CMTStakingV2 contract', function () {

    const MIN_STAKE_AMOUNT = parseEther('0.0001');
    const WRONG_MIN_STAKE_AMOUNT = parseUnits('0.1', 'gwei');
    const ONE_DAY_BLOCKS = 60 * 60 * 24;
    const JAN_BLOCKS = ONE_DAY_BLOCKS * 31;
    const STAKER_REWARD_PER_BLOCK = parseEther('4');
    const VALIDATOR_REWARD_PER_BLOCK = parseEther('1');
    const VALIDATOR_LIMIT = 21;

    async function deployTokenFixture() {

        const [deployer, owner, normalUser, validator1, ...addrs] = await getSigners();
        const CMTStaking = await getContractFactory('CMTStakingV2');
        await expect(upgrades.deployProxy(CMTStaking, [owner.address, validator1.address], { initializer: 'initialize', kind: 'uups', constructorArgs: [WRONG_MIN_STAKE_AMOUNT], unsafeAllow: ['state-variable-immutable'] })).to.be.revertedWith('Invalid minimal stake amount.');
        const cmtStaking = await upgrades.deployProxy(CMTStaking, [owner.address, validator1.address], { initializer: 'initialize', kind: 'uups', constructorArgs: [MIN_STAKE_AMOUNT], unsafeAllow: ['state-variable-immutable'] })
        await cmtStaking.deployed();
        expect(cmtStaking.deployTransaction.from).to.equal(deployer.address);

        const CMTStakingMock = await getContractFactory('CMTStakingV2Mock');
        const newImpl = await CMTStakingMock.deploy(MIN_STAKE_AMOUNT);
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
            expect(await cmtStaking.MIN_STAKE_AMOUNT()).to.equal(MIN_STAKE_AMOUNT);
        })

        it('initialize', async function () {
            const { cmtStaking, owner, validator1 } = await loadFixture(deployTokenFixture);

            expect(await cmtStaking.paused()).to.be.false;
            expect(await cmtStaking.owner()).to.equal(owner.address);
            expect(await cmtStaking.validatorLimit()).to.equal(VALIDATOR_LIMIT);

            expect(await cmtStaking.validatorRewardPerBlock()).to.equal(VALIDATOR_REWARD_PER_BLOCK);
            expect(await cmtStaking.stakerRewardPerBlock()).to.equal(STAKER_REWARD_PER_BLOCK);

            expect(await cmtStaking.isActiveValidator(validator1.address)).to.be.true;
        })
    })

    describe('Owner basis functions test', function () {
        it('only owner can set validator limit', async function () {
            const { cmtStaking, normalUser } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(normalUser).setValidatorLimit(VALIDATOR_LIMIT)).to.be.revertedWith('Ownable: caller is not the owner');
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
            await expect(cmtStaking.connect(owner).addValidator(AddressZero)).to.be.revertedWith('Invalid address.');
        })

        it('keep at most VALIDATOR_LIMIT validators', async function () {
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

        it('cannot add validator who has been removed once', async function () {
            const { cmtStaking, validator1, owner, addrs } = await loadFixture(deployTokenFixture);
            let i;
            // added 2 validators, has total 3 validators
            for (i = 0; i < 2; i++) {
                await cmtStaking.connect(owner).addValidator(addrs[i].address);
            }

            // remove validator1
            await cmtStaking.connect(owner).removeValidator(validator1.address);
            expect(await cmtStaking.isActiveValidator(validator1.address)).to.false;

            // cannot remove validator1 again
            await expect(cmtStaking.connect(owner).addValidator(validator1.address)).to.be.revertedWith('Validator had been added.');
        })

        it('only owner can withdraw fee', async function () {
            const { cmtStaking, normalUser } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(normalUser).withdrawFee(normalUser.address, 1)).to.be.revertedWith('Ownable: caller is not the owner');
        })

        it('withdraw fee address cannot be address 0', async function () {
            const { cmtStaking, owner } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(owner).withdrawFee(AddressZero, 1)).to.be.revertedWith('Invalid address.');
        })

        it('withdraw fee amount should not be 0 or greater than feeUntaken', async function () {
            const { cmtStaking, owner } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(owner).withdrawFee(owner.address, 0)).to.be.revertedWith('Invalid amount or insufficient balance.');
            await expect(cmtStaking.connect(owner).withdrawFee(owner.address, (await cmtStaking.feeUntaken()).add(1))).to.be.revertedWith('Invalid amount or insufficient balance.');
        })

        it('only owner can set reward per block', async function () {
            const { cmtStaking, owner, normalUser } = await loadFixture(deployTokenFixture);
            const newRewardPerBlock = parseEther('10');
            const newStakerRewardPerBlock = parseEther('8');
            const newValidatorRewardPerBlock = parseEther('2');

            await expect(cmtStaking.connect(normalUser).setRewardPerBlock(newRewardPerBlock)).to.be.revertedWith('Ownable: caller is not the owner');

            await cmtStaking.connect(owner).setRewardPerBlock(newRewardPerBlock);
            expect(await cmtStaking.validatorRewardPerBlock()).to.equal(newValidatorRewardPerBlock);
            expect(await cmtStaking.stakerRewardPerBlock()).to.equal(newStakerRewardPerBlock);
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

        it('upgrade to new version', async function () {
            const { cmtStaking, newImpl, owner } = await loadFixture(deployTokenFixture);
            const newVersion = 2;
            expect(await newImpl.getVersion()).to.equal(newVersion);
            await cmtStaking.connect(owner).upgradeTo(newImpl.address);
            expect(await cmtStaking.getVersion()).to.equal(newVersion);
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
            const initialBalance = parseEther('10000');
            expect(await staker.getBalance()).to.equal(initialBalance);

            // ########## stake 1 eth ##########
            const stakeAmount = parseEther('1');
            let tx = await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });
            let confirm =  await tx.wait();
            // contract receive 1 eth
            expect(await getBalance(cmtStaking.address)).to.equal(stakeAmount);

            // check contract state after stake
            let vInfo = await cmtStaking.stakeTable(AddressZero, validator1.address);
            let sInfo = await cmtStaking.stakeTable(validator1.address, staker.address);
            let activeStakeAmount = await cmtStaking.activeStakeAmount();
            let totalStakeAmount = await cmtStaking.totalStakeAmount();
            expect(vInfo.stakeAmount).to.equal(stakeAmount);
            expect(sInfo.stakeAmount).to.equal(stakeAmount);
            expect(activeStakeAmount).to.equal(stakeAmount);
            expect(totalStakeAmount).to.equal(stakeAmount);

            // ########## roll to next month ##########
            // as the local testnet blockchain interval is constantly 1s and it always starts from 2023-01-01
            // roll to next month (Feb) by JAN_BLOCKS blocks
            
            const stakingStartBlock = await time.latestBlock();
            await mine(JAN_BLOCKS);
            expect(await time.latestBlock()).to.equal(stakingStartBlock + JAN_BLOCKS);
            
            // the staker should receive STAKER_REWARD_PER_BLOCK.mul(JAN_BLOCKS) token reward
            const estStakerRewards = await cmtStaking.estimatedRewards(validator1.address, staker.address);
            const calcTotalStakerRewards = STAKER_REWARD_PER_BLOCK.mul(JAN_BLOCKS);
            const estStakerTotalRewards = estStakerRewards.dist.add(estStakerRewards.locked);
            expect(estStakerTotalRewards).to.equal(calcTotalStakerRewards);

            // manually calculate distribution block
            const refBlock = await time.latestBlock();
            const refTimestamp = await time.latest();
            const distributionTime = await cmtStaking.lastDistributionTime();
            const distributionBlock = refBlock - (refTimestamp - distributionTime);

            // check dist reward and locked reward
            const calcLockedRewards = STAKER_REWARD_PER_BLOCK.mul(refBlock - distributionBlock);
            expect(estStakerRewards.locked).to.equal(calcLockedRewards);
            const calcDistRewards = STAKER_REWARD_PER_BLOCK.mul(distributionBlock - stakingStartBlock);
            expect(estStakerRewards.dist).to.equal(calcDistRewards);

            // ########## EOA transfer rewards to contract ##########
            const calcTotalRewards = STAKER_REWARD_PER_BLOCK.add(VALIDATOR_REWARD_PER_BLOCK).mul(JAN_BLOCKS);
            const someExtraForGasFee = parseEther('1');
            const miner = addrs[1];
            await setBalance(miner.address, calcTotalRewards.add(someExtraForGasFee));
            await miner.sendTransaction({
                to: cmtStaking.address,
                value: calcTotalRewards
            })
            expect(await getBalance(cmtStaking.address)).to.equal(stakeAmount.add(calcTotalRewards));
            
            // ########## unstake ##########
            const stakerReceiver = addrs[2];
            const stakerReceiverBalanceBefore = await stakerReceiver.getBalance();
            tx = await cmtStaking.connect(staker).unstake(validator1.address, stakeAmount, stakerReceiver.address);
            confirm = await tx.wait();
            const stakerReceiverBalanceAfter = await stakerReceiver.getBalance();

            // unstake will triggle pool updates and after pool updated, compare the real distribution block and calculated distribution block
            // they should be the same
            expect(await cmtStaking.distributionBlock()).to.equal(distributionBlock);

            // calculate unstakeAmount after fee
            const unstakeAmount = stakeAmount.add(estStakerRewards.dist).mul(99).div(100);
            expect(stakerReceiverBalanceAfter.sub(stakerReceiverBalanceBefore)).to.equal(unstakeAmount);

            // check contract state after unstake
            sInfo = await cmtStaking.stakeTable(validator1.address, staker.address);
            activeStakeAmount = await cmtStaking.activeStakeAmount();
            totalStakeAmount = await cmtStaking.totalStakeAmount();
            expect(activeStakeAmount).to.equal(0);
            expect(totalStakeAmount).to.equal(0);
            expect(sInfo.distReward).to.equal(0);
            expect(sInfo.stakeAmount).to.equal(0);

            // ########## validator get reward ##########
            const validatorRewardReceiver = addrs[3];
            const validatorReceiverBalanceBefore = await validatorRewardReceiver.getBalance();
            const calcValidatorDistReward = VALIDATOR_REWARD_PER_BLOCK.mul(distributionBlock - stakingStartBlock);
            tx = await cmtStaking.connect(validator1).validatorWithdraw(validatorRewardReceiver.address, calcValidatorDistReward);
            confirm = await tx.wait();
            const validatorReceiverBalanceAfter = await validatorRewardReceiver.getBalance();
            expect(validatorReceiverBalanceAfter.sub(validatorReceiverBalanceBefore)).to.equal(calcValidatorDistReward);
            vInfo = await cmtStaking.stakeTable(AddressZero, validator1.address);
            expect(vInfo.distReward).to.equal(0);
            expect(vInfo.stakeAmount).to.equal(0);

            // ########## owner withdraw fee ##########
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
            const stakeAmount = parseEther('0.000001');
            expect(await cmtStaking.MIN_STAKE_AMOUNT()).to.equal(MIN_STAKE_AMOUNT);
            await expect(cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount })).to.be.revertedWith('Stake amount must >= MIN_STAKE_AMOUNT.');
        })

        it('cannot stake on a invalid validator', async function () {
            const { cmtStaking, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const validator = addrs[1];
            const stakeAmount = parseEther('1');
            expect(await cmtStaking.isActiveValidator(validator.address)).to.false;
            await expect(cmtStaking.connect(staker).stake(validator.address, { value: stakeAmount })).to.be.revertedWith('Validator not exist or has been removed.');
        })

        it('same staker is able to stake multi times', async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            const sInfo = await cmtStaking.stakeTable(validator1.address, staker.address);
            expect(sInfo.stakeAmount).to.equal(stakeAmount.mul(2));
        })

        it('staker does not exist when unstake', async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            const unstaker = addrs[1];
            await expect(cmtStaking.connect(unstaker).unstake(validator1.address, stakeAmount, staker.address)).to.be.revertedWith('Stake record not found.');
        })

        it('cannot unstake more than staked amount', async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            await cmtStaking.connect(staker).unstake(validator1.address, 0, staker.address);
            await expect(cmtStaking.connect(staker).unstake(validator1.address, stakeAmount.add(parseEther('0.1')), staker.address)).to.be.revertedWith('Insufficient balance.');
        })

        it('validator cannot withdraw 0 reward or more than it has', async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            await expect(cmtStaking.connect(validator1).validatorWithdraw(validator1.address, stakeAmount)).to.be.revertedWith('Invalid amount or insufficient balance.');
            await expect(cmtStaking.connect(validator1).validatorWithdraw(validator1.address, 0)).to.be.revertedWith('Invalid amount or insufficient balance.');
        })

        it("failed to send native token if contract balance is insufficient", async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            // travel to 1 month later
            await mine(JAN_BLOCKS);

            // unstake
            await expect(cmtStaking.connect(staker).unstake(validator1.address, stakeAmount, staker.address)).to.be.revertedWith("Failed to send native token.");
        })

        it("staker cannot get reward if the staking's validator get deactivated (unstake after distribution)", async function () {
            const { cmtStaking, validator1, addrs, owner } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = parseEther('1');
            let tx = await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });
            let confirm = await tx.wait();

            // travel to 1 day later
            await mine(ONE_DAY_BLOCKS);

            // add one more validator to avoid error as validators should be at least 1.
            const validator2 = addrs[1];
            await cmtStaking.connect(owner).addValidator(validator2.address);

            // deactivate validator1
            tx = await cmtStaking.connect(owner).removeValidator(validator1.address);
            confirm = await tx.wait();
            expect(await cmtStaking.isActiveValidator(validator1.address)).to.be.false;

            // travel to 1 month later
            await mine(JAN_BLOCKS);

            // unstake
            const calcRewards = STAKER_REWARD_PER_BLOCK.add(VALIDATOR_REWARD_PER_BLOCK).mul(ONE_DAY_BLOCKS + 2);
            const someExtraForGasFee = parseEther('1');
            const miner = addrs[1];
            await setBalance(miner.address, calcRewards.add(someExtraForGasFee));
            await miner.sendTransaction({
                to: cmtStaking.address,
                value: calcRewards
            })

            // as validator1 have been deactivated, only the blocks before removeValidator operation get rewarded. 
            const calcStakerRewards = STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS + 2);
            const estStakerRewards = await cmtStaking.estimatedRewards(validator1.address, staker.address);
            expect(estStakerRewards.dist).to.equal(calcStakerRewards);
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
            const calcValidatorDistReward = VALIDATOR_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS + 2);
            tx = await cmtStaking.connect(validator1).validatorWithdraw(validatorRewardReceiver.address, calcValidatorDistReward);
            confirm = await tx.wait();
            const validatorReceiverBalanceAfter = await validatorRewardReceiver.getBalance();
            expect(validatorReceiverBalanceAfter.sub(validatorReceiverBalanceBefore)).to.equal(calcValidatorDistReward);
            vInfo = await cmtStaking.stakeTable(AddressZero, validator1.address);
            expect(vInfo.distReward).to.equal(0);
            expect(vInfo.stakeAmount).to.equal(0);
        })


        it("staker cannot get reward if the staking's validator get deactivated (unstake before distribution)", async function () {
            const { cmtStaking, validator1, addrs, owner } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = parseEther('1');
            let tx = await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });
            let confirm = await tx.wait();

            // travel to 1 day later
            await mine(ONE_DAY_BLOCKS);

            // add one more validator to avoid error of Validators should be at least 1.
            const validator2 = addrs[1];
            await cmtStaking.connect(owner).addValidator(validator2.address);

            // deactivate validator1
            tx = await cmtStaking.connect(owner).removeValidator(validator1.address);
            confirm = await tx.wait();
            expect(await cmtStaking.isActiveValidator(validator1.address)).to.be.false;

            // travel to 1 day later
            await mine(ONE_DAY_BLOCKS);

            // unstake
            const calcRewards = STAKER_REWARD_PER_BLOCK.add(VALIDATOR_REWARD_PER_BLOCK).mul(ONE_DAY_BLOCKS + 2);
            const someExtraForGasFee = parseEther('1');
            const miner = addrs[1];
            await setBalance(miner.address, calcRewards.add(someExtraForGasFee));
            await miner.sendTransaction({
                to: cmtStaking.address,
                value: calcRewards
            })

            const calcStakerRewards = STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS + 2);
            const estStakerRewards = await cmtStaking.estimatedRewards(validator1.address, staker.address);
            expect(estStakerRewards.dist).to.equal(0);
            expect(estStakerRewards.locked).to.equal(calcStakerRewards);

            const stakerReceiver = addrs[2];
            const balanceBefore = await stakerReceiver.getBalance();
            tx = await cmtStaking.connect(staker).unstake(validator1.address, stakeAmount, stakerReceiver.address);
            confirm = await tx.wait();
            const balanceAfter = await stakerReceiver.getBalance();
            const stakerUnstakeAmount = balanceAfter.sub(balanceBefore);
            expect(stakerUnstakeAmount).to.equal(stakeAmount.mul(99).div(100));

            sInfo = await cmtStaking.stakeTable(validator1.address, staker.address);
            expect(sInfo.distReward).to.equal(0);
            expect(sInfo.lockedReward).to.equal(calcStakerRewards);
            expect(sInfo.stakeAmount).to.equal(0);

            // validator1 withdraw rewards
            const validatorRewardReceiver = addrs[3];
            const calcValidatorReward = VALIDATOR_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS + 2);
            // because the distReward = 0 yet.
            await expect(cmtStaking.connect(validator1).validatorWithdraw(validatorRewardReceiver.address, calcValidatorReward)).to.be.revertedWith('Invalid amount or insufficient balance.');
            vInfo = await cmtStaking.stakeTable(AddressZero, validator1.address);
            expect(vInfo.distReward).to.equal(0);
            expect(vInfo.lockedReward).to.equal(calcValidatorReward);
            expect(vInfo.stakeAmount).to.equal(0);
        })

        it("accumulative unit rewards", async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            AUR_PREC = BigNumber.from('1000000000000000000');

            // staker0 stake 1 eth
            const staker0 = addrs[0];
            const stakeAmount = parseEther('1');
            await cmtStaking.connect(staker0).stake(validator1.address, { value: stakeAmount });

            let sPool = await cmtStaking.stakerPool();
            expect(sPool.lastAUR).to.equal(0);
            expect(sPool.distAUR).to.equal(0);

            // travel to 1 day later
            await mine(ONE_DAY_BLOCKS);

            // staker1 stake 2 eth
            const staker1 = addrs[1];
            await cmtStaking.connect(staker1).stake(validator1.address, { value: stakeAmount.mul(2) });

            // accumulation of (rewards in this period / stake amount in this period)
            // as update pool is execute before stake operation, the 2 eth is not counted yet.
            let calcAUR = STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS + 1).mul(AUR_PREC).div(stakeAmount);
            sPool = await cmtStaking.stakerPool();
            expect(sPool.lastAUR).to.equal(calcAUR);
            expect(sPool.distAUR).to.equal(0);

            // as staker1 stakes 2 eth, the stake amount is 2 eth.
            let stake1RewardDebt = stakeAmount.mul(2).mul(sPool.lastAUR).div(AUR_PREC);

            // travel to 1 day later
            await mine(ONE_DAY_BLOCKS);

            // staker2 stake 3 eth
            const staker2= addrs[2];
            await cmtStaking.connect(staker2).stake(validator1.address, { value: stakeAmount.mul(3) });

            calcAUR = calcAUR.add(STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS + 1).mul(AUR_PREC).div(stakeAmount.mul(3)));
            sPool = await cmtStaking.stakerPool();
            expect(sPool.lastAUR).to.equal(calcAUR);
            expect(sPool.distAUR).to.equal(0);

            // travel to 1 day later
            await mine(ONE_DAY_BLOCKS);

            // staker1 unstake 1 ether, and 1 ether left
            await cmtStaking.connect(staker1).unstake(validator1.address, stakeAmount, staker1.address);
            calcAUR = calcAUR.add(STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS + 1).mul(AUR_PREC).div(stakeAmount.mul(6)));
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

        it("users multiple stake, unstak test", async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);

            // staker0: stake 1 eth
            const staker0 = addrs[0];
            const stakeAmount = parseEther('1');
            await cmtStaking.connect(staker0).stake(validator1.address, { value: stakeAmount });

            // for the first 1 day, staker0 will get all rewards, and all rewards are locked yet.
            await mine(ONE_DAY_BLOCKS);
            let estStaker0Rewards = await cmtStaking.estimatedRewards(validator1.address, staker0.address);
            let calcStaker0Rewards0 = STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS);
            expect(estStaker0Rewards.locked).to.equal(calcStaker0Rewards0);
            expect(estStaker0Rewards.dist).to.equal(0);

            // staker1: stake 1 eth
            const staker1 = addrs[1];
            await cmtStaking.connect(staker1).stake(validator1.address, { value: stakeAmount });

            // for the next 1 day, staker0 and staker1 will divide all rewards, and all rewards are locked yet.
            await mine(ONE_DAY_BLOCKS);
            estStaker0Rewards = await cmtStaking.estimatedRewards(validator1.address, staker0.address);
            // tricky part, the block's reward of staker1 staking belongs to staker0, the rest will divided equally
            let calcStaker0Rewards1 = STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS).div(2).add(STAKER_REWARD_PER_BLOCK.mul(1));
            expect(estStaker0Rewards.locked).to.equal(calcStaker0Rewards0.add(calcStaker0Rewards1));
            expect(estStaker0Rewards.dist).to.equal(0);

            let estStaker1Rewards = await cmtStaking.estimatedRewards(validator1.address, staker1.address);
            let calcStaker1Rewards0 = STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS).div(2);
            expect(estStaker1Rewards.locked).to.equal(calcStaker1Rewards0);
            expect(estStaker1Rewards.dist).to.equal(0);

            // staker0 unstake 1 eth. 
            await cmtStaking.connect(staker0).unstake(validator1.address, stakeAmount, staker0.address);

            // for the next 1 day, all rewards belongs to staker1
            await mine(ONE_DAY_BLOCKS);
            estStaker0Rewards = await cmtStaking.estimatedRewards(validator1.address, staker0.address);
            // staker0's rewards are still locked, and there is only rewards for the block of unstake.
            let calcStaker0Rewards2 = STAKER_REWARD_PER_BLOCK.mul(1).div(2);
            expect(estStaker0Rewards.locked).to.equal(calcStaker0Rewards0.add(calcStaker0Rewards1).add(calcStaker0Rewards2));
            expect(estStaker0Rewards.dist).to.equal(0);

            estStaker1Rewards = await cmtStaking.estimatedRewards(validator1.address, staker1.address);
            // staker1 will get all rewards of the day and half reward for the block of unstake.
            let calcStaker1Rewards1 = STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS).add(STAKER_REWARD_PER_BLOCK.mul(1).div(2));
            expect(estStaker1Rewards.locked).to.equal(calcStaker1Rewards0.add(calcStaker1Rewards1));
            expect(estStaker1Rewards.dist).to.equal(0);

            // staker1 unstake 1 eth
            await cmtStaking.connect(staker1).unstake(validator1.address, stakeAmount, staker0.address);

            // for the next 1 day, no rewards generated as no stake amount
            await mine(ONE_DAY_BLOCKS);
            estStaker0Rewards = await cmtStaking.estimatedRewards(validator1.address, staker0.address);
            expect(estStaker0Rewards.locked).to.equal(calcStaker0Rewards0.add(calcStaker0Rewards1).add(calcStaker0Rewards2));
            expect(estStaker0Rewards.dist).to.equal(0);

            estStaker1Rewards = await cmtStaking.estimatedRewards(validator1.address, staker1.address);
            // the block reward of unstake
            let calcStaker1Rewards2 = STAKER_REWARD_PER_BLOCK.mul(1);
            expect(estStaker1Rewards.locked).to.equal(calcStaker1Rewards0.add(calcStaker1Rewards1).add(calcStaker1Rewards2));
            expect(estStaker1Rewards.dist).to.equal(0);

            // staker0 stake 1 eth again
            await cmtStaking.connect(staker0).stake(validator1.address, { value: stakeAmount });

            // staker0 will get all rewards again for the day.
            await mine(ONE_DAY_BLOCKS);

            estStaker0Rewards = await cmtStaking.estimatedRewards(validator1.address, staker0.address);
            let calcStaker0Rewards3 = STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS);
            expect(estStaker0Rewards.locked).to.equal(calcStaker0Rewards0.add(calcStaker0Rewards1).add(calcStaker0Rewards2).add(calcStaker0Rewards3));
            expect(estStaker0Rewards.dist).to.equal(0);

            estStaker1Rewards = await cmtStaking.estimatedRewards(validator1.address, staker1.address);
            expect(estStaker1Rewards.locked).to.equal(calcStaker1Rewards0.add(calcStaker1Rewards1).add(calcStaker1Rewards2));
            expect(estStaker1Rewards.dist).to.equal(0);
        })

        it("user stake again after one month", async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);

            // staker: stake 1 eth
            const staker = addrs[0];
            const stakeAmount = parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            // staker: unstake 1 eth
            await cmtStaking.connect(staker).unstake(validator1.address, stakeAmount, staker.address);

            // run for one month
            await mine(JAN_BLOCKS);

            // staker: stake 1 eth
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });
            let estStakerRewards = await cmtStaking.estimatedRewards(validator1.address, staker.address);

            // only the block of unstake has reward
            const calcStakerRewards = STAKER_REWARD_PER_BLOCK.mul(1);
            expect(estStakerRewards.dist).to.equal(calcStakerRewards);
        })
    })
});