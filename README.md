# cmt-staking

a staking contract to allow users to stake native token on validators to gain rewards.

## How to compile

- prerequisite

node version >= 14

- install dependencies

```
npm install
```

- create .env file on root dir

```
PRIVATE_KEY=xxx
ALCHEMY_API_KEY=xxx
ETHERSCAN_API_KEY=xxx
BSCSCAN_API_KEY=xxx
```

- compile

```
npx hardhat compile
```

## How to test on local hardhat node

```
npx hardhat test
```

## How to deploy

after customized deployment params, please run the following
```
npx hardhat run scripts/deploy --network xxx
```

## How to upgrade

```
npx hardhat run scripts/upgrade --network xxx
```

## How to run customized tasks

added folllowing tasks in scripts/tasks folder

- setLockPeriod

- addValidator


```
// run cmd to get more info to set task params
npx hardhat taskName --help

// below is an example to add validatoar in cmt network
npx hardhat addValidator --cmt-contract 0x1016A0886b4AeD69043367d501a99cfBAaB052B5 --validator-address 0x401C89Ca6aE7201469882fD6c5ca0Dd462447479 --network cmt_new 
```






