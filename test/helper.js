const { ethers } = require('hardhat');

const provider = ethers.provider;

async function getTxTs(txhash) {
    const tx = await provider.getTransaction(txhash);
    const block = await provider.getBlock(tx.blockHash);
    return block.timestamp;
}

module.exports = {
    getTxTs
}