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

contract('FeeCollector', async function ([_, wallet, lpTokenAddress]) {
    const privatekey = '2bdd21761a483f71054e14f5b827213567971c676928d9a1808cbfa4b7501201';
    const account = Wallet.fromPrivateKey(Buffer.from(privatekey, 'hex'));

    const zeroAddress = '0x0000000000000000000000000000000000000000';
    const name = '1inch FeeCollector';
    const version = '1';

    const minValue = '100000000000000000000';
    const deceleration = '999900000000000000000000000000000000';

    const bn1e36 = toBN("1000000000000000000000000000000000000");
    const decelerationBN = toBN(deceleration);

    beforeEach(async function () {
        this.weth = await TokenMock.new('WETH', 'WETH');
        this.inch = await TokenMock.new('1INCH', '1INCH');

        this.feeCollector = await FeeCollector.new(this.inch.address, minValue, deceleration);

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
            const lastTime = await this.feeCollector.lastTimeDefault.call();
            const cost = await this.feeCollector.priceForTime.call(lastTime, this.weth.address);
            expect(cost.toString()).equal(minValue);
        });
    });

    describe('PriceForTime', async function () {
        it('one sec after started', async function () {
            const lastTime = await this.feeCollector.lastTimeDefault.call();
            const cost = await this.feeCollector.priceForTime.call(lastTime.add(toBN(1)), this.weth.address);
            expect(cost.toString()).equal(minValue.toString());
        });

        it('two secs after started', async function () {
            const lastTime = await this.feeCollector.lastTimeDefault.call();
            const cost = await this.feeCollector.priceForTime.call(lastTime.add(toBN(2)), this.weth.address);
            expect(cost.toString()).equal(minValue.toString());
        });

        it.only('add reward 100 and check cost changing', async function () {
            const lastTime = await this.feeCollector.lastTimeDefault.call();
            const cost1 = await this.feeCollector.priceForTime.call(lastTime, lpTokenAddress);
            await this.feeCollector.updateReward(wallet, toBN(100), { from: lpTokenAddress });
            const cost2 = await this.feeCollector.priceForTime.call(lastTime, lpTokenAddress);
            expect(cost1.muln(100).toString()).equal(cost2.toString());
        });

        it('add reward 100 and check cost changing after 1 sec', async function () {
            const lastTime = await this.feeCollector.lastTimeDefault.call();
            await this.feeCollector.updateReward(wallet, toBN(100), { from: lpTokenAddress });
            const cost1 = await this.feeCollector.priceForTime.call(lastTime, lpTokenAddress);
            expect(cost1.toString()).equal(toBN(minValue).muln(100).toString());
            const cost2 = await this.feeCollector.priceForTime.call(lastTime.add(toBN(1)), lpTokenAddress);
            const result = cost1.mul(toBN(deceleration)).div(bn1e36);
            expect(cost2.toString()).equal(result.toString());
        });

        it('add reward 1.5e7 and check cost changing to minValue with time', async function () {
            const lastTime = await this.feeCollector.lastTimeDefault.call();
            await this.feeCollector.updateReward(wallet, toBN(15000000), { from: lpTokenAddress });
            
            const maxValueBN = toBN(minValue).muln(15000000);
            const minValueBN = toBN(minValue);
            let cost = await this.feeCollector.priceForTime.call(lastTime, lpTokenAddress);
            expect(cost.toString()).equal(maxValueBN.toString());

            cost = await this.feeCollector.priceForTime.call(lastTime.add(toBN(1)), lpTokenAddress);
            expect(cost.toString()).equal(maxValueBN.mul(toBN(deceleration)).div(bn1e36).toString());

            const step = 1000;
            for (let i = 0; i < 200; i++) {
                const n = toBN(i).muln(step);
                cost = await this.feeCollector.priceForTime.call(lastTime.add(n), lpTokenAddress);
                
                let result = maxValueBN;
                let tableCalc = decelerationBN;
                for (let j = 0; j < Math.floor(Math.log2(n)); j++) {
                    if ((n >> j) & 1 != 0) {
                        result = result.mul(tableCalc).div(bn1e36);
                    }
                    tableCalc = tableCalc.mul(tableCalc).div(bn1e36);
                }

                if (n != 0) {
                    result = result.mul(tableCalc).div(bn1e36);
                }

                if (result.lt(minValueBN)) {
                    result = minValueBN;
                }
                
                expect(result.toString()).equal(cost.toString());
            }
        });
    });

    // describe('Balances', async function () {
    //     it.only('add reward', async function () {
    //         const tokenEpochMarket1 = await this.feeCollector.tokenEpochMarket.call(tokenAddress, 0);
    //         expect(tokenEpochMarket1.balances).equal(undefined);

    //         await this.feeCollector.addReward(toBN(100), tokenAddress, testUserAddress);

    //         const tokenEpochMarket2 = await this.feeCollector.tokenEpochMarket.call(tokenAddress, 0);
    //         console.log(tokenEpochMarket2)
    //         // expect(balance2.toString()).equal("100");
    //     });
    // });

    describe('Something', async function () {
        it('Anything', async function () {
            expect(true).equal(true);
        });
    });
});
