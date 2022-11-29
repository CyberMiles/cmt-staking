# cmt-staking

a staking contract to allow users to stake native token on validators to gain rewards.

## How to build

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

- build

```
npx hardhat build
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


