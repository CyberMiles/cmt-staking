const { loadFixture, time } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');
const { getTxTs } = require('./helper');

describe('CMTStaking contract', function () {

    const MINSTAKEAMOUNT = ethers.utils.parseEther('0.0001');
    const WRONGMINSTAKEAMOUNT = ethers.utils.parseUnits('0.1', 'gwei');

    async function deployTokenFixture() {
        const [owner, normalUser, validator1, ...addrs] = await ethers.getSigners();
        const CMTStaking = await ethers.getContractFactory('CMTStaking');
        await expect(upgrades.deployProxy(CMTStaking, [validator1.address], { initializer: 'initialize', kind: 'uups', constructorArgs: [WRONGMINSTAKEAMOUNT], unsafeAllow: ['state-variable-immutable'] })).to.be.revertedWith('Invalid minimal stake amount.');
        const cmtStaking = await upgrades.deployProxy(CMTStaking, [validator1.address], { initializer: 'initialize', kind: 'uups', constructorArgs: [MINSTAKEAMOUNT], unsafeAllow: ['state-variable-immutable'] })
        await cmtStaking.deployed();

        const CMTStakingMock = await ethers.getContractFactory('CMTStakingMock');
        const newImpl = await CMTStakingMock.deploy(MINSTAKEAMOUNT);
        await newImpl.deployed();
        return { cmtStaking, newImpl, owner, normalUser, validator1, addrs };
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

            const validator = await cmtStaking.validators(validator1.address);
            expect(validator.validatorAddr).to.equal(validator1.address);
            expect(validator.stakingAmount).to.equal(0);
            expect(validator.rewardAmount).to.equal(0);
            expect(validator.isValid).to.true;
            expect(validator.validChangeTime).not.equal(0);

            expect(await cmtStaking.totalValidatorCount()).to.equal(1);
            expect(await cmtStaking.activatedValidatorCount()).to.equal(1);
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
                expect(await cmtStaking.totalValidatorCount()).to.equal(i + 2);
                expect(await cmtStaking.activatedValidatorCount()).to.equal(i + 2);
            }
            // 添加第(validatorLimit + 1)个validator
            await expect(cmtStaking.connect(owner).addValidator(addrs[i].address)).to.be.revertedWith('Validators are full.');
        })

        it('cannot repeat adding same validator', async function () {
            const { cmtStaking, owner, validator1 } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(owner).addValidator(validator1.address)).to.be.revertedWith('Validator had been added');
        })

        it('only owner can remove validator', async function () {
            const { cmtStaking, normalUser } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(normalUser).removeValidator(normalUser.address)).to.be.revertedWith('Ownable: caller is not the owner');
        })

        it('keep at least 1 validator', async function () {
            const { cmtStaking, owner, validator1 } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(owner).removeValidator(validator1.address)).to.be.revertedWith('Validators should be at least 1.');
        })

        it('cannot remove not existed validator and cannot remove a validator more than once', async function () {
            const { cmtStaking, validator1, owner, addrs } = await loadFixture(deployTokenFixture);
            let i;
            // added 2 validators, has total 3 validators
            for (i = 0; i < 2; i++) {
                await cmtStaking.connect(owner).addValidator(addrs[i].address);
                expect(await cmtStaking.totalValidatorCount()).to.equal(i + 2);
                expect(await cmtStaking.activatedValidatorCount()).to.equal(i + 2);
            }
            // cannot remove addrs[2] because it has not be added yet
            await expect(cmtStaking.connect(owner).removeValidator(addrs[i].address)).to.be.revertedWith('Validator not exist or has been removed.');

            // remove validator1
            await cmtStaking.connect(owner).removeValidator(validator1.address);
            expect(await cmtStaking.totalValidatorCount()).to.equal(3);
            // only activatedValidator decreased when remove validator
            expect(await cmtStaking.activatedValidatorCount()).to.equal(2);

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
    })

    describe('Upgrade test', function () {
        it('cannot initialize twice', async function () {
            const { cmtStaking, normalUser } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(normalUser).initialize(normalUser.address)).to.be.revertedWith('Initializable: contract is already initialized');
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
        it('staker get 6% and validator get 2% awards of staked amount', async function () {
            const { cmtStaking, owner, validator1, addrs } = await loadFixture(deployTokenFixture);

            const staker = addrs[0];
            const initialBalance = ethers.utils.parseEther('10000');
            expect(await staker.getBalance()).to.equal(initialBalance);

            // stake
            const stakeAmount = ethers.utils.parseEther('1');
            let tx = await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });
            const stakeTs = await getTxTs(tx.hash);
            expect(await ethers.provider.getBalance(cmtStaking.address)).to.equal(stakeAmount);

            let validatorInfo = await cmtStaking.validators(validator1.address);
            expect(validatorInfo.stakingAmount).to.equal(stakeAmount);

            let stakerInfo = await cmtStaking.stakers(staker.address);
            expect(stakerInfo.stakerAddr).to.equal(staker.address);
            expect(stakerInfo.stakingAmount).to.equal(stakeAmount);

            let stakingRecordInfo = await cmtStaking.stakingRecords(staker.address, validator1.address, 0);
            expect(stakingRecordInfo.stakerAddr).to.equal(staker.address);
            expect(stakingRecordInfo.validatorAddr).to.equal(validator1.address);
            expect(stakingRecordInfo.stakingAmount).to.equal(stakeAmount);
            expect(stakingRecordInfo.stakingTime).to.equal(stakeTs);
            expect(stakingRecordInfo.unstakingTime).to.equal(0);

            // travel to 1 day later
            const ONE_DAY = 60 * 60 * 24;
            await time.increase(ONE_DAY - 2);

            // estimate rewards
            const estimateUntakeTs = stakeTs + ONE_DAY;
            const estimatedValidatorReward = stakeAmount.mul(estimateUntakeTs - stakeTs).mul(2).div(ONE_DAY * 100 * 365);
            const estimatedStakerReward = stakeAmount.mul(estimateUntakeTs - stakeTs).mul(6).div(ONE_DAY * 100 * 365);
            const estimatedTotalReward = estimatedValidatorReward.add(estimatedStakerReward);

            // miner transfer token to contract
            const miner = addrs[1];
            await miner.sendTransaction({
                to: cmtStaking.address,
                value: estimatedTotalReward
            })
            expect(await ethers.provider.getBalance(cmtStaking.address)).to.equal(stakeAmount.add(estimatedTotalReward));

            // unstake
            const stakerReceiver = addrs[2];
            const stakerReceiverBalanceBefore = await stakerReceiver.getBalance();
            tx = await cmtStaking.connect(staker).unstake(validator1.address, 0, stakerReceiver.address);
            const stakerReceiverBalanceAfter = await stakerReceiver.getBalance();

            // calculate unstakeAmount after fee
            const unstakeAmount = stakeAmount.add(estimatedStakerReward).mul(99).div(100);

            expect(stakerReceiverBalanceAfter.sub(stakerReceiverBalanceBefore)).to.equal(unstakeAmount);

            validatorInfo = await cmtStaking.validators(validator1.address);
            expect(validatorInfo.stakingAmount).to.equal(0);
            expect(validatorInfo.rewardAmount).to.equal(estimatedValidatorReward);

            stakingRecordInfo = await cmtStaking.stakingRecords(staker.address, validator1.address, 0);
            expect(stakingRecordInfo.unstakingTime).to.equal(estimateUntakeTs);

            // total reward 8% of stake amount
            const totalReward = stakeAmount.mul(estimateUntakeTs - stakeTs).mul(8).div(ONE_DAY * 100 * 365);
            expect(estimatedTotalReward).to.equal(totalReward);

            // validator get reward
            const validatorRewardReceiver = addrs[3];
            expect(await ethers.provider.getBalance(validatorRewardReceiver.address)).to.equal(initialBalance);
            await cmtStaking.connect(validator1).validatorWithdraw(validatorRewardReceiver.address, estimatedValidatorReward);
            validatorInfo = await cmtStaking.validators(validator1.address);
            expect(validatorInfo.rewardAmount).to.equal(0);
            expect(await ethers.provider.getBalance(validatorRewardReceiver.address)).to.equal(initialBalance.add(estimatedValidatorReward));

            // owner withdraw fee
            const feeCollector = addrs[4];
            expect(await ethers.provider.getBalance(feeCollector.address)).to.equal(initialBalance);
            const fee = stakeAmount.add(estimatedStakerReward).sub(unstakeAmount);
            await cmtStaking.connect(owner).withdrawFee(feeCollector.address, fee);
            expect(await ethers.provider.getBalance(feeCollector.address)).to.equal(initialBalance.add(fee));
            expect(await ethers.provider.getBalance(cmtStaking.address)).to.equal(0);
        })

        it('cannot stake amount less than mim stake amount', async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = ethers.utils.parseEther('0.000001');
            expect(await cmtStaking.MIN_STAKE_AMOUNT()).to.equal(MINSTAKEAMOUNT);
            await expect(cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount })).to.be.revertedWith('Staking amount must >= MIN_STAKE_AMOUNT.');
        })

        it('cannot stake on a invalid validator', async function () {
            const { cmtStaking, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const validator = addrs[1];
            const stakeAmount = ethers.utils.parseEther('1');
            const validatorInfo = await cmtStaking.validators(validator.address);
            expect(validatorInfo.isValid).to.false;
            await expect(cmtStaking.connect(staker).stake(validator.address, { value: stakeAmount })).to.be.revertedWith('Validator not exist or has been removed.');
        })

        it('same staker is able to stake multi times', async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = ethers.utils.parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            const stakerInfo = await cmtStaking.stakers(staker.address);
            expect(stakerInfo.stakerAddr).to.equal(staker.address);
            expect(stakerInfo.stakingAmount).to.equal(stakeAmount.mul(2));
        })

        it('staker does not exist when unstake', async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = ethers.utils.parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            const unstaker = addrs[1];
            // Panic code 0x32: Array accessed at an out-of-bounds or negative index
            await expect(cmtStaking.connect(unstaker).unstake(validator1.address, 0, staker.address)).to.be.revertedWithPanic(0x32);
        })

        it('cannot unstake twice', async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = ethers.utils.parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            await cmtStaking.connect(staker).unstake(validator1.address, 0, staker.address);
            await expect(cmtStaking.connect(staker).unstake(validator1.address, 0, staker.address)).to.be.revertedWith('Staking record is already unstaked.');
        })

        it('validator cannot withdraw 0 reward or more than it has', async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = ethers.utils.parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });
            await cmtStaking.connect(staker).unstake(validator1.address, 0, staker.address);

            const validatorInfo = await cmtStaking.validators(validator1.address);
            const validatorAward = validatorInfo.rewardAmount;
            await expect(cmtStaking.connect(validator1).validatorWithdraw(validator1.address, validatorAward.add(1))).to.be.revertedWith('Invalid amount or insufficient balance.');
            await expect(cmtStaking.connect(validator1).validatorWithdraw(validator1.address, 0)).to.be.revertedWith('Invalid amount or insufficient balance.');
        })

        it("staker cannot get reward if the stake record's validator get deactivated", async function () {
            const { cmtStaking, validator1, addrs, owner } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = ethers.utils.parseEther('1');
            let tx = await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });
            const stakeTs = await getTxTs(tx.hash);

            // travel to 1 day later
            const ONE_DAY = 60 * 60 * 24;
            await time.increase(ONE_DAY - 2);

            // add one more validator to avoid error of Validators should be at least 1.
            const validator2 = addrs[1];
            await cmtStaking.addValidator(validator2.address);

            // deactivate validator1
            tx = await cmtStaking.connect(owner).removeValidator(validator1.address);
            const deactivateTs = await getTxTs(tx.hash);
            let validatorInfo = await cmtStaking.validators(validator1.address);
            expect(validatorInfo.isValid).to.be.false;
            expect(validatorInfo.validChangeTime).to.equal(stakeTs + ONE_DAY);


            // travel to 2 days later
            await time.increase(ONE_DAY - 1);

            // unstake
            const stakerReceiver = addrs[1];
            const balanceBefore = await stakerReceiver.getBalance();
            tx = await cmtStaking.connect(staker).unstake(validator1.address, 0, stakerReceiver.address);
            const balanceAfter = await stakerReceiver.getBalance();
            const stakerUnstakeAmount = balanceAfter.sub(balanceBefore);
            const unstakeTs = await getTxTs(tx.hash);

            expect(deactivateTs - stakeTs).to.equal(ONE_DAY);
            expect(unstakeTs - deactivateTs).to.equal(ONE_DAY);

            validatorInfo = await cmtStaking.validators(validator1.address);
            expect(validatorInfo.stakingAmount).to.equal(0);
            // validator reward 2% of stake amount from stake timestamp to validator deactivate timestamp
            const validatorReward = stakeAmount.mul(deactivateTs - stakeTs).mul(2).div(ONE_DAY * 100 * 365);
            expect(validatorInfo.rewardAmount).to.equal(validatorReward);

            stakerInfo = await cmtStaking.stakers(staker.address);
            expect(stakerInfo.stakingAmount).to.equal(0);
            // validator reward 6% of stake amount from stake timestamp to validator deactivate timestamp
            const stakerReward = stakeAmount.mul(deactivateTs - stakeTs).mul(6).div(ONE_DAY * 100 * 365);
            expect(stakerUnstakeAmount).to.equal(stakeAmount.add(stakerReward).mul(99).div(100));
        })

        it("failed to send native token if contract balance is insufficient", async function () {
            const { cmtStaking, validator1, addrs, owner } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = ethers.utils.parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            // travel to 100 day later
            const ONE_HUNDRED_DAY = 60 * 60 * 24 * 100;
            await time.increase(ONE_HUNDRED_DAY - 1);

            // unstake
            await expect(cmtStaking.connect(staker).unstake(validator1.address, 0, staker.address)).to.be.revertedWith("Failed to send native token.");
        })
    })
});