// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

contract CMTStaking is
    Initializable,
    // not necessary now but we add ReentrancyGuard in advance to improve security of future updates
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    using EnumerableSet for EnumerableSet.AddressSet;

    struct Pool {
        uint256 lastAUR;
        uint256 distAUR;
        uint256 updateBlock;
    }

    struct StakeInfo {
        uint256 stakeAmount;
        uint256 rewardDebt;
        uint256 distReward;
        uint256 lockedReward;
        uint256 updateBlock;
    }

    EnumerableSet.AddressSet private _validators;

    Pool public validatorPool;
    Pool public stakerPool;
    mapping(address => Pool) inactivePools;

    // validator => staker => staking records
    mapping(address => mapping(address => StakeInfo)) public stakeTable;

    uint32 public validatorLimit;

    uint256 public validatorRewardPerBlock;
    uint256 public stakerRewardPerBlock;

    uint256 public totalStakeAmount;
    uint256 public activeStakeAmount;
    uint256 public constant AUR_PREC = 1e18;

    uint256 public feeUntaken;

    uint256 public immutable MIN_STAKE_AMOUNT;

    event Received(address indexed sender, uint256 amount);
    event RewardPerBlockChanged(uint256 validatorReward, uint256 stakerReward);
    event ValidatorChanged(address validator, bool isValid);
    event Stake(address indexed staker, address indexed validator, uint256 amount);
    event Unstake(
        address indexed staker,
        address indexed validator,
        uint256 unstakeAmount,
        uint256 claimedReward,
        address indexed recipient,
        uint256 feeAmount
    );
    event ValidatorWithdrawal(address indexed validator, address indexed recipient, uint256 amount);
    event FeeWithdrawal(address indexed operator, address indexed recipient, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(uint256 minStakeAmount) {
        _disableInitializers();
        require(minStakeAmount >= 10 ** 9, "Invalid minimal stake amount.");
        MIN_STAKE_AMOUNT = minStakeAmount;
    }

    function initialize(address validator) external initializer {
        __ReentrancyGuard_init();
        __Pausable_init();
        __Ownable_init();
        __UUPSUpgradeable_init();

        // default maximum 21 validators
        validatorLimit = 21;

        // default amount of rewards per block
        setRewardPerBlock(5 ether);

        // minimum 1 validator
        addValidator(validator);
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    function getVersion() external pure returns (uint256) {
        return 1;
    }

    /////////////////////////////////
    //            Owner            //
    /////////////////////////////////

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // set amount of rewards per block
    function setRewardPerBlock(uint256 amount) public onlyOwner {
        require(amount > 0, "Invalid limit value.");
        updatePools();
        validatorRewardPerBlock = amount / 5;
        stakerRewardPerBlock = amount - validatorRewardPerBlock;
        emit RewardPerBlockChanged(validatorRewardPerBlock, stakerRewardPerBlock);
    }

    // set maximum num of validators
    function setValidatorLimit(uint32 limit) external onlyOwner {
        require(limit >= _validators.length(), "Invalid limit value.");
        validatorLimit = limit;
    }

    // add validator
    function addValidator(address validator) public onlyOwner {
        require(validator != address(0), "Invalid address.");
        require(_validators.length() < validatorLimit, "Validators are full.");
        require(
            !isActiveValidator(validator) && inactivePools[validator].updateBlock == 0,
            "Validator had been added."
        );

        _validators.add(validator);

        emit ValidatorChanged(validator, true);
    }

    // deactivate validator
    function removeValidator(address validator) external onlyOwner {
        require(_validators.length() > 1, "Cannot remove the only validator.");
        require(isActiveValidator(validator), "Validator not exist or has been removed.");

        (Pool memory vPool, Pool memory sPool, uint256 distBlock) = updatePools();
        StakeInfo memory info = stakeTable[address(0)][validator];
        _updateRewards(vPool, info, distBlock);
        _updateRewardDebt(vPool, info);
        info.updateBlock = block.number;
        stakeTable[address(0)][validator] = info;

        _validators.remove(validator);
        inactivePools[validator] = sPool;

        activeStakeAmount -= info.stakeAmount;

        emit ValidatorChanged(validator, false);
    }

    // contract owner withdraw collected fee
    function withdrawFee(address payable recipient, uint256 amount) external nonReentrant onlyOwner {
        require(recipient != address(0), "Invalid address.");
        require(amount > 0 && amount <= feeUntaken, "Invalid amount or insufficient balance.");
        feeUntaken -= amount;
        emit FeeWithdrawal(msg.sender, recipient, amount);
        _sendValue(recipient, amount);
    }

    /////////////////////////////////
    //          Validator          //
    /////////////////////////////////

    // validator withdraw its rewards
    function validatorWithdraw(address payable recipient, uint256 amount) external nonReentrant whenNotPaused {
        (Pool memory vPool, , uint256 distBlock) = updatePools();
        StakeInfo memory info = stakeTable[address(0)][msg.sender];
        if (isActiveValidator(msg.sender)) {
            _updateRewards(vPool, info, distBlock);
            _updateRewardDebt(vPool, info);
        } else if (distBlock > info.updateBlock) {
            info.distReward += info.lockedReward;
            info.lockedReward = 0;
        }

        require(amount > 0 && amount <= info.distReward, "Invalid amount or insufficient balance.");
        info.distReward -= amount;
        info.updateBlock = block.number;
        stakeTable[address(0)][msg.sender] = info;

        emit ValidatorWithdrawal(msg.sender, recipient, amount);
        _sendValue(recipient, amount);
    }

    //////////////////////////////
    //          Staker          //
    //////////////////////////////

    // stake into a valid validator
    function stake(address validator) external payable whenNotPaused {
        require(msg.value >= MIN_STAKE_AMOUNT, "Staking amount must >= MIN_STAKE_AMOUNT.");

        require(isActiveValidator(validator), "Validator not exist or has been removed.");

        (Pool memory vPool, Pool memory sPool, uint256 distBlock) = updatePools();
        StakeInfo memory vInfo = stakeTable[address(0)][validator];
        StakeInfo memory sInfo = stakeTable[validator][msg.sender];
        _updateRewards(vPool, vInfo, distBlock);
        _updateRewards(sPool, sInfo, distBlock);
        vInfo.stakeAmount += msg.value;
        sInfo.stakeAmount += msg.value;
        _updateRewardDebt(vPool, vInfo);
        _updateRewardDebt(sPool, sInfo);
        vInfo.updateBlock = block.number;
        sInfo.updateBlock = block.number;

        // update staking amounts
        activeStakeAmount += msg.value;
        totalStakeAmount += msg.value;

        emit Stake(msg.sender, validator, msg.value);
    }

    // can only claim distributed reward
    function unstake(address validator, uint256 amount, address payable recipient) external nonReentrant whenNotPaused {
        (Pool memory vPool, Pool memory sPool, uint256 distBlock) = updatePools();
        StakeInfo memory vInfo = stakeTable[address(0)][validator];
        StakeInfo memory sInfo = stakeTable[validator][msg.sender];

        require(amount > 0 && amount <= sInfo.stakeAmount, "Invalid amount or insufficient balance.");

        if (isActiveValidator(msg.sender)) {
            _updateRewards(vPool, vInfo, distBlock);
            _updateRewards(sPool, sInfo, distBlock);
            vInfo.stakeAmount -= amount;
            sInfo.stakeAmount -= amount;
            _updateRewardDebt(vPool, vInfo);
            _updateRewardDebt(sPool, sInfo);
            activeStakeAmount -= amount;
        } else {
            if (distBlock > vInfo.updateBlock) {
                vInfo.distReward += vInfo.lockedReward;
                vInfo.lockedReward = 0;
            }
            sPool = inactivePools[validator];
            if (sPool.distAUR < sPool.lastAUR && distBlock > sPool.updateBlock) {
                sPool.distAUR = sPool.lastAUR;
                sPool.updateBlock = block.number;
                inactivePools[validator] = sPool;
            }
            _updateRewards(sPool, sInfo, distBlock);
            vInfo.stakeAmount -= amount;
            sInfo.stakeAmount -= amount;
            _updateRewardDebt(sPool, sInfo);
        }

        uint256 rewardAmount = sInfo.distReward;
        sInfo.distReward = 0;
        vInfo.updateBlock = block.number;
        sInfo.updateBlock = block.number;
        stakeTable[address(0)][validator] = vInfo;
        stakeTable[validator][msg.sender] = sInfo;

        totalStakeAmount -= amount;

        // calculate and charge fee from staker
        uint256 unstakedValue = amount + rewardAmount;
        uint256 stakerWithdrawAmount = (unstakedValue * 99) / 100;
        uint256 fee = unstakedValue - stakerWithdrawAmount;
        feeUntaken += fee;

        emit Unstake(msg.sender, validator, amount, rewardAmount, recipient, fee);

        // send (amount + reward) after fee deducted
        _sendValue(recipient, stakerWithdrawAmount);
    }

    function pendingReward(address validator, address staker) external view returns (uint256 dist, uint256 locked) {
        uint256 distBlock = lastDistributionBlock();
        StakeInfo memory info = stakeTable[validator][staker];
        Pool memory pool = isActiveValidator(validator) ? stakerPool : inactivePools[validator];
        if (isActiveValidator(validator)) {
            pool = stakerPool;
            _updatePool(pool, stakerRewardPerBlock, activeStakeAmount, distBlock);
        } else if (distBlock > pool.updateBlock) {
            pool.distAUR = pool.lastAUR;
        }
        _updateRewards(pool, info, distBlock);
        return (info.distReward, info.lockedReward);
    }

    function isActiveValidator(address validator) public view returns (bool) {
        return _validators.contains(validator);
    }

    function activeValidators() public view returns (address[] memory) {
        return _validators.values();
    }

    function lastDistributionBlock() public view returns (uint256 blockNumber) {
        uint256 period = 30 days / 6;
        return block.number - (block.number % period);
    }

    function updatePools() public returns (Pool memory vPool, Pool memory sPool, uint256 distBlock) {
        distBlock = lastDistributionBlock();
        vPool = _updatePool(validatorPool, validatorRewardPerBlock, activeStakeAmount, distBlock);
        sPool = _updatePool(stakerPool, stakerRewardPerBlock, activeStakeAmount, distBlock);
        validatorPool = vPool;
        stakerPool = sPool;
    }

    function _updatePool(
        Pool memory pool,
        uint256 rewardPerBlock,
        uint256 stakeAmount,
        uint256 distBlock
    ) internal view returns (Pool memory) {
        if (stakeAmount == 0) {
            if (distBlock > pool.updateBlock) {
                pool.distAUR = pool.lastAUR;
                pool.updateBlock = block.number;
            }
            return pool;
        }
        if (distBlock > pool.updateBlock) {
            uint256 distReward = (distBlock - pool.updateBlock) * rewardPerBlock;
            pool.distAUR = pool.lastAUR + (distReward * AUR_PREC) / stakeAmount;
        }
        if (rewardPerBlock > 0) {
            uint256 reward = (block.number - pool.updateBlock) * rewardPerBlock;
            pool.lastAUR += (reward * AUR_PREC) / stakeAmount;
        }
        pool.updateBlock = block.number;
        return pool;
    }

    function _updateRewards(Pool memory pool, StakeInfo memory info, uint256 distBlock) internal pure {
        if (info.updateBlock == 0) {
            return;
        }
        uint256 total = (info.stakeAmount * pool.lastAUR) / AUR_PREC - info.rewardDebt;
        if (distBlock > info.updateBlock) {
            uint256 distributed = (info.stakeAmount * pool.distAUR) / AUR_PREC - info.rewardDebt;
            info.distReward = info.lockedReward + distributed;
            info.lockedReward = total - distributed;
        } else {
            info.lockedReward += total;
        }
    }

    function _updateRewardDebt(Pool memory pool, StakeInfo memory info) internal pure {
        info.rewardDebt = (info.stakeAmount * pool.lastAUR) / AUR_PREC;
    }

    function _sendValue(address payable to, uint256 amount) internal {
        (bool success, ) = to.call{value: amount}("");
        require(success, "Failed to send native token.");
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}
