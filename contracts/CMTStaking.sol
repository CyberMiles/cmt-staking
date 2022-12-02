// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

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
    uint256 public totalStakingAmount;
    uint256 public totalValidatorCount;
    uint256 public activatedValidatorCount;
    uint256 public feeUntaken;
    uint256 public validatorLimit;

    uint256 public immutable MIN_STAKE_AMOUNT;

    event Received(address indexed sender, uint256 amount);
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
        uint256 validatorRewardAmount,
        address indexed recipient,
        uint256 feeAmount
    );
    event ValidatorWithdrawal(
        address indexed validator,
        address indexed recipient,
        uint256 amount
    );
    event FeeWithdrawal(
        address indexed operator,
        address indexed recipient,
        uint256 amount
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(uint256 minStakeAmount) {
        _disableInitializers();
        require(minStakeAmount >= 10 ** 9, "Invalid minimal stake amount.");
        MIN_STAKE_AMOUNT = minStakeAmount;
    }

    function initialize(address validatorAddr) external initializer {
        __ReentrancyGuard_init();
        __Pausable_init();
        __Ownable_init();
        __UUPSUpgradeable_init();

        // default maximum 21 validators
        validatorLimit = 21;

        // minimum 1 validator
        addValidator(validatorAddr);
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

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    function getVersion() external pure returns (uint256) {
        return 1;
    }

    /////////////////////////////////
    //          Validator          //
    /////////////////////////////////

    // set maximum num of validators
    function setValidatorLimit(uint256 limit) external onlyOwner {
        require(limit >= activatedValidatorCount, "Invalid limit value.");
        validatorLimit = limit;
    }

    // add validator
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
            uint128(block.timestamp)
        );
        totalValidatorCount++;
        activatedValidatorCount++;

        emit ValidatorChanged(validatorAddr, true);
    }

    // deactivate validator
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

    // validator withdraw its rewards
    function validatorWithdraw(
        address payable recipient,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        Validator storage validator = validators[msg.sender];

        require(
            amount > 0 && amount <= validator.rewardAmount,
            "Invalid amount or insufficient balance."
        );
        validator.rewardAmount -= amount;

        emit ValidatorWithdrawal(msg.sender, recipient, amount);
        sendValue(recipient, amount);
    }

    //////////////////////////////
    //          Staker          //
    //////////////////////////////

    // stake into a valid validator
    function stake(address validatorAddr) external payable whenNotPaused {
        require(
            msg.value >= MIN_STAKE_AMOUNT,
            "Staking amount must >= MIN_STAKE_AMOUNT."
        );

        // update validator info
        Validator storage validator = validators[validatorAddr];
        require(validator.isValid, "Validator not exist or has been removed.");
        validator.stakingAmount += msg.value;

        // update staker info
        Staker storage staker = stakers[msg.sender];
        if (staker.stakerAddr != address(0)) {
            staker.stakingAmount += msg.value;
        } else {
            staker.stakerAddr = msg.sender;
            staker.stakingAmount = msg.value;
        }

        // add staking record
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

        // update total staking amount
        totalStakingAmount += msg.value;

        emit Stake(msg.sender, validatorAddr, recordIndex, msg.value);
    }

    // can only unstake with single stakingRecord
    // RecordIndex can be found from Stake event or state variable stakingRecords
    // A stakingRecord is still under staked when unstakingTime equals 0, vice versa
    function unstake(
        address validatorAddr,
        uint256 recordIndex,
        address payable recipient
    ) external nonReentrant whenNotPaused {
        StakingRecord storage stakingRecord = stakingRecords[msg.sender][
            validatorAddr
        ][recordIndex];
        require(
            stakingRecord.unstakingTime == 0,
            "Staking record is already unstaked."
        );

        // update unstaking time
        stakingRecord.unstakingTime = uint128(block.timestamp);

        // calculate staking reward for staker and validator
        (
            uint256 stakerRewardAmount,
            uint256 validatorRewardAmount
        ) = computeReward(stakingRecord);

        uint256 stakingAmount = stakingRecord.stakingAmount;

        // update staker info
        stakers[msg.sender].stakingAmount -= stakingAmount;

        // update validator info
        Validator storage validator = validators[validatorAddr];
        validator.stakingAmount -= stakingAmount;
        validator.rewardAmount += validatorRewardAmount;

        // update total staking amount
        totalStakingAmount -= stakingAmount;

        // calculate and charge fee from staker
        uint256 unstakedValue = stakingAmount + stakerRewardAmount;
        uint256 stakerWithdrawAmount = (unstakedValue * 99) / 100;
        uint256 fee = unstakedValue - stakerWithdrawAmount;
        feeUntaken += fee;

        emit Unstake(
            msg.sender,
            validatorAddr,
            recordIndex,
            stakingAmount,
            stakerRewardAmount,
            validatorRewardAmount,
            recipient,
            fee
        );

        // send (amount + reward) after fee deducted
        sendValue(recipient, stakerWithdrawAmount);
    }

    // contract owner withdraw collected fee
    function withdrawFee(
        address payable recipient,
        uint256 amount
    ) external nonReentrant onlyOwner {
        require(recipient != address(0), "Invalid address.");
        require(
            amount > 0 && amount <= feeUntaken,
            "Invalid amount or insufficient balance."
        );
        feeUntaken -= amount;
        emit FeeWithdrawal(msg.sender, recipient, amount);
        sendValue(recipient, amount);
    }

    // calculate reward of staker and validator for single stakingRecord when unstaking
    // 1. when validator is valid: stakingInterval = unstakingTs - stakingTs
    // 2. when validator is invalid: stakingInterval = invalidTs - stakingTs
    // 3. APY 6% reward for staker
    // 4. APY 2% reward for validator
    // 5. reward = stakingAmount * stakingTime * APY / oneYear
    function computeReward(
        StakingRecord memory stakingRecord
    ) private view returns (uint256, uint256) {
        Validator memory validator = validators[stakingRecord.validatorAddr];

        uint256 rewardEndTime;
        if (validator.isValid) {
            rewardEndTime = stakingRecord.unstakingTime;
        } else {
            rewardEndTime = validator.validChangeTime;
        }

        uint256 stakingInterval = rewardEndTime - stakingRecord.stakingTime;

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
