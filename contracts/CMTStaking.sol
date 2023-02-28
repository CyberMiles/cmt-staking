// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/utils/structs/DoubleEndedQueue.sol";
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
    using DoubleEndedQueue for DoubleEndedQueue.Bytes32Deque;
    using EnumerableSet for EnumerableSet.AddressSet;

    struct Pool {
        uint256 lastAUR;
        uint256 updateBlock;
    }

    struct StakeInfo {
        uint256 stakeAmount;
        uint256 rewardDebt;
        uint256 pendingReward;
        uint256 updateBlock;
    }

    struct Withdrawal {
        uint256 amount;
        uint256 timestamp;
    }

    address public keeper;

    EnumerableSet.AddressSet private _validators;

    Pool public validatorPool;
    Pool public stakerPool;
    mapping(address => Pool) public inactivePools;

    // validator => staker => stake info
    mapping(address => mapping(address => StakeInfo)) public stakeTable;

    mapping(address => DoubleEndedQueue.Bytes32Deque) public withdrawTable;

    uint32 public validatorLimit;

    uint32 public lockPeriod;

    uint256 public validatorRewardPerBlock;
    uint256 public stakerRewardPerBlock;

    uint256 public totalStakeAmount;
    uint256 public activeStakeAmount;
    uint256 public constant AUR_PREC = 1e18;

    uint256 public immutable MIN_STAKE_AMOUNT;
    uint256 public immutable MIN_WITHDRAW_AMOUNT;

    event Received(address indexed sender, uint256 amount);
    event RewardPerBlockChanged(uint256 validatorReward, uint256 stakerReward);
    event LockPeriodChanged(uint32 newLockPeriod);
    event ValidatorChanged(address validator, bool isValid);
    event Stake(address indexed staker, address indexed validator, uint256 amount);
    event Unstake(address indexed staker, address indexed validator, uint256 unstakeAmount, uint256 claimedReward);
    event WithdrawalInitiated(address indexed account, uint256 amount);
    event WithdrawalCompleted(address indexed account, address indexed recipient, uint256 amount);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(uint256 minStakeAmount, uint256 minWithdrawAmount) {
        _disableInitializers();
        require(minStakeAmount >= 10 ** 9, "Invalid minimal stake amount.");
        MIN_STAKE_AMOUNT = minStakeAmount;
        MIN_WITHDRAW_AMOUNT = minWithdrawAmount;
    }

    function initialize(address owner, address validator) external initializer {
        __ReentrancyGuard_init();
        __Pausable_init();
        _transferOwnership(owner);
        __UUPSUpgradeable_init();

        keeper = msg.sender;

        // default maximum 21 validators
        validatorLimit = 21;

        // default amount of rewards per block
        _setRewardPerBlock(5 ether);

        // default 7 days withdrawal lock period
        _setLockPeriod(7 days);

        // minimum 1 validator
        _addValidator(validator);
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
    function setRewardPerBlock(uint256 amount) external onlyOwner {
        require(amount > 0, "Invalid reward per block.");
        _updatePools();
        _setRewardPerBlock(amount);
    }

    function setLockPeriod(uint32 period) external onlyOwner {
        require(period >= 1 days, "Invalid lock period.");
        _setLockPeriod(period);
    }

    function setKeeper(address newKeeper) external onlyOwner {
        require(newKeeper != address(0), "Invalid keeper address.");
        keeper = newKeeper;
    }

    // set maximum num of validators
    function setValidatorLimit(uint32 limit) external onlyOwner {
        require(limit >= _validators.length(), "Invalid limit value.");
        validatorLimit = limit;
    }

    // add validator
    function addValidator(address validator) external onlyOwner {
        _addValidator(validator);
    }

    // deactivate validator
    function removeValidator(address validator) external onlyOwner {
        require(_validators.length() > 1, "Cannot remove the only validator.");
        require(isActiveValidator(validator), "Validator not exist or has been removed.");

        (Pool memory vPool, Pool memory sPool) = _updatePools();
        StakeInfo memory info = stakeTable[address(0)][validator];
        _updateRewards(vPool, info);
        _updateRewardDebt(vPool, info);
        info.updateBlock = block.number;
        stakeTable[address(0)][validator] = info;

        _validators.remove(validator);
        inactivePools[validator] = sPool;

        activeStakeAmount -= info.stakeAmount;

        emit ValidatorChanged(validator, false);
    }

    /////////////////////////////////
    //          Validator          //
    /////////////////////////////////

    // validator withdraw its rewards
    function validatorWithdraw(uint256 amount) external nonReentrant whenNotPaused {
        (Pool memory vPool, ) = _updatePools();
        StakeInfo memory info = stakeTable[address(0)][msg.sender];
        if (isActiveValidator(msg.sender)) {
            _updateRewards(vPool, info);
            _updateRewardDebt(vPool, info);
        }

        require(amount > 0 && amount <= info.pendingReward, "Invalid amount or insufficient balance.");
        info.pendingReward -= amount;
        info.updateBlock = block.number;
        stakeTable[address(0)][msg.sender] = info;

        _initiateWithdrawal(msg.sender, amount);
    }

    //////////////////////////////
    //          Staker          //
    //////////////////////////////

    // stake into a valid validator
    function stake(address validator) external payable whenNotPaused {
        require(msg.value >= MIN_STAKE_AMOUNT, "Stake amount must >= MIN_STAKE_AMOUNT.");

        require(isActiveValidator(validator), "Validator not exist or has been removed.");

        (Pool memory vPool, Pool memory sPool) = _updatePools();
        StakeInfo memory vInfo = stakeTable[address(0)][validator];
        StakeInfo memory sInfo = stakeTable[validator][msg.sender];
        _updateRewards(vPool, vInfo);
        _updateRewards(sPool, sInfo);
        vInfo.stakeAmount += msg.value;
        sInfo.stakeAmount += msg.value;
        _updateRewardDebt(vPool, vInfo);
        _updateRewardDebt(sPool, sInfo);
        vInfo.updateBlock = block.number;
        sInfo.updateBlock = block.number;
        stakeTable[address(0)][validator] = vInfo;
        stakeTable[validator][msg.sender] = sInfo;

        // update staking amounts
        activeStakeAmount += msg.value;
        totalStakeAmount += msg.value;

        emit Stake(msg.sender, validator, msg.value);
    }

    // can only initiate delayed reward withdrawal
    function unstake(address validator, uint256 amount) external nonReentrant whenNotPaused {
        (Pool memory vPool, Pool memory sPool) = _updatePools();
        StakeInfo memory vInfo = stakeTable[address(0)][validator];
        StakeInfo memory sInfo = stakeTable[validator][msg.sender];

        require(validator != address(0) && sInfo.updateBlock != 0, "Stake record not found.");

        uint256 unstaked;
        uint256 reward;

        if (isActiveValidator(validator)) {
            _updateRewards(vPool, vInfo);
            _updateRewards(sPool, sInfo);
            (unstaked, reward) = _unstake(vInfo, sInfo, amount);
            _updateRewardDebt(vPool, vInfo);
            _updateRewardDebt(sPool, sInfo);
            activeStakeAmount -= unstaked;
        } else {
            sPool = inactivePools[validator];
            _updateRewards(sPool, sInfo);
            (unstaked, reward) = _unstake(vInfo, sInfo, amount);
            _updateRewardDebt(sPool, sInfo);
        }

        vInfo.updateBlock = block.number;
        sInfo.updateBlock = block.number;
        stakeTable[address(0)][validator] = vInfo;
        stakeTable[validator][msg.sender] = sInfo;

        totalStakeAmount -= unstaked;

        emit Unstake(msg.sender, validator, unstaked, reward);

        _initiateWithdrawal(msg.sender, unstaked + reward);
    }

    function completeWithdraw(address payable recipient, uint256 amount) external {
        _completeWithdrawal(msg.sender, recipient, amount);
    }

    function pendingReward(address validator, address staker) external view returns (uint256) {
        StakeInfo memory info = stakeTable[validator][staker];
        Pool memory pool;
        if (validator == address(0)) {
            if (isActiveValidator(staker)) {
                pool = validatorPool;
                _updatePool(pool, validatorRewardPerBlock, activeStakeAmount);
                _updateRewards(pool, info);
            }
            return info.pendingReward;
        }
        if (isActiveValidator(validator)) {
            pool = stakerPool;
            _updatePool(pool, stakerRewardPerBlock, activeStakeAmount);
        } else {
            pool = inactivePools[validator];
        }
        _updateRewards(pool, info);
        return info.pendingReward;
    }

    function pendingWithdrawals(address account) external view returns (Withdrawal[] memory withdrawals) {
        DoubleEndedQueue.Bytes32Deque storage queue = withdrawTable[account];
        uint256 length = queue.length();
        withdrawals = new Withdrawal[](length);
        for (uint256 i = 0; i < length; ++i) {
            (uint256 amount, uint256 timestamp) = _decodeWithdrawal(queue.at(i));
            withdrawals[i] = Withdrawal(amount, timestamp);
        }
    }

    function dueWithdrawalAmount(address account) external view returns (uint256) {
        return dueWithdrawalAmount(account, block.timestamp);
    }

    function dueWithdrawalAmount(address account, uint256 timestamp) public view returns (uint256) {
        DoubleEndedQueue.Bytes32Deque storage queue = withdrawTable[account];
        uint256 amount = 0;
        uint256 length = queue.length();
        for (uint256 i = 0; i < length; ++i) {
            (uint256 available, uint256 recordTimestamp) = _decodeWithdrawal(queue.at(i));
            if (recordTimestamp + lockPeriod > timestamp) {
                break;
            }
            amount += available;
        }
        return amount;
    }

    function isActiveValidator(address validator) public view returns (bool) {
        return _validators.contains(validator);
    }

    function activeValidators() public view returns (address[] memory) {
        return _validators.values();
    }

    function _encodeWithdrawal(uint256 amount, uint256 timestamp) internal pure returns (bytes32 value) {
        require(amount <= type(uint224).max && timestamp <= type(uint32).max, "Invalid withdrawal");
        value = bytes32((amount << 32) | timestamp);
    }

    function _decodeWithdrawal(bytes32 value) internal pure returns (uint256 amount, uint256 timestamp) {
        uint256 temp = uint256(value);
        amount = temp >> 32;
        timestamp = temp & (2 ** 32 - 1);
    }

    function _initiateWithdrawal(address account, uint256 amount) internal {
        require(amount >= MIN_WITHDRAW_AMOUNT, "withdraw amount must >= MIN_WITHDRAW_AMOUNT");
        withdrawTable[account].pushBack(_encodeWithdrawal(amount, block.timestamp));
        emit WithdrawalInitiated(account, amount);
    }

    function _completeWithdrawal(address account, address payable recipient, uint256 amount) internal {
        DoubleEndedQueue.Bytes32Deque storage queue = withdrawTable[account];
        uint256 sum = 0;
        while (!queue.empty()) {
            (uint256 available, uint256 timestamp) = _decodeWithdrawal(queue.front());
            if (timestamp + lockPeriod > block.timestamp) {
                break;
            }
            sum += available;
            queue.popFront();
            if (sum > amount) {
                queue.pushFront(_encodeWithdrawal(sum - amount, timestamp));
                sum = amount;
                break;
            }
        }
        require(sum == amount, "Insufficient withdrawable amount.");
        emit WithdrawalCompleted(account, recipient, amount);
        _sendValue(recipient, amount);
    }

    function _updatePools() internal returns (Pool memory vPool, Pool memory sPool) {
        vPool = _updatePool(validatorPool, validatorRewardPerBlock, activeStakeAmount);
        sPool = _updatePool(stakerPool, stakerRewardPerBlock, activeStakeAmount);
        validatorPool = vPool;
        stakerPool = sPool;
    }

    function _updatePool(
        Pool memory pool,
        uint256 rewardPerBlock,
        uint256 stakeAmount
    ) internal view returns (Pool memory) {
        if (stakeAmount == 0) {
            pool.updateBlock = block.number;
            return pool;
        }
        uint256 reward = (block.number - pool.updateBlock) * rewardPerBlock;
        pool.lastAUR += (reward * AUR_PREC) / stakeAmount;
        pool.updateBlock = block.number;
        return pool;
    }

    function _updateRewards(Pool memory pool, StakeInfo memory info) internal pure {
        if (info.updateBlock == 0) {
            return;
        }
        info.pendingReward += (info.stakeAmount * pool.lastAUR) / AUR_PREC - info.rewardDebt;
    }

    function _updateRewardDebt(Pool memory pool, StakeInfo memory info) internal pure {
        info.rewardDebt = (info.stakeAmount * pool.lastAUR) / AUR_PREC;
    }

    function _unstake(
        StakeInfo memory vInfo,
        StakeInfo memory sInfo,
        uint256 amount
    ) internal pure returns (uint256 unstaked, uint256 reward) {
        uint256 maxAmount = sInfo.stakeAmount + sInfo.pendingReward;
        require(amount <= maxAmount, "Insufficient balance.");
        reward = sInfo.pendingReward;
        if (amount == 0) {
            amount = maxAmount;
        } else if (amount <= reward) {
            sInfo.pendingReward -= amount;
            return (0, amount);
        }
        sInfo.pendingReward = 0;
        unstaked = amount - reward;
        vInfo.stakeAmount -= unstaked;
        sInfo.stakeAmount -= unstaked;
    }

    function _sendValue(address payable to, uint256 amount) internal {
        (bool success, ) = to.call{value: amount}("");
        require(success, "Failed to send native token.");
    }

    function _setRewardPerBlock(uint256 amount) internal {
        validatorRewardPerBlock = amount / 5;
        stakerRewardPerBlock = amount - validatorRewardPerBlock;
        emit RewardPerBlockChanged(validatorRewardPerBlock, stakerRewardPerBlock);
    }

    function _setLockPeriod(uint32 period) internal {
        lockPeriod = period;
        emit LockPeriodChanged(period);
    }

    function _addValidator(address validator) internal {
        require(validator != address(0), "Invalid address.");
        require(_validators.length() < validatorLimit, "Validators are full.");
        require(
            !isActiveValidator(validator) && inactivePools[validator].updateBlock == 0,
            "Validator had been added."
        );
        _validators.add(validator);
        emit ValidatorChanged(validator, true);
    }

    function _authorizeUpgrade(address newImplementation) internal view override {
        require(msg.sender == keeper, "Only keeper can upgrade contract.");
    }
}
