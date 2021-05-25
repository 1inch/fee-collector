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

function getRandomInt(max) {
  return Math.floor(Math.random() * max);
}

const minValue = '100000000000000000000';
const maxValue = '1500000000000000000000000000';
const deceleration = '999000000000000000000000000000000000';
const periodMaxError = '550000000000000000000000000';

contract('FeeCollector', async function ([_, wallet]) {
    const privatekey = '2bdd21761a483f71054e14f5b827213567971c676928d9a1808cbfa4b7501201';
    const account = Wallet.fromPrivateKey(Buffer.from(privatekey, 'hex'));

    const zeroAddress = '0x0000000000000000000000000000000000000000';
    const name = '1inch FeeCollector';
    const version = '1';

    const bn1e36 = toBN("1000000000000000000000000000000000000");
    const decelerationBN = toBN(deceleration);
    const periodMaxErrorBN = toBN(periodMaxError);

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

    describe('Init', async function () {
        it('decelerationTable', async function () {
            const table = await this.feeCollector.decelerationTable.call();
            
            let z = toBN(deceleration);
            for (let i = 0; i < table.length; i++) {
                expect(table[i].toString()).equal(z.toString());
                z = z.mul(z).div(bn1e36);
            }
        });

        it('started price', async function () {
            const startedTime = await this.feeCollector.started.call();
            const cost = await this.feeCollector.priceForTime.call(startedTime);
            expect(cost.toString()).equal(maxValue);
        });
    });

    describe('PriceForTime', async function () {
        it('one sec after started', async function () {
            const startedTime = await this.feeCollector.started.call();
            const cost = await this.feeCollector.priceForTime.call(startedTime.add(toBN(1)));
            const jsCalcResult = toBN(maxValue).mul(toBN(deceleration)).div(bn1e36);
            expect(cost.toString()).equal(jsCalcResult.toString());
        });
        it('two secs after started', async function () {
            const startedTime = await this.feeCollector.started.call();
            const cost = await this.feeCollector.priceForTime.call(startedTime.add(toBN(2)));
            const jsCalcResult = toBN(maxValue).mul(toBN(deceleration)).div(bn1e36).mul(toBN(deceleration)).div(bn1e36);
            expect(cost.toString()).equal(jsCalcResult.toString());
        });
        it('random n < 60 secs after started', async function () {
            const n = getRandomInt(60);

            const startedTime = await this.feeCollector.started.call();
            const cost = await this.feeCollector.priceForTime.call(startedTime.add(toBN(n)));
            
            let jsCalcResult = toBN(maxValue);
            let tableCalc = decelerationBN;
            for (let i = 0; i < Math.floor(Math.log2(n)); i++) {
                if ((n >> i) & 1 != 0) {
                    jsCalcResult = jsCalcResult.mul(tableCalc).div(bn1e36);
                }
                tableCalc = tableCalc.mul(tableCalc).div(bn1e36);
            }
            jsCalcResult = jsCalcResult.mul(tableCalc).div(bn1e36);
            let result;
            if (jsCalcResult.gt(cost)) {
                result = jsCalcResult.sub(cost);
            } else {
                result = cost.sub(jsCalcResult);
            }
            expect(result.lte(toBN(2))).equal(true);
        });
        it('all n < 60 secs after started', async function () {
            const startedTime = await this.feeCollector.started.call();

            for (let n = 0; n < 60; n++) {
                const cost = await this.feeCollector.priceForTime.call(startedTime.add(toBN(n)));
                
                let jsCalcResult = toBN(maxValue);
                let tableCalc = decelerationBN;
                for (let i = 0; i < Math.floor(Math.log2(n)); i++) {
                    if ((n >> i) & 1 != 0) {
                        jsCalcResult = jsCalcResult.mul(tableCalc).div(bn1e36);
                    }
                    tableCalc = tableCalc.mul(tableCalc).div(bn1e36);
                }
                if (n != 0) {
                    jsCalcResult = jsCalcResult.mul(tableCalc).div(bn1e36);
                }
                let result;
                if (jsCalcResult.gt(cost)) {
                    result = jsCalcResult.sub(cost);
                } else {
                    result = cost.sub(jsCalcResult);
                }
                expect(result.lte(toBN(2))).equal(true);
            }
        });
        it('one period', async function () {
            const period = await this.feeCollector.period.call();
            const startedTime = await this.feeCollector.started.call();
            const cost1 = await this.feeCollector.priceForTime.call(startedTime.add(toBN(1000)));
            const cost2 = await this.feeCollector.priceForTime.call(startedTime.add(period).add(toBN(1000)));
            expect(cost1.sub(cost2).lt(periodMaxErrorBN)).equal(true);
        });
        it('random n < 60 periods', async function () {
            const n = getRandomInt(60);
            const period = await this.feeCollector.period.call();
            const startedTime = await this.feeCollector.started.call();
            let cost1 = await this.feeCollector.priceForTime.call(startedTime.add(period).add(toBN(1000)));
            
            let newTime = startedTime.add(toBN(1000));
            for (let i = 0; i < n; i++) {
                newTime = newTime.add(period);
                const cost2 = await this.feeCollector.priceForTime.call(newTime);
                expect(cost1.sub(cost2).lt(periodMaxErrorBN)).equal(true);
                cost1 = cost2;
            }
        });
        it('all n < 20 periods', async function () {
            const period = await this.feeCollector.period.call();
            const startedTime = await this.feeCollector.started.call();
            
            for (let n = 0; n < 20; n++) {
                let cost1 = await this.feeCollector.priceForTime.call(startedTime.add(period).add(toBN(1000)));
                
                let newTime = startedTime.add(toBN(1000));
                for (let i = 0; i < n; i++) {
                    newTime = newTime.add(period);
                    const cost2 = await this.feeCollector.priceForTime.call(newTime);
                    expect(cost1.sub(cost2).lt(periodMaxErrorBN)).equal(true);
                    cost1 = cost2;
                }
            }
        });
    });

    describe('Something', async function () {
        it('Anything', async function () {
            expect(true).equal(true);
        });
    });
});
