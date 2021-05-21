const { BN, ether, expectRevert } = require('@openzeppelin/test-helpers');
const { expect } = require('chai');

const { bufferToHex } = require('ethereumjs-util');
const ethSigUtil = require('eth-sig-util');
const Wallet = require('ethereumjs-wallet').default;

const TokenMock = artifacts.require('TokenMock');
const FeeCollector = artifacts.require('FeeCollector');

const { EIP712Domain, domainSeparator } = require('./helpers/eip712');
const { profileEVM, gasspectEVM } = require('./helpers/profileEVM');

function price (val) {
    return ether(val).toString();
}

function toBN (num) {
    return new BN(num);
}

contract('FeeCollector', async function ([_, wallet]) {
    const privatekey = '2bdd21761a483f71054e14f5b827213567971c676928d9a1808cbfa4b7501201';
    const account = Wallet.fromPrivateKey(Buffer.from(privatekey, 'hex'));

    const zeroAddress = '0x0000000000000000000000000000000000000000';
    const name = '1inch FeeCollector';
    const version = '1';

    const minValue = '100';
    const maxValue = '1000000000000000000';
    const deceleration = '100000000000000000000000000000000000';

    beforeEach(async function () {
        this.weth = await TokenMock.new('WETH', 'WETH');

        this.feeCollector = await FeeCollector.new(this.weth.address, minValue, maxValue, deceleration);
        
        // We get the chain id from the contract because Ganache (used for coverage) does not return the same chain id
        // from within the EVM as from the JSON RPC interface.
        // See https://github.com/trufflesuite/ganache-core/issues/515
        this.chainId = await this.weth.getChainId();

        await this.weth.mint(wallet, '1000000');
        await this.weth.mint(_, '1000000');
    });

    describe('PriceForTime', async function () {
        it('Started price', async function () {
            const startedTime = await this.feeCollector.started.call()
            
            let cost = await this.feeCollector.priceForTime.call(startedTime);
            expect(cost.toString()).equal(maxValue);

            cost = await this.feeCollector.priceForTime.call(startedTime.add(toBN(1)));
            console.log(startedTime.toString(), startedTime.add(toBN(1)).toString(), cost.toString(), maxValue);
        });
    });

    describe('Something', async function () {
        it('Anything', async function () {
            expect(true).equal(true);
        });
    });
});
