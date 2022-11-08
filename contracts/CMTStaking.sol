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
    event AddValidator(address validator, bool isExist);
    event RemoveValidator(address validator, bool isExist);
    event Staking(address validator, uint256 amount);
    event Unstaking(uint256 amount);
    event Withdraw(uint256 amount);
    event Reward(uint256 amount);
    event Received(uint256 amount);

    struct StakingBalance {
        uint256 stakingAmount;
        uint256 unstakingAmount;
        uint256 unstakingTime;
    }

    struct Validator {
        address validatorAddr;
        uint256 stakingAmount;
    }

    struct StakingRecord {
        address userAddr;
        address validatorAddr;
        uint256 amount;
    }

    address[] public stakers;
    Validator[] public validators;
    StakingRecord[] public stakingRecords;
    mapping(address => StakingBalance) public stakingBalances;
    mapping(address => mapping(address => uint256)) public stakingIndexes;
    uint256 public stakingTotalAmount;
    uint256 public validatorLimit;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize() public initializer {
        __Pausable_init();
        __Ownable_init();
        __UUPSUpgradeable_init();

        // stakingIndexes中默认值为0，所以0为无效索引，需要在stakingRecords中的0索引初始化一个无效记录。
        stakingRecords.push(StakingRecord(address(0), address(0), 0));
        validatorLimit = 21;
    }

    function getVersion() public pure returns (uint256) {
        return 1;
    }

    function setValidatorLimit(uint256 limit) public onlyOwner whenNotPaused {
        validatorLimit = limit;
    }

    function addValidator(address validator) public onlyOwner whenNotPaused {
        require(validator != address(0), "Invalid address.");
        require(validators.length < validatorLimit, "Validator is full.");

        bool isExist = false;
        for (uint256 i = 0; i < validators.length; i++) {
            if (validators[i].validatorAddr == validator) {
                isExist = true;
                break;
            }
        }

        if (!isExist) {
            validators.push(Validator(validator, 0));
        }

        emit AddValidator(validator, isExist);
    }

    function removeValidator(address validator) public onlyOwner whenNotPaused {
        require(validator != address(0), "Invalid address.");

        bool isExist = false;
        for (uint256 i = 0; i < validators.length; i++) {
            if (validators[i].validatorAddr == validator) {
                isExist = true;
                validators[i] = validators[validators.length - 1];
                validators.pop();
                break;
            }
        }

        emit RemoveValidator(validator, isExist);
    }

    function getValidatorCount()
        public
        view
        onlyOwner
        whenNotPaused
        returns (uint256)
    {
        return validators.length;
    }

    function staking(address validator) public payable whenNotPaused {
        require(validator != address(0), "Invalid address.");
        require(msg.value > 0, "Staking amount must be greater than 0.");
        require(
            stakingBalances[msg.sender].stakingAmount + msg.value >
                stakingBalances[msg.sender].stakingAmount
        );

        bool isExist = false;
        for (uint256 i = 0; i < stakers.length; i++) {
            if (stakers[i] == msg.sender) {
                isExist = true;
            }
        }
        if (!isExist) {
            stakers.push(msg.sender);
        }

        uint256 index = stakingIndexes[msg.sender][validator];
        if (index == 0) {
            index = stakingRecords.length;
            stakingIndexes[msg.sender][validator] = index;
            stakingRecords.push(StakingRecord(msg.sender, validator, 0));
        }
        stakingBalances[msg.sender].stakingAmount += msg.value;
        stakingRecords[index].amount += msg.value;
        stakingTotalAmount += msg.value;
        emit Staking(validator, msg.value);
    }

    function unstaking(uint256 _amount) public whenNotPaused {
        require(
            stakingBalances[msg.sender].stakingAmount > _amount,
            "Insufficient balance."
        );
        require(
            stakingBalances[msg.sender].stakingAmount - _amount <
                stakingBalances[msg.sender].stakingAmount
        );

        uint256 remain = _amount;
        for (uint256 i = 0; i < validators.length; i++) {
            uint256 index = stakingIndexes[msg.sender][
                validators[i].validatorAddr
            ];
            if (stakingRecords[index].amount >= remain) {
                stakingRecords[index].amount -= remain;
                validators[i].stakingAmount -= remain;
                break;
            } else {
                remain -= stakingRecords[index].amount;
                validators[i].stakingAmount -= stakingRecords[index].amount;
                stakingRecords[index].amount = 0;
            }
        }
        stakingBalances[msg.sender].stakingAmount -= _amount;
        stakingBalances[msg.sender].unstakingAmount += _amount;
        stakingBalances[msg.sender].unstakingTime = block.timestamp;
        stakingTotalAmount -= _amount;
        emit Unstaking(_amount);
    }

    function withdraw(address payable _to) public whenNotPaused {
        // 最后一次unstake时间的7天后可以提取。
        require(
            block.timestamp - stakingBalances[msg.sender].unstakingTime >
                7 * 24 * 3600,
            "Time Lock."
        );
        require(
            stakingBalances[msg.sender].unstakingAmount > 0,
            "Insufficient balance."
        );

        stakingBalances[msg.sender].unstakingAmount = 0;
        uint256 unstakingAmount = stakingBalances[msg.sender].unstakingAmount;
        _to.transfer(unstakingAmount);
        emit Withdraw(unstakingAmount);
    }

    function reward() public onlyOwner whenNotPaused {
        // staker奖励分发，分发到staking中(复利)
        // 如果需要实现单利，则分发unstaking中
        for (uint256 i = 0; i < stakers.length; i++) {
            stakingBalances[stakers[i]].stakingAmount +=
                (stakingBalances[stakers[i]].stakingAmount * 6) /
                100;
            // stakingBalances[stakers[i]].unstakingAmount += stakingBalances[stakers[i]].stakingAmount * 6 / 100;
        }

        // validator奖励分发，分发到账户余额中
        for (uint256 i = 0; i < validators.length; i++) {
            payable(validators[i].validatorAddr).transfer(
                (validators[i].stakingAmount * 2) / 100
            );
        }
    }

    function getStakingBalance()
        public
        view
        returns (
            uint256,
            uint256,
            uint256
        )
    {
        return (
            stakingBalances[msg.sender].stakingAmount,
            stakingBalances[msg.sender].unstakingAmount,
            stakingBalances[msg.sender].unstakingTime
        );
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
}
