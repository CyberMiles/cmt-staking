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
    event Unstaking(uint256 amount);
    event Withdraw(uint256 amount);
    event Reward(uint256 amount);
    event Received(uint256 amount);

    struct Staker {
        address stakerAddr;
        uint256 stakingAmount;
        uint256 unstakingAmount;
        uint256 unstakingTime;
    }

    struct Validator {
        address validatorAddr;
        uint256 stakingAmount;
        bool isValid;
    }

    struct StakingRecord {
        address userAddr;
        address validatorAddr;
        uint256 amount;
    }

    Staker[] public stakers;
    Validator[] public validators;
    StakingRecord[] public stakingRecords;
    mapping(address => uint256) public stakerIndexes;
    mapping(address => uint256) public validatorIndexes;
    mapping(address => mapping(address => uint256)) public stakingIndexes;
    uint256 public stakingTotalAmount;
    uint256 public validatorLimit;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address validator) public initializer {
        __Pausable_init();
        __Ownable_init();
        __UUPSUpgradeable_init();

        // 最多21个验证节点
        validatorLimit = 21;
        // 部署节点需要预置1个验证节点
        validators.push(Validator(validator, 0, true));
        validatorIndexes[validator] = validators.length;
    }

    function getVersion() public pure returns (uint256) {
        return 1;
    }

    function setValidatorLimit(uint256 limit) public onlyOwner whenNotPaused {
        validatorLimit = limit;
    }

    function addValidator(address validator) public onlyOwner whenNotPaused {
        require(validator != address(0), "Invalid address.");
        require(validators.length < validatorLimit, "Validators are full.");

        uint256 index = validatorIndexes[validator];
        if (index > 0) {
            validators[index - 1].isValid = true;
        } else {
            validators.push(Validator(validator, 0, true));
            validatorIndexes[validator] = validators.length;
        }

        emit AddValidator(validator);
    }

    function removeValidator(address validator) public onlyOwner whenNotPaused {
        require(validator != address(0), "Invalid address.");
        require(validators.length > 1, "Validators must be more than 1.");

        uint256 index = validatorIndexes[validator];
        if (index > 0) {
            validators[index - 1].isValid = false;
            emit RemoveValidator(validator);
        }
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

    function getValidatorState(address validator)
        public
        view
        onlyOwner
        whenNotPaused
        returns (uint256, bool)
    {
        require(validator != address(0), "Invalid address.");

        uint256 index = validatorIndexes[validator];
        if (index > 0) {
            return (
                validators[index - 1].stakingAmount,
                validators[index - 1].isValid
            );
        }

        return (0, false);
    }

    // function staking(address validator) public payable whenNotPaused {
    //     require(validator != address(0), "Invalid address.");
    //     require(msg.value > 0, "Staking amount must be greater than 0.");
    //     require(
    //         stakingBalances[msg.sender].stakingAmount + msg.value >
    //             stakingBalances[msg.sender].stakingAmount
    //     );

    //     bool isExist = false;
    //     for (uint256 i = 0; i < stakers.length; i++) {
    //         if (stakers[i] == msg.sender) {
    //             isExist = true;
    //         }
    //     }
    //     if (!isExist) {
    //         stakers.push(msg.sender);
    //     }

    //     uint256 index = stakingIndexes[msg.sender][validator];
    //     if (index == 0) {
    //         index = stakingRecords.length;
    //         stakingIndexes[msg.sender][validator] = index;
    //         stakingRecords.push(StakingRecord(msg.sender, validator, 0));
    //     }
    //     stakingBalances[msg.sender].stakingAmount += msg.value;
    //     stakingRecords[index].amount += msg.value;
    //     stakingTotalAmount += msg.value;
    //     emit Staking(validator, msg.value);
    // }

    // function unstaking(uint256 _amount) public whenNotPaused {
    //     require(
    //         stakingBalances[msg.sender].stakingAmount > _amount,
    //         "Insufficient balance."
    //     );
    //     require(
    //         stakingBalances[msg.sender].stakingAmount - _amount <
    //             stakingBalances[msg.sender].stakingAmount
    //     );

    //     uint256 remain = _amount;
    //     for (uint256 i = 0; i < validators.length; i++) {
    //         uint256 index = stakingIndexes[msg.sender][
    //             validators[i].validatorAddr
    //         ];
    //         if (stakingRecords[index].amount >= remain) {
    //             stakingRecords[index].amount -= remain;
    //             validators[i].stakingAmount -= remain;
    //             break;
    //         } else {
    //             remain -= stakingRecords[index].amount;
    //             validators[i].stakingAmount -= stakingRecords[index].amount;
    //             stakingRecords[index].amount = 0;
    //         }
    //     }
    //     stakingBalances[msg.sender].stakingAmount -= _amount;
    //     stakingBalances[msg.sender].unstakingAmount += _amount;
    //     stakingBalances[msg.sender].unstakingTime = block.timestamp;
    //     stakingTotalAmount -= _amount;
    //     emit Unstaking(_amount);
    // }

    // function withdraw(address payable _to) public whenNotPaused {
    //     // 最后一次unstake时间的7天后可以提取。
    //     require(
    //         block.timestamp - stakingBalances[msg.sender].unstakingTime >
    //             7 * 24 * 3600,
    //         "Time Lock."
    //     );
    //     require(
    //         stakingBalances[msg.sender].unstakingAmount > 0,
    //         "Insufficient balance."
    //     );

    //     stakingBalances[msg.sender].unstakingAmount = 0;
    //     uint256 unstakingAmount = stakingBalances[msg.sender].unstakingAmount;
    //     _to.transfer(unstakingAmount);
    //     emit Withdraw(unstakingAmount);
    // }

    // function reward() public onlyOwner whenNotPaused {
    //     // staker奖励分发，分发到staking中(复利)
    //     // 如果需要实现单利，则分发unstaking中
    //     for (uint256 i = 0; i < stakers.length; i++) {
    //         stakingBalances[stakers[i]].stakingAmount +=
    //             (stakingBalances[stakers[i]].stakingAmount * 6) /
    //             100;
    //         // stakingBalances[stakers[i]].unstakingAmount += stakingBalances[stakers[i]].stakingAmount * 6 / 100;
    //     }

    //     // validator奖励分发，分发到账户余额中
    //     for (uint256 i = 0; i < validators.length; i++) {
    //         payable(validators[i].validatorAddr).transfer(
    //             (validators[i].stakingAmount * 2) / 100
    //         );
    //     }
    // }

    // function getStakingBalance()
    //     public
    //     view
    //     returns (
    //         uint256,
    //         uint256,
    //         uint256
    //     )
    // {
    //     return (
    //         stakingBalances[msg.sender].stakingAmount,
    //         stakingBalances[msg.sender].unstakingAmount,
    //         stakingBalances[msg.sender].unstakingTime
    //     );
    // }

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
