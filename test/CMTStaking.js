const { loadFixture, time, mine, setBalance } = require('@nomicfoundation/hardhat-network-helpers');
const { expect } = require('chai');
const { ethers, upgrades } = require('hardhat');

const { utils, constants, getSigners, getContractFactory, provider, BigNumber } = ethers;
const { parseEther, parseUnits } = utils;
const { AddressZero } = constants;
const { getBalance } = provider;

describe('CMTStaking contract', function () {

    const MIN_STAKE_AMOUNT = parseEther('0.0001');
    const WRONG_MIN_STAKE_AMOUNT = parseUnits('0.1', 'gwei');
    const MIN_WITHDRAW_AMOUNT = parseEther('0.0001');
    const BLOCK_INTERVAL = 6;
    const ONE_DAY = 60 * 60 * 24;
    const ONE_DAY_BLOCKS = 60 * 60 * 24 / BLOCK_INTERVAL;
    const STAKER_REWARD_PER_BLOCK = parseEther('4');
    const VALIDATOR_REWARD_PER_BLOCK = parseEther('1');
    const VALIDATOR_LIMIT = 21;

    async function deployTokenFixture() {

        const [deployer, owner, normalUser, validator1, ...addrs] = await getSigners();
        const CMTStaking = await getContractFactory('CMTStaking');
        await expect(upgrades.deployProxy(CMTStaking, [owner.address, validator1.address], { initializer: 'initialize', kind: 'uups', constructorArgs: [WRONG_MIN_STAKE_AMOUNT, MIN_WITHDRAW_AMOUNT], unsafeAllow: ['state-variable-immutable'] })).to.be.revertedWith('Invalid minimal stake amount.');
        const cmtStaking = await upgrades.deployProxy(CMTStaking, [owner.address, validator1.address], { initializer: 'initialize', kind: 'uups', constructorArgs: [MIN_STAKE_AMOUNT, MIN_WITHDRAW_AMOUNT], unsafeAllow: ['state-variable-immutable'] })
        await cmtStaking.deployed();
        expect(cmtStaking.deployTransaction.from).to.equal(deployer.address);

        const CMTStakingMock = await getContractFactory('CMTStakingMock');
        const newImpl = await CMTStakingMock.deploy(MIN_STAKE_AMOUNT, MIN_WITHDRAW_AMOUNT);
        await newImpl.deployed();

        return { cmtStaking, deployer, owner, normalUser, validator1, addrs, newImpl };
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
            expect(await cmtStaking.MIN_WITHDRAW_AMOUNT()).to.equal(MIN_WITHDRAW_AMOUNT);
        })

        it('initialize', async function () {
            const { cmtStaking, owner, validator1 } = await loadFixture(deployTokenFixture);

            expect(await cmtStaking.paused()).to.be.false;
            expect(await cmtStaking.owner()).to.equal(owner.address);
            expect(await cmtStaking.validatorLimit()).to.equal(VALIDATOR_LIMIT);

            expect(await cmtStaking.validatorRewardPerBlock()).to.equal(VALIDATOR_REWARD_PER_BLOCK);
            expect(await cmtStaking.stakerRewardPerBlock()).to.equal(STAKER_REWARD_PER_BLOCK);

            expect(await cmtStaking.lockPeriod()).to.equal(7 * ONE_DAY);

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

            // cannot add validator1 again
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

        it('only owner can set keeper', async function () {
            const { cmtStaking, normalUser, owner } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(normalUser).setKeeper(normalUser.address)).to.be.revertedWith('Ownable: caller is not the owner');

            await cmtStaking.connect(owner).setKeeper(normalUser.address);
            expect(await cmtStaking.keeper()).to.equal(normalUser.address);
        })

        it('new keeper cannot be zero address', async function () {
            const { cmtStaking, owner } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(owner).setKeeper(constants.AddressZero)).to.be.revertedWith('Invalid keeper address.');
        })

        it('only owner can set lock period', async function () {
            const { cmtStaking, normalUser, owner } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(normalUser).setLockPeriod(ONE_DAY)).to.be.revertedWith('Ownable: caller is not the owner');

            await cmtStaking.connect(owner).setLockPeriod(2 * ONE_DAY);
            expect(await cmtStaking.lockPeriod()).to.equal(2 * ONE_DAY);
        })

        it('lock period should >= 1 days', async function () {
            const { cmtStaking, owner } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(owner).setLockPeriod(0.5 * ONE_DAY)).to.be.revertedWith('Invalid lock period.');
        })
    })

    describe('Keeper basis function test', function () {
        it('cannot initialize twice', async function () {
            const { cmtStaking, normalUser } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(normalUser).initialize(normalUser.address, normalUser.address)).to.be.revertedWith('Initializable: contract is already initialized');
        })

        it('only keeper can upgrade', async function () {
            const { cmtStaking, newImpl, owner } = await loadFixture(deployTokenFixture);
            await expect(cmtStaking.connect(owner).upgradeTo(newImpl.address)).to.be.revertedWith('Only keeper can upgrade contract.');
        })

        it('upgrade to new version', async function () {
            const { cmtStaking, newImpl, deployer } = await loadFixture(deployTokenFixture);
            const keeper = deployer;
            const newVersion = 2;
            expect(await newImpl.getVersion()).to.equal(newVersion);
            await cmtStaking.connect(keeper).upgradeTo(newImpl.address);
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
            await expect(cmtStaking.connect(normalUser).unstake(normalUser.address, 1)).to.be.revertedWith('Pausable: paused');
        })

        it('validator cannot withdraw when paused', async function () {
            const { cmtStaking, owner, validator1 } = await loadFixture(deployTokenFixture);
            await cmtStaking.connect(owner).pause();
            expect(await cmtStaking.paused()).to.be.true;
            await expect(cmtStaking.connect(validator1).validatorWithdraw(1)).to.be.revertedWith('Pausable: paused');
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
            let confirm = await tx.wait();
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

            // ########## roll to one day later ##########
            const stakingStartBlock = await time.latestBlock();
            await mine(ONE_DAY_BLOCKS, { interval: BLOCK_INTERVAL });
            expect(await time.latestBlock()).to.equal(stakingStartBlock + ONE_DAY_BLOCKS);

            // the staker should receive STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS) token reward
            const estStakerRewards = await cmtStaking.pendingReward(validator1.address, staker.address);
            const calcStakerRewards = STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS);
            expect(estStakerRewards).to.equal(calcStakerRewards);

            // the validator should receive VALIDATOR_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS) token reward
            const estValidatorRewards = await cmtStaking.pendingReward(AddressZero, validator1.address);
            const calcValidatorRewards = VALIDATOR_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS);
            expect(estValidatorRewards).to.equal(calcValidatorRewards);

            // ########## unstake ##########
            // unstake all deposit amount and pending reward when set amount = 0
            tx = await cmtStaking.connect(staker).unstake(validator1.address, 0);
            confirm = await tx.wait();

            // unstake will triggle initialWithdraw, a Withdrawal record is generated.
            let stakerWithdraw = (await cmtStaking.pendingWithdrawals(staker.address))[0];
            expect(stakerWithdraw.amount).to.equal(calcStakerRewards.add(stakeAmount).add(STAKER_REWARD_PER_BLOCK.mul(1)));

            // ########## validator initial withdraw reward ##########
            tx = await cmtStaking.connect(validator1).validatorWithdraw(estValidatorRewards.add(VALIDATOR_REWARD_PER_BLOCK.mul(1)));
            confirm = await tx.wait();

            let validatorWithdraw = (await cmtStaking.pendingWithdrawals(validator1.address))[0];
            expect(validatorWithdraw.amount).to.equal(estValidatorRewards.add(VALIDATOR_REWARD_PER_BLOCK.mul(1)));

            // ########## EOA transfer rewards to contract ##########
            const calcTotalRewards = STAKER_REWARD_PER_BLOCK.add(VALIDATOR_REWARD_PER_BLOCK).mul(ONE_DAY_BLOCKS).add(STAKER_REWARD_PER_BLOCK.mul(1)).add(VALIDATOR_REWARD_PER_BLOCK.mul(1));
            const someExtraForGasFee = parseEther('1');
            const miner = addrs[1];
            await setBalance(miner.address, calcTotalRewards.add(someExtraForGasFee));
            await miner.sendTransaction({
                to: cmtStaking.address,
                value: calcTotalRewards
            })
            expect(await getBalance(cmtStaking.address)).to.equal(stakeAmount.add(calcTotalRewards));

            // ########## complete withdraw ##########
            // roll to 7 days later (+1 to over 7 days) to meet to withdraw minimal requirement
            await mine(7 * ONE_DAY_BLOCKS + 1, { interval: BLOCK_INTERVAL });

            // check withdraw data
            stakerWithdraw = (await cmtStaking.pendingWithdrawals(staker.address))[0];
            // stakerWithdraw amount should be the same with above fetch
            expect(stakerWithdraw.amount).to.equal(calcStakerRewards.add(stakeAmount).add(STAKER_REWARD_PER_BLOCK.mul(1)));
            // stakerWithdraw timestamp + 7 days should less than current timestamp
            expect(stakerWithdraw.timestamp.toNumber() + 7 * ONE_DAY).to.lessThan(await time.latest());

            // hardhat overloading bugs: https://github.com/ethers-io/ethers.js/issues/407
            validatorWithdraw = await cmtStaking['dueWithdrawalAmount(address)'](validator1.address);
            expect(validatorWithdraw).to.equal(estValidatorRewards.add(VALIDATOR_REWARD_PER_BLOCK.mul(1)));

            // staker complete withdraw
            const stakerReceiver = addrs[2];
            const stakerReceiverBalanceBefore = await stakerReceiver.getBalance();
            tx = await cmtStaking.connect(staker).completeWithdraw(stakerReceiver.address, stakerWithdraw.amount);
            confirm = await tx.wait();
            const stakerReceiverBalanceAfter = await stakerReceiver.getBalance();
            expect(stakerReceiverBalanceAfter.sub(stakerReceiverBalanceBefore)).to.equal(stakerWithdraw.amount);

            // validator complete withdraw
            const validatorRewardReceiver = addrs[3];
            const validatorReceiverBalanceBefore = await validatorRewardReceiver.getBalance();
            tx = await cmtStaking.connect(validator1).completeWithdraw(validatorRewardReceiver.address, estValidatorRewards.add(VALIDATOR_REWARD_PER_BLOCK.mul(1)));
            confirm = await tx.wait();
            const validatorReceiverBalanceAfter = await validatorRewardReceiver.getBalance();
            expect(validatorReceiverBalanceAfter.sub(validatorReceiverBalanceBefore)).to.equal(estValidatorRewards.add(VALIDATOR_REWARD_PER_BLOCK.mul(1)));

            // check contract state after unstake
            sInfo = await cmtStaking.stakeTable(validator1.address, staker.address);
            expect(sInfo.stakeAmount).to.equal(0);
            expect(sInfo.pendingReward).to.equal(0);
            vInfo = await cmtStaking.stakeTable(AddressZero, validator1.address);
            expect(vInfo.stakeAmount).to.equal(0);
            expect(vInfo.pendingReward).to.equal(0);
            activeStakeAmount = await cmtStaking.activeStakeAmount();
            totalStakeAmount = await cmtStaking.totalStakeAmount();
            expect(activeStakeAmount).to.equal(0);
            expect(totalStakeAmount).to.equal(0);
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
            await expect(cmtStaking.connect(unstaker).unstake(validator1.address, stakeAmount)).to.be.revertedWith('Stake record not found.');
        })

        it('cannot unstake more than staked amount', async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            await expect(cmtStaking.connect(staker).unstake(validator1.address, stakeAmount.add(STAKER_REWARD_PER_BLOCK.mul(2)))).to.be.revertedWith('Insufficient balance.');
        })

        it('validator cannot withdraw 0 reward or more than it has', async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            await expect(cmtStaking.connect(validator1).validatorWithdraw(stakeAmount.add(VALIDATOR_REWARD_PER_BLOCK.mul(2)))).to.be.revertedWith('Invalid amount or insufficient balance.');
            await expect(cmtStaking.connect(validator1).validatorWithdraw(0)).to.be.revertedWith('Invalid amount or insufficient balance.');
        })

        it("failed to send native token if contract balance is insufficient", async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            // travel to 1 day later
            await mine(ONE_DAY_BLOCKS, { interval: BLOCK_INTERVAL });
            // unstake
            await cmtStaking.connect(staker).unstake(validator1.address, stakeAmount.add(STAKER_REWARD_PER_BLOCK.mul(1)));
            // travel to 7 days later
            await mine(7 * ONE_DAY_BLOCKS + 1, { interval: BLOCK_INTERVAL });
            // complete withdraw
            await expect(cmtStaking.connect(staker).completeWithdraw(staker.address, stakeAmount.add(STAKER_REWARD_PER_BLOCK.mul(1)))).to.be.revertedWith("Failed to send native token.");

        })

        it("staker cannot get reward if the staking's validator get deactivated", async function () {
            const { cmtStaking, validator1, addrs, owner } = await loadFixture(deployTokenFixture);
            const staker = addrs[0];
            const stakeAmount = parseEther('1');
            let tx = await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });
            let confirm = await tx.wait();

            // travel to 1 day later
            await mine(ONE_DAY_BLOCKS, { interval: BLOCK_INTERVAL });

            // add one more validator to avoid error as validators should be at least 1.
            const validator2 = addrs[1];
            await cmtStaking.connect(owner).addValidator(validator2.address);

            // deactivate validator1
            tx = await cmtStaking.connect(owner).removeValidator(validator1.address);
            confirm = await tx.wait();
            expect(await cmtStaking.isActiveValidator(validator1.address)).to.be.false;

            // travel to 1 days later
            await mine(ONE_DAY_BLOCKS, { interval: BLOCK_INTERVAL });

            // distribute rewards
            const calcRewards = STAKER_REWARD_PER_BLOCK.add(VALIDATOR_REWARD_PER_BLOCK).mul(ONE_DAY_BLOCKS + 2);
            const someExtraForGasFee = parseEther('1');
            const miner = addrs[1];
            await setBalance(miner.address, calcRewards.add(someExtraForGasFee));
            await miner.sendTransaction({
                to: cmtStaking.address,
                value: calcRewards
            })

            // unstake
            // as validator1 have been deactivated, only the blocks before removeValidator operation get rewarded. 
            const calcStakerRewards = STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS + 2);
            const estStakerRewards = await cmtStaking.pendingReward(validator1.address, staker.address);
            expect(estStakerRewards).to.equal(calcStakerRewards);

            tx = await cmtStaking.connect(staker).unstake(validator1.address, calcStakerRewards);
            confirm = await tx.wait();

            const calcValidatorRewards = VALIDATOR_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS + 2);
            const estValidatorRewards = await cmtStaking.pendingReward(AddressZero, validator1.address);
            expect(estValidatorRewards).to.equal(calcValidatorRewards);

            tx = await cmtStaking.connect(validator1).validatorWithdraw(calcValidatorRewards);
            confirm = await tx.wait();

            // travel to 7 day later
            await mine(7 * ONE_DAY_BLOCKS + 1, { interval: BLOCK_INTERVAL });

            // staker complete withdraw
            const stakerReceiver = addrs[2];
            const balanceBefore = await stakerReceiver.getBalance();
            tx = await cmtStaking.connect(staker).completeWithdraw(stakerReceiver.address, calcStakerRewards);
            confirm = await tx.wait();
            const balanceAfter = await stakerReceiver.getBalance();
            const stakerUnstakeAmount = balanceAfter.sub(balanceBefore);
            expect(stakerUnstakeAmount).to.equal(calcStakerRewards);

            sInfo = await cmtStaking.stakeTable(validator1.address, staker.address);
            expect(sInfo.pendingReward).to.equal(0);

            // validator1 conplete withdraw
            const validatorRewardReceiver = addrs[3];
            const validatorReceiverBalanceBefore = await validatorRewardReceiver.getBalance();
            tx = await cmtStaking.connect(validator1).completeWithdraw(validatorRewardReceiver.address, calcValidatorRewards);
            confirm = await tx.wait();
            const validatorReceiverBalanceAfter = await validatorRewardReceiver.getBalance();
            expect(validatorReceiverBalanceAfter.sub(validatorReceiverBalanceBefore)).to.equal(calcValidatorRewards);
            vInfo = await cmtStaking.stakeTable(AddressZero, validator1.address);
            expect(vInfo.pendingReward).to.equal(0);
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

            // travel to 1 day later
            await mine(ONE_DAY_BLOCKS, { interval: BLOCK_INTERVAL });

            // staker1 stake 2 eth
            const staker1 = addrs[1];
            await cmtStaking.connect(staker1).stake(validator1.address, { value: stakeAmount.mul(2) });

            // accumulation of (rewards in this period / stake amount in this period)
            // as update pool is execute before stake operation, the 2 eth is not counted yet.
            let calcAUR = STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS + 1).mul(AUR_PREC).div(stakeAmount);
            sPool = await cmtStaking.stakerPool();
            expect(sPool.lastAUR).to.equal(calcAUR);

            // as staker1 stakes 2 eth, the stake amount is 2 eth.
            let stake1RewardDebt = stakeAmount.mul(2).mul(sPool.lastAUR).div(AUR_PREC);

            // travel to 1 day later
            await mine(ONE_DAY_BLOCKS, { interval: BLOCK_INTERVAL });

            // staker2 stake 3 eth
            const staker2 = addrs[2];
            await cmtStaking.connect(staker2).stake(validator1.address, { value: stakeAmount.mul(3) });

            calcAUR = calcAUR.add(STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS + 1).mul(AUR_PREC).div(stakeAmount.mul(3)));
            sPool = await cmtStaking.stakerPool();
            expect(sPool.lastAUR).to.equal(calcAUR);

            // travel to 1 day later
            await mine(ONE_DAY_BLOCKS, { interval: BLOCK_INTERVAL });

            // staker1 stake another 1 ether to update pool
            await cmtStaking.connect(staker1).stake(validator1.address, { value: stakeAmount });
            calcAUR = calcAUR.add(STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS + 1).mul(AUR_PREC).div(stakeAmount.mul(6)));
            sPool = await cmtStaking.stakerPool();
            expect(sPool.lastAUR).to.equal(calcAUR);

            let staker1Reward = stakeAmount.mul(2).mul(sPool.lastAUR).div(AUR_PREC).sub(stake1RewardDebt);
            let staker1Info = await cmtStaking.stakeTable(validator1.address, staker1.address);
            expect(staker1Info.pendingReward).to.equal(staker1Reward);
            // staker1 stakes 2 times, 2ether + 1ether
            stake1RewardDebt = stakeAmount.mul(3).mul(sPool.lastAUR).div(AUR_PREC);
            expect(staker1Info.rewardDebt).to.equal(stake1RewardDebt);
            expect(staker1Info.stakeAmount).to.equal(stakeAmount.mul(3));
        })

        it("user stake again after one month", async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);

            // staker: stake 1 eth
            const staker = addrs[0];
            const stakeAmount = parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            // staker: unstake all
            await cmtStaking.connect(staker).unstake(validator1.address, 0);
            const pendingWithdrawal = (await cmtStaking.pendingWithdrawals(staker.address))[0];
            // only the block of unstake has reward
            expect(pendingWithdrawal.amount).to.equal(stakeAmount.add(STAKER_REWARD_PER_BLOCK.mul(1)));

            // run for one month
            await mine(31 * ONE_DAY_BLOCKS, { interval: BLOCK_INTERVAL });

            // staker: stake 1 eth
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });
            let estStakerReward = await cmtStaking.pendingReward(validator1.address, staker.address);
            // only rewards yet
            expect(estStakerReward).to.equal(0);
        })

        it("users multiple stake, unstak test", async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);

            // staker0: stake 1 eth
            const staker0 = addrs[0];
            const stakeAmount = parseEther('1');
            await cmtStaking.connect(staker0).stake(validator1.address, { value: stakeAmount });

            // for the first 1 day, staker0 will get all rewards
            await mine(ONE_DAY_BLOCKS, { interval: BLOCK_INTERVAL });
            let estStaker0Reward = await cmtStaking.pendingReward(validator1.address, staker0.address);
            let calcStaker0Reward0 = STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS);
            expect(estStaker0Reward).to.equal(calcStaker0Reward0);

            // staker1: stake 1 eth
            const staker1 = addrs[1];
            await cmtStaking.connect(staker1).stake(validator1.address, { value: stakeAmount });

            // // for the next 1 day, staker0 and staker1 will divide all rewards
            await mine(ONE_DAY_BLOCKS, { interval: BLOCK_INTERVAL });
            estStaker0Reward = await cmtStaking.pendingReward(validator1.address, staker0.address);
            // tricky part, the block's reward of staker1 staking belongs to staker0, the rest will divided equally
            let calcStaker0Reward1 = STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS).div(2).add(STAKER_REWARD_PER_BLOCK.mul(1));
            expect(estStaker0Reward).to.equal(calcStaker0Reward0.add(calcStaker0Reward1));

            let estStaker1Reward = await cmtStaking.pendingReward(validator1.address, staker1.address);
            let calcStaker1Reward0 = STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS).div(2);
            expect(estStaker1Reward).to.equal(calcStaker1Reward0);

            // staker0 unstake all. 
            await cmtStaking.connect(staker0).unstake(validator1.address, 0);
            const staker0Withdraw = (await cmtStaking.pendingWithdrawals(staker0.address))[0];
            // unstake amount need add half of block reward of unstake op and stake amount.
            expect(staker0Withdraw.amount).to.equal(estStaker0Reward.add(STAKER_REWARD_PER_BLOCK.mul(1).div(2)).add(stakeAmount));

            // for the next 1 day, all rewards belongs to staker1
            await mine(ONE_DAY_BLOCKS, { interval: BLOCK_INTERVAL });
            estStaker0Reward = await cmtStaking.pendingReward(validator1.address, staker0.address);
            expect(estStaker0Reward).to.equal(0);

            estStaker1Reward = await cmtStaking.pendingReward(validator1.address, staker1.address);
            // staker1 will get all rewards of the day and the half of unstake block.
            let calcStaker1Reward1 = STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS).add(STAKER_REWARD_PER_BLOCK.mul(1).div(2));
            expect(estStaker1Reward).to.equal(calcStaker1Reward0.add(calcStaker1Reward1));

            // staker1 unstake all
            await cmtStaking.connect(staker1).unstake(validator1.address, 0);

            // for the next 1 day, no rewards generated as no stake amount
            await mine(ONE_DAY_BLOCKS, { interval: BLOCK_INTERVAL });
            estStaker0Reward = await cmtStaking.pendingReward(validator1.address, staker0.address);
            estStaker1Reward = await cmtStaking.pendingReward(validator1.address, staker1.address);
            expect(estStaker0Reward).to.equal(0);
            expect(estStaker1Reward).to.equal(0);

            // staker0 stake 1 eth again
            await cmtStaking.connect(staker0).stake(validator1.address, { value: stakeAmount });

            // staker0 will get all rewards again for the day.
            await mine(ONE_DAY_BLOCKS, { interval: BLOCK_INTERVAL });

            estStaker0Reward = await cmtStaking.pendingReward(validator1.address, staker0.address);
            let calcStaker0Reward2 = STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS);
            expect(estStaker0Reward).to.equal(calcStaker0Reward2);

            estStaker1Reward = await cmtStaking.pendingReward(validator1.address, staker1.address);
            expect(estStaker1Reward).to.equal(0);
        })

        it("connot complete withdraw if lock period is not reached", async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);

            // staker: stake 1 eth
            const staker = addrs[0];
            const stakeAmount = parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            // run for one day
            await mine(ONE_DAY_BLOCKS, { interval: BLOCK_INTERVAL });

            // staker: unstake 
            await cmtStaking.connect(staker).unstake(validator1.address, 0);
            const pendingWithdrawal = (await cmtStaking.pendingWithdrawals(staker.address))[0];
            // only the block of unstake has reward
            expect(pendingWithdrawal.amount).to.equal(stakeAmount.add(STAKER_REWARD_PER_BLOCK.mul(ONE_DAY_BLOCKS + 1)));

            // connot complete withdraw if lock period is not reached
            expect(await cmtStaking['dueWithdrawalAmount(address)'](staker.address)).to.equal(0);
            await expect(cmtStaking.connect(staker).completeWithdraw(staker.address, pendingWithdrawal.amount)).to.be.revertedWith("Insufficient withdrawable amount.");
        })

        it("connot unstake amount less than MIN_WITHDRAW_AMOUNT", async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);

            // staker: stake 1 eth
            const staker = addrs[0];
            const stakeAmount = parseEther('1');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            // run for one day
            await mine(ONE_DAY_BLOCKS, { interval: BLOCK_INTERVAL });

            const WRONG_MIN_WITHDRAW_AMOUNT = parseEther('0.00005');

            // staker: unstake 
            await expect(cmtStaking.connect(staker).unstake(validator1.address, WRONG_MIN_WITHDRAW_AMOUNT)).to.be.revertedWith("withdraw amount must >= MIN_WITHDRAW_AMOUNT");
        })

        it("able to withdraw partial rewards", async function () {
            const { cmtStaking, validator1, addrs } = await loadFixture(deployTokenFixture);

            // staker: stake 1 eth
            const staker = addrs[0];
            const stakeAmount = parseEther('1000');
            await cmtStaking.connect(staker).stake(validator1.address, { value: stakeAmount });

            // run for one day
            await mine(ONE_DAY_BLOCKS, { interval: BLOCK_INTERVAL });

            // get pending rewards
            const pendingRewards = await cmtStaking.pendingReward(validator1.address, staker.address);
            const withdrawAmount = pendingRewards.add(stakeAmount);

            // staker: get one days rewards and untake two times to make 2 withdraw records
            await cmtStaking.connect(staker).unstake(validator1.address, withdrawAmount.div(2));
            await cmtStaking.connect(staker).unstake(validator1.address, withdrawAmount.div(2));

            // two blocks reward was left as stake amount
            const sInfo = await cmtStaking.stakeTable(validator1.address, staker.address);
            expect(sInfo.stakeAmount).to.equal(STAKER_REWARD_PER_BLOCK.mul(2));

            let myWithdraw = await cmtStaking.connect(staker).pendingWithdrawals(staker.address);
            expect(myWithdraw[0].amount).to.equal(withdrawAmount.div(2));
            expect(myWithdraw[1].amount).to.equal(withdrawAmount.div(2));

            // complete withdraw after locked period and intentional make a leftover withdraw
            const leftRewards = parseEther('0.5');
            const receiveRewards = withdrawAmount.sub(leftRewards);
            const someExtraForGasFee = parseEther('1');
            const miner = addrs[1];
            await setBalance(miner.address, receiveRewards.add(someExtraForGasFee));
            await miner.sendTransaction({
                to: cmtStaking.address,
                value: receiveRewards
            })

            await mine(7 * ONE_DAY_BLOCKS + 1, { interval: BLOCK_INTERVAL });
            await cmtStaking.connect(staker).completeWithdraw(staker.address, receiveRewards);
            myWithdraw = await cmtStaking.connect(staker).pendingWithdrawals(staker.address);
            expect(myWithdraw[0].amount).to.equal(leftRewards);
        })
    })
});