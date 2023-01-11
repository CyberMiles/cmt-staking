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
    event AddValidator(address validator);
    event RemoveValidator(address validator);
    event Staking(address validator, uint256 amount);
    event Unstaking(
        address validator,
        uint256 index,
        uint256 unstakingAmount,
        uint256 stakerRewardAmount,
        uint256 validatorRewardAmount
    );
    event Withdraw(uint256 amount);
    event Received(uint256 amount);

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
        uint256 stakingCount;
    }

    struct StakingRecord {
        uint256 index;
        address stakerAddr;
        address validatorAddr;
        uint256 stakingAmount;
        uint256 stakingTime;
        uint256 unstakingTime;
    }

    mapping(address => uint256) public stakerIndexes;
    mapping(address => uint256) public validatorIndexes;
    // staker => validator => record indexes
    mapping(address => mapping(address => uint256[]))
        public stakingRecordIndexes;
    Staker[] public stakers;
    Validator[] public validators;
    StakingRecord[] public stakingRecords;
    uint256 public stakingTotalAmount;
    uint256 public validatorLimit;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address validatorAddr) public initializer {
        __Pausable_init();
        __Ownable_init();
        __UUPSUpgradeable_init();

        // 0为无效index
        stakers.push(Staker(address(0), 0, 0, 0));
        validators.push(Validator(address(0), 0, 0, false, 0));
        stakingRecords.push(StakingRecord(0, address(0), address(0), 0, 0, 0));

        // 最多21个验证节点
        validatorLimit = 21;

        // 最少1个验证节点
        validatorIndexes[validatorAddr] = 1;
        validators.push(Validator(validatorAddr, 0, 0, true, block.timestamp));
    }

    receive() external payable {
        emit Received(msg.value);
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

    // 增加质押节点，不能重复激活
    function addValidator(address validatorAddr) public onlyOwner {
        require(validatorAddr != address(0), "Invalid address.");

        (uint256 validCount, ) = getValidatorCount();
        require(validCount < validatorLimit, "Validators are full.");

        uint256 validatorIndex = validatorIndexes[validatorAddr];
        require(validatorIndex == 0, "Validator is already included.");

        validatorIndexes[validatorAddr] = validators.length;
        validators.push(Validator(validatorAddr, 0, 0, true, block.timestamp));

        emit AddValidator(validatorAddr);
    }

    // 删除质押节点
    function removeValidator(address validatorAddr) public onlyOwner {
        require(validatorAddr != address(0), "Invalid address.");

        (uint256 validCount, ) = getValidatorCount();
        require(validCount > 1, "Validators must be more than 1.");

        uint256 validatorIndex = validatorIndexes[validatorAddr];
        require(validatorIndex > 0, "Validator not Exist.");
        validators[validatorIndex].isValid = false;
        validators[validatorIndex].validChangeTime = block.timestamp;

        emit RemoveValidator(validatorAddr);
    }

    // 获取质押节点数，返回（有效节点数，总节点数）
    function getValidatorCount()
        public
        view
        onlyOwner
        returns (uint256, uint256)
    {
        uint256 validCount = 0;
        for (uint256 i = 0; i < validators.length; i++) {
            if (validators[i].isValid) {
                validCount++;
            }
        }

        return (validCount, validators.length);
    }

    // 获取某个质押节点状态
    function getValidatorState(address validatorAddr)
        public
        view
        onlyOwner
        returns (
            uint256,
            uint256,
            bool,
            uint256
        )
    {
        require(validatorAddr != address(0), "Invalid address.");

        uint256 validatorIndex = validatorIndexes[validatorAddr];
        require(validatorIndex > 0, "Validator not Exist.");
        return (
            validators[validatorIndex].stakingAmount,
            validators[validatorIndex].rewardAmount,
            validators[validatorIndex].isValid,
            validators[validatorIndex].validChangeTime
        );
    }

    // 质押节点提取奖励
    function reward(address payable to, uint amount) public whenNotPaused {
        uint256 validatorIndex = validatorIndexes[msg.sender];
        require(validatorIndex > 0, "Staker not Exist.");
        require(
            validators[validatorIndex].rewardAmount > amount,
            "Insufficient balance."
        );
        validators[validatorIndex].rewardAmount -= amount;

        to.transfer(amount);
        emit Withdraw(amount);
    }

    //////////////////////////////
    //          Staker          //
    //////////////////////////////

    // 质押，必须确保选择的质押节点有效
    function staking(address validatorAddr) public payable whenNotPaused {
        require(validatorAddr != address(0), "Invalid address.");
        require(msg.value > 0, "Staking amount must be greater than 0.");

        // 更新质押节点信息
        uint256 validatorIndex = validatorIndexes[validatorAddr];
        require(validatorIndex > 0, "Validator not Exist.");
        require(validators[validatorIndex].isValid, "Validator is invalid.");
        validators[validatorIndex].stakingAmount += msg.value;

        // 更新质押者信息
        uint256 stakerIndex = stakerIndexes[msg.sender];
        if (stakerIndex > 0) {
            stakers[stakerIndex].stakingAmount += msg.value;
        } else {
            stakerIndexes[msg.sender] = stakers.length;
            stakers.push(Staker(msg.sender, msg.value, 0, 0));
        }

        // 更新质押记录
        uint256 stakingRecordIndex = stakingRecords.length;
        stakingRecords.push(
            StakingRecord(
                stakingRecordIndex,
                msg.sender,
                validatorAddr,
                msg.value,
                block.timestamp,
                0
            )
        );
        stakingRecordIndexes[msg.sender][validatorAddr].push(
            stakingRecordIndex
        );

        // 更新总质押量
        stakingTotalAmount += msg.value;

        emit Staking(validatorAddr, msg.value);
    }

    // 解质押，只能按单条质押记录解质押，质押记录的Index需要通过getStakingRecords获取
    // 当质押记录的unstakingTime等于0时，此条记录处于质押状态；否则已经完成解质押
    function unstaking(address validatorAddr, uint256 recordIndex)
        public
        whenNotPaused
    {
        require(validatorAddr != address(0), "Invalid address.");
        require(recordIndex > 0, "Invalid index with 0.");
        require(
            stakingRecords[recordIndex].stakerAddr == msg.sender,
            "Invalid record index with staker address."
        );
        require(
            stakingRecords[recordIndex].validatorAddr == validatorAddr,
            "Invalid index with validator address."
        );
        require(
            stakingRecords[recordIndex].unstakingTime == 0,
            "Already unstaked."
        );

        // 保存解质押的时间
        stakingRecords[recordIndex].unstakingTime = block.timestamp;

        // 计算奖励
        uint256 stakerRewardAmount = 0;
        uint256 validatorRewardAmount = 0;
        (stakerRewardAmount, validatorRewardAmount) = computeReward(
            validatorAddr,
            recordIndex
        );

        // 更新质押者信息
        uint256 stakerIndex = stakerIndexes[msg.sender];
        require(stakerIndex > 0, "Staker not Exist.");
        stakers[stakerIndex].stakingAmount -= stakingRecords[recordIndex]
            .stakingAmount;
        stakers[stakerIndex].unstakingAmount += stakingRecords[recordIndex]
            .stakingAmount;
        stakers[stakerIndex].unstakingAmount += stakerRewardAmount; // 单利

        // 更新质押节点信息
        uint256 validatorIndex = validatorIndexes[validatorAddr];
        require(validatorIndex > 0, "Validator not Exist.");
        validators[validatorIndex].stakingAmount -= stakingRecords[recordIndex]
            .stakingAmount;
        validators[validatorIndex].rewardAmount += validatorRewardAmount;

        // 更新总质押量
        stakingTotalAmount -= stakingRecords[recordIndex].stakingAmount;

        emit Unstaking(
            validatorAddr,
            recordIndex,
            stakingRecords[recordIndex].stakingAmount,
            stakerRewardAmount,
            validatorRewardAmount
        );
    }

    // 质押者取款，收取1%的手续费
    function withdraw(address payable to, uint amount) public whenNotPaused {
        uint256 stakerIndex = stakerIndexes[msg.sender];
        require(stakerIndex > 0, "Staker not Exist.");
        require(
            stakers[stakerIndex].unstakingAmount > amount,
            "Insufficient balance."
        );
        stakers[stakerIndex].unstakingAmount -= amount;

        amount = amount * 99 / 100;
        to.transfer(amount);
        emit Withdraw(amount);
    }

    // 获取质押者状态
    function getStakerState()
        public
        view
        returns (
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        uint256 rewardAmount = 0;
        for (uint256 i = 0; i < validators.length; i++) {
            uint256[] memory recordIndexes = stakingRecordIndexes[msg.sender][
                validators[i].validatorAddr
            ];
            for (uint256 j = 0; j < recordIndexes.length; j++) {
                if (stakingRecords[j].unstakingTime == 0) {
                    uint256 stakerRewardAmount = 0;
                    (stakerRewardAmount, ) = computeReward(
                        validators[i].validatorAddr,
                        j
                    );
                    rewardAmount += stakerRewardAmount;
                }
            }
        }

        uint256 stakerIndex = stakerIndexes[msg.sender];
        require(stakerIndex > 0, "Staker not Exist");
        return (
            stakers[stakerIndex].stakingAmount,
            stakers[stakerIndex].unstakingAmount,
            stakers[stakerIndex].stakingCount,
            rewardAmount
        );
    }

    // 获取质押者的所有质押记录
    function getStakingRecords() public view returns (StakingRecord[] memory) {
        uint256 stakerIndex = stakerIndexes[msg.sender];
        require(stakerIndex > 0, "Staker not Exist");

        StakingRecord[] memory records = new StakingRecord[](
            stakers[stakerIndex].stakingCount
        );
        uint256 index = 0;
        for (uint256 i = 0; i < validators.length; i++) {
            uint256[] memory recordIndexes = stakingRecordIndexes[msg.sender][
                validators[i].validatorAddr
            ];
            for (uint256 j = 0; j < recordIndexes.length; j++) {
                records[index] = stakingRecords[j];
                index++;
            }
        }

        return records;
    }

    // 计算单条质押记录的奖励，同时计算质押者的奖励和质押节点的奖励
    // 1. 质押节点有效时，质押周期 = 解质押时间 - 质押时间
    // 2. 质押节点无效时，质押周期 = 质押节点无效时间 - 质押时间
    // 正常情况下，解质押时间 > 质押时间 或者 质押节点无效时间 > 质押时间
    function computeReward(address validatorAddr, uint256 recordIndex)
        private
        view
        returns (uint256, uint256)
    {
        uint256 stakingInterval = 0;
        uint256 validatorIndex = validatorIndexes[validatorAddr];
        require(validatorIndex > 0, "Validator not Exist");
        if (validators[validatorIndex].isValid) {
            require(
                stakingRecords[recordIndex].unstakingTime >
                    stakingRecords[recordIndex].stakingTime,
                "Unstake time error."
            );
            stakingInterval =
                stakingRecords[recordIndex].unstakingTime -
                stakingRecords[recordIndex].stakingTime;
        } else {
            if (
                validators[validatorIndex].validChangeTime >
                stakingRecords[recordIndex].stakingTime
            ) {
                stakingInterval =
                    validators[validatorIndex].validChangeTime -
                    stakingRecords[recordIndex].stakingTime;
            }
        }

        uint256 stakerRewardAmount = (stakingRecords[recordIndex]
            .stakingAmount *
            stakingInterval *
            6) / (86400 * 100 * 365);
        uint256 validatorRewardAmount = (stakingRecords[recordIndex]
            .stakingAmount *
            stakingInterval *
            2) / (86400 * 100 * 365);
        return (stakerRewardAmount, validatorRewardAmount);
    }
}
