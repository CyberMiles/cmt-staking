const {loadFixture} = require('@nomicfoundation/hardhat-network-helpers');
const {expect} = require('chai');
const {anyValue} = require('@nomicfoundation/hardhat-chai-matchers/withArgs');
const {ethers, upgrades} = require('hardhat');
const { isCallTrace } = require('hardhat/internal/hardhat-network/stack-traces/message-trace');

describe('CMTStaking contract', function () {
    async function deployTokenFixture() {
        const [owner, addr1, addr2, addr3, addr4] = await ethers.getSigners();
        const CMTStaking = await ethers.getContractFactory("CMTStaking");
        const cmtStaking = await upgrades.deployProxy(CMTStaking, {initializer: 'initialize', kind: 'uups'})
        await cmtStaking.deployed();
        return {CMTStaking, cmtStaking, owner, addr1, addr2, addr3, addr4};
    }

    it('Test version', async function () {
        const {cmtStaking} = await loadFixture(deployTokenFixture);
        const version = 1;

        expect(await cmtStaking.getVersion()).to.equal(1);
    });

    it('Test add and remove validator', async function () {
        const {cmtStaking, owner, addr1, addr2, addr3, addr4} = await loadFixture(deployTokenFixture);

        await cmtStaking.setValidatorLimit(3);
        expect(await cmtStaking.validatorLimit()).to.be.equal(3);

        await expect(cmtStaking.addValidator(ethers.constants.AddressZero)).to.be.revertedWith('Invalid address.');
        await expect(cmtStaking.addValidator(addr1.address)).not.be.reverted;
        expect(await cmtStaking.getValidatorCount()).to.be.equal(1);
        await expect(cmtStaking.addValidator(addr2.address)).not.be.reverted;
        expect(await cmtStaking.getValidatorCount()).to.be.equal(2);
        await expect(cmtStaking.addValidator(addr3.address)).not.be.reverted;
        expect(await cmtStaking.getValidatorCount()).to.be.equal(3);
        await expect(cmtStaking.addValidator(addr4.address)).to.be.revertedWith('Validator is full.');

        await expect(cmtStaking.removeValidator(ethers.constants.AddressZero)).to.be.revertedWith('Invalid address.');
        await expect(cmtStaking.removeValidator(addr2.address)).not.be.reverted;
        expect(await cmtStaking.getValidatorCount()).to.be.equal(2);
        await expect(cmtStaking.removeValidator(addr4.address)).to.be.emit(cmtStaking, 'RemoveValidator').withArgs(anyValue, false);
    });

    it('Test stake and unstake', async function () {
        
    });
});