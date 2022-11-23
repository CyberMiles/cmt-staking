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
    enum Role {
        Validator,
        Staker
    }

    event AddValidator(address validator);
    event RemoveValidator(address validator);
    event Staking(
        address indexed staker,
        address indexed validator,
        uint256 timestamp,
        uint256 amount
    );
    event Unstaking(
        address indexed staker,
        address indexed validator,
        uint256 timestamp,
        uint256 unstakingAmount,
        uint256 stakerRewardAmount,
        uint256 validatorRewardAmount
    );
    event Withdraw(uint256 amount, address indexed to, Role indexed role);
    event Received(uint256 amount, address indexed sender);
    event CollectedFee(uint256 amount, address indexed to);

    struct Validator {
        address validatorAddr;
        uint256 stakingAmount;
        uint256 rewardAmount;
        bool isValid;
        uint256 validChangeTime;
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
        uint256 stakingTime;
        uint256 unstakingTime;
    }

    mapping(address => Staker) public stakers;
    mapping(address => Validator) public validators;
    // staker => validator => timestamp => stakingRecord
    mapping(address => mapping(address => mapping(uint256 => StakingRecord)))
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

    function initialize(address validatorAddr) public initializer {
        __Pausable_init();
        __Ownable_init();
        __UUPSUpgradeable_init();

        // 最多21个验证节点
        validatorLimit = 21;

        // 最少1个验证节点
        validators[validatorAddr] = Validator(
            validatorAddr,
            0,
            0,
            true,
            block.timestamp
        );
        totalValidatorCount++;
        activatedValidatorCount++;
    }

    receive() external payable {
        emit Received(msg.value, msg.sender);
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyOwner
    {}

    function getVersion() public pure returns (uint256) {
        return 1;
    }

    /////////////////////////////////
    //          Validator          //
    /////////////////////////////////

        // 设置质押节点最大值
    function setValidatorLimit(uint256 limit) public onlyOwner {
        validatorLimit = limit;
    }

    // 增加质押节点，不能重复添加
    function addValidator(address validatorAddr) public onlyOwner {
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
            block.timestamp
        );
        totalValidatorCount++;
        activatedValidatorCount++;

        emit AddValidator(validatorAddr);
    }

    // 删除质押节点
    function removeValidator(address validatorAddr) public onlyOwner {
        require(validatorAddr != address(0), "Invalid address.");
        require(
            activatedValidatorCount > 1,
            "Validators should be at least 1."
        );
        require(
            validators[validatorAddr].validatorAddr != address(0),
            "Validator not exist."
        );

        Validator storage validator = validators[validatorAddr];
        validator.isValid = false;
        validator.validChangeTime = block.timestamp;
        activatedValidatorCount--;

        emit RemoveValidator(validatorAddr);
    }

    // 质押节点提取奖励
    function reward(address payable to, uint256 amount) public whenNotPaused {
        Validator storage validator = validators[msg.sender];

        require(validator.validatorAddr != address(0), "Staker not exist.");
        require(amount <= validator.rewardAmount, "Insufficient balance.");
        validator.rewardAmount -= amount;

        to.transfer(amount);
        emit Withdraw(amount, to, Role.Validator);
    }

    //////////////////////////////
    //          Staker          //
    //////////////////////////////

    // 质押，必须确保选择的质押节点有效
    function staking(address validatorAddr) public payable whenNotPaused {
        require(validatorAddr != address(0), "Invalid address.");
        require(msg.value >= 10**DECIMALS, "Staking amount must be greater equal than 1e18.");

        // 更新质押节点信息
        Validator storage validator = validators[validatorAddr];
        require(validator.validatorAddr != address(0), "Validator not exist.");
        require(validator.isValid, "Validator is invalid.");
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
        stakingRecords[msg.sender][validatorAddr][
            block.timestamp
        ] = StakingRecord(
            msg.sender,
            validatorAddr,
            msg.value,
            block.timestamp,
            0
        );

        // 更新总质押量
        stakingTotalAmount += msg.value;

        emit Staking(msg.sender, validatorAddr, block.timestamp, msg.value);
    }

    // 解质押，只能按单条质押记录解质押，timestamp可以从Staking事件获取
    // 当质押记录的unstakingTime等于0时，此条记录处于质押状态；否则已经完成解质押
    function unstaking(address validatorAddr, uint256 timestamp)
        public
        whenNotPaused
    {
        require(validatorAddr != address(0), "Invalid address.");
        StakingRecord storage stakingRecord = stakingRecords[msg.sender][
            validatorAddr
        ][timestamp];
        require(stakingRecord.stakingAmount >= 10**DECIMALS, "Invalid staking record.");
        require(
            stakingRecord.stakerAddr == msg.sender,
            "Invalid staking record with staker address."
        );
        require(
            stakingRecord.validatorAddr == validatorAddr,
            "Invalid staking record with validator address."
        );
        require(
            stakingRecord.unstakingTime == 0,
            "Staking record is already unstaked."
        );

        // 保存解质押的时间
        stakingRecord.unstakingTime = block.timestamp;

        // 计算奖励
        (
            uint256 stakerRewardAmount,
            uint256 validatorRewardAmount
        ) = computeReward(msg.sender, validatorAddr, timestamp);

        // 更新质押者信息
        Staker storage staker = stakers[msg.sender];
        require(staker.stakerAddr != address(0), "Staker not exist.");
        staker.stakingAmount -= stakingRecord.stakingAmount;
        staker.unstakingAmount += stakingRecord.stakingAmount;
        staker.unstakingAmount += stakerRewardAmount; // 单利

        // 更新质押节点信息
        Validator storage validator = validators[validatorAddr];
        require(validator.validatorAddr != address(0), "Validator not Exist.");
        validator.stakingAmount -= stakingRecord.stakingAmount;
        validator.rewardAmount += validatorRewardAmount;

        // 更新总质押量
        stakingTotalAmount -= stakingRecord.stakingAmount;

        emit Unstaking(
            msg.sender,
            validatorAddr,
            block.timestamp,
            stakingRecord.stakingAmount,
            stakerRewardAmount,
            validatorRewardAmount
        );
    }

    // 质押者取款（本金+奖励），收取1%的手续费
    function withdraw(address payable to, uint256 amount) public whenNotPaused {
        Staker storage staker = stakers[msg.sender];
        require(staker.stakerAddr != address(0), "Staker not exist.");
        require(amount <= staker.unstakingAmount, "Insufficient balance.");
        staker.unstakingAmount -= amount;

        uint256 withdrawAmount = (amount * 99) / 100;
        uint256 fee = amount - withdrawAmount;
        feeUntaken += fee;
        to.transfer(withdrawAmount);
        emit Withdraw(withdrawAmount, to, Role.Staker);
    }

    // 合约owner取走手续费
    function collectFee(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "Invalid address.");
        require(amount <= feeUntaken, "Insufficient balance.");

        feeUntaken -= amount;
        to.transfer(amount);
        emit CollectedFee(amount, to);
    }

    // 计算单条质押记录的奖励，同时计算质押者的奖励和质押节点的奖励
    // 1. 质押节点有效时，质押周期 = 解质押时间 - 质押时间
    // 2. 质押节点无效时，质押周期 = 质押节点无效时间 - 质押时间
    // 正常情况下，解质押时间 > 质押时间 或者 质押节点无效时间 > 质押时间
    function computeReward(
        address staker,
        address validatorAddr,
        uint256 timestamp
    ) private view returns (uint256, uint256) {
        uint256 stakingInterval = 0;
        Validator memory validator = validators[validatorAddr];
        StakingRecord memory stakingRecord = stakingRecords[staker][
            validatorAddr
        ][timestamp];

        if (validator.isValid) {
            require(
                stakingRecord.unstakingTime > stakingRecord.stakingTime,
                "Unstake time error."
            );
            stakingInterval =
                stakingRecord.unstakingTime -
                stakingRecord.stakingTime;
        } else {
            if (validator.validChangeTime > stakingRecord.stakingTime) {
                stakingInterval =
                    validator.validChangeTime -
                    stakingRecord.stakingTime;
            }
        }

        uint256 stakerRewardAmount = (stakingRecord.stakingAmount *
            stakingInterval *
            6) / (86400 * 100 * 365);
        uint256 validatorRewardAmount = (stakingRecord.stakingAmount *
            stakingInterval *
            2) / (86400 * 100 * 365);
        return (stakerRewardAmount, validatorRewardAmount);
    }
}
