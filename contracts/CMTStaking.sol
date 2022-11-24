// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract CMTStaking is
    Initializable,
    PausableUpgradeable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    event ValidatorChanged(address validator, bool isValid);
    event Stake(
        address indexed staker,
        address indexed validator,
        uint256 recordIndex,
        uint256 amount
    );
    event Unstake(
        address indexed staker,
        address indexed validator,
        uint256 recordIndex,
        uint256 unstakingAmount,
        uint256 stakerRewardAmount,
        uint256 validatorRewardAmount
    );
    event Withdrawal(address indexed from, address indexed to, uint256 amount);
    event Received(address indexed sender, uint256 amount);
    event FeeCharged(uint256 amount);
    event FeeCollected(address indexed to, uint256 amount);

    struct Validator {
        address validatorAddr;
        uint256 stakingAmount;
        uint256 rewardAmount;
        bool isValid;
        uint128 validChangeTime;
    }

    struct Staker {
        address stakerAddr;
        uint256 stakingAmount;
        uint256 unstakingAmount;
    }

    struct StakingRecord {
        address stakerAddr;
        address validatorAddr;
        uint256 stakingAmount;
        uint128 stakingTime;
        uint128 unstakingTime;
    }

    mapping(address => Staker) public stakers;
    mapping(address => Validator) public validators;
    // staker => validator => staking records
    mapping(address => mapping(address => StakingRecord[]))
        public stakingRecords;
    uint256 public stakingTotalAmount;
    uint256 public totalValidatorCount;
    uint256 public activatedValidatorCount;
    uint256 public feeUntaken;
    uint256 public validatorLimit;

    uint256 public constant DECIMALS = 18;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address validatorAddr) external initializer {
        __Pausable_init();
        __Ownable_init();
        __UUPSUpgradeable_init();

        // 最多21个验证节点
        validatorLimit = 21;

        require(validatorAddr != address(0), "Invalid address.");

        // 最少1个验证节点
        validators[validatorAddr] = Validator(
            validatorAddr,
            0,
            0,
            true,
            uint128(block.timestamp)
        );
        totalValidatorCount++;
        activatedValidatorCount++;
    }

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyOwner
    {}

    function getVersion() external pure returns (uint256) {
        return 1;
    }

    /////////////////////////////////
    //          Validator          //
    /////////////////////////////////

    // 设置质押节点最大值
    function setValidatorLimit(uint256 limit) external onlyOwner {
        require(limit >= activatedValidatorCount, "Invalid limit value.");
        validatorLimit = limit;
    }

    // 增加质押节点，不能重复添加
    function addValidator(address validatorAddr) external onlyOwner {
        require(validatorAddr != address(0), "Invalid address.");
        require(
            activatedValidatorCount < validatorLimit,
            "Validators are full."
        );
        require(
            validators[validatorAddr].validatorAddr == address(0),
            "Validator had been added"
        );

        validators[validatorAddr] = Validator(
            validatorAddr,
            0,
            0,
            true,
            uint128(block.timestamp)
        );
        totalValidatorCount++;
        activatedValidatorCount++;

        emit ValidatorChanged(validatorAddr, true);
    }

    // 删除质押节点
    function removeValidator(address validatorAddr) external onlyOwner {
        require(
            activatedValidatorCount > 1,
            "Validators should be at least 1."
        );
        require(
            validators[validatorAddr].isValid,
            "Validator not exist or has been removed."
        );

        Validator storage validator = validators[validatorAddr];
        validator.isValid = false;
        validator.validChangeTime = uint128(block.timestamp);
        activatedValidatorCount--;

        emit ValidatorChanged(validatorAddr, false);
    }

    // 质押节点提取奖励
    function reward(address payable to, uint256 amount) external whenNotPaused {
        Validator storage validator = validators[msg.sender];

        require(
            amount > 0 && amount <= validator.rewardAmount,
            "Invalid amount or insufficient balance."
        );
        unchecked {
            validator.rewardAmount -= amount;
        }

        sendValue(to, amount);
        emit Withdrawal(msg.sender, to, amount);
    }

    //////////////////////////////
    //          Staker          //
    //////////////////////////////

    // 质押，必须确保选择的质押节点有效
    function stake(address validatorAddr) external payable whenNotPaused {
        require(
            msg.value >= 10**DECIMALS,
            "Staking amount must be greater equal than 1e18."
        );

        // 更新质押节点信息
        Validator storage validator = validators[validatorAddr];
        require(validator.isValid, "Validator not exist or has been removed.");
        validator.stakingAmount += msg.value;

        // 更新质押者信息
        Staker storage staker = stakers[msg.sender];
        if (staker.stakerAddr != address(0)) {
            staker.stakingAmount += msg.value;
        } else {
            staker.stakerAddr = msg.sender;
            staker.stakingAmount = msg.value;
        }

        // 更新质押记录
        uint256 recordIndex = stakingRecords[msg.sender][validatorAddr].length;
        stakingRecords[msg.sender][validatorAddr].push(
            StakingRecord(
                msg.sender,
                validatorAddr,
                msg.value,
                uint128(block.timestamp),
                0
            )
        );

        // 更新总质押量
        stakingTotalAmount += msg.value;

        emit Stake(msg.sender, validatorAddr, recordIndex, msg.value);
    }

    // 解质押，只能按单条质押记录解质押，recordIndex可以从Stake事件或stakingRecords获取
    // 当质押记录的unstakingTime等于0时，此条记录处于质押状态；否则已经完成解质押
    function unstake(address validatorAddr, uint256 recordIndex)
        external
        whenNotPaused
    {
        StakingRecord storage stakingRecord = stakingRecords[msg.sender][
            validatorAddr
        ][recordIndex];
        require(
            stakingRecord.stakerAddr == msg.sender,
            "Staking record not exist."
        );
        require(
            stakingRecord.unstakingTime == 0,
            "Staking record is already unstaked."
        );

        // 保存解质押的时间
        stakingRecord.unstakingTime = uint128(block.timestamp);

        // 计算奖励
        (
            uint256 stakerRewardAmount,
            uint256 validatorRewardAmount
        ) = computeReward(stakingRecord);

        // 更新质押者信息
        Staker storage staker = stakers[msg.sender];
        staker.stakingAmount -= stakingRecord.stakingAmount;
        staker.unstakingAmount += stakingRecord.stakingAmount;
        staker.unstakingAmount += stakerRewardAmount; // 单利

        // 更新质押节点信息
        Validator storage validator = validators[validatorAddr];
        validator.stakingAmount -= stakingRecord.stakingAmount;
        validator.rewardAmount += validatorRewardAmount;

        // 更新总质押量
        stakingTotalAmount -= stakingRecord.stakingAmount;

        emit Unstake(
            msg.sender,
            validatorAddr,
            recordIndex,
            stakingRecord.stakingAmount,
            stakerRewardAmount,
            validatorRewardAmount
        );
    }

    // 质押者取款（本金+奖励），收取1%的手续费
    function withdraw(address payable to, uint256 amount)
        external
        whenNotPaused
    {
        Staker storage staker = stakers[msg.sender];
        require(
            amount > 0 && amount <= staker.unstakingAmount,
            "Invalid amount or insufficient balance."
        );
        uint256 withdrawAmount;
        uint256 fee;
        unchecked {
            staker.unstakingAmount -= amount;
            withdrawAmount = (amount * 99) / 100;
            fee = amount - withdrawAmount;
        }
        feeUntaken += fee;
        emit FeeCharged(fee);
        sendValue(to, withdrawAmount);
        emit Withdrawal(msg.sender, to, withdrawAmount);
    }

    // 合约owner取走手续费
    function collectFee(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid address.");
        require(
            amount > 0 && amount <= feeUntaken,
            "Invalid amount or insufficient balance."
        );
        unchecked {
            feeUntaken -= amount;
        }
        sendValue(to, amount);
        emit FeeCollected(to, amount);
    }

    // 计算单条质押记录的奖励，同时计算质押者的奖励和质押节点的奖励
    // 1. 质押节点有效时，质押周期 = 解质押时间 - 质押时间
    // 2. 质押节点无效时，质押周期 = 质押节点无效时间 - 质押时间
    // 正常情况下，解质押时间 > 质押时间 或者 质押节点无效时间 > 质押时间
    function computeReward(StakingRecord memory stakingRecord)
        private
        view
        returns (uint256, uint256)
    {
        uint256 stakingInterval = 0;
        Validator memory validator = validators[stakingRecord.validatorAddr];

        if (validator.isValid) {
            require(
                stakingRecord.unstakingTime > stakingRecord.stakingTime,
                "Unstake time error."
            );
            stakingInterval =
                stakingRecord.unstakingTime -
                stakingRecord.stakingTime;
        } else {
            stakingInterval =
                validator.validChangeTime -
                stakingRecord.stakingTime;
        }

        uint256 stakerRewardAmount = (stakingRecord.stakingAmount *
            stakingInterval *
            6) / (86400 * 100 * 365);
        uint256 validatorRewardAmount = (stakingRecord.stakingAmount *
            stakingInterval *
            2) / (86400 * 100 * 365);
        return (stakerRewardAmount, validatorRewardAmount);
    }

    function sendValue(address payable to, uint256 amount) private {
        (bool success, ) = to.call{value: amount}("");
        require(success, "Failed to send native token.");
    }
}
