const { BN, ether, expectRevert, constants } = require('@openzeppelin/test-helpers');
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

contract('FeeCollector', async function ([_, wallet]) {
    const privatekey = '2bdd21761a483f71054e14f5b827213567971c676928d9a1808cbfa4b7501201';
    const account = Wallet.fromPrivateKey(Buffer.from(privatekey, 'hex'));

    const zeroAddress = '0x0000000000000000000000000000000000000000';
    const name = '1inch FeeCollector';
    const version = '1';

    const minValue = '100000000000000000000';
    const deceleration = '999900000000000000000000000000000000';

    const bn1e36 = toBN("1000000000000000000000000000000000000");
    const decelerationBN = toBN(deceleration);

    before(async function () {
        this.weth = await TokenMock.new('WETH', 'WETH');
        this.token = await TokenMock.new('INCH', 'INCH');
    });

    beforeEach(async function () {
        this.feeCollector = await FeeCollector.new(this.token.address, minValue, deceleration);
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

        it('add reward 100 and check cost changing', async function () {
            const lastTime = await this.feeCollector.lastTimeDefault.call();
            const cost1 = await this.feeCollector.priceForTime.call(lastTime, this.weth.address);
            await this.weth.updateReward(this.feeCollector.address, wallet, toBN(100));
            const cost2 = await this.feeCollector.priceForTime.call(lastTime, this.weth.address);
            expect(cost1.muln(100).toString()).equal(cost2.toString());
        });

        it('add reward 100 and check cost changing after 1 sec', async function () {
            const lastTime = await this.feeCollector.lastTimeDefault.call();
            await this.weth.updateReward(this.feeCollector.address, wallet, toBN(100));
            const cost1 = await this.feeCollector.priceForTime.call(lastTime, this.weth.address);
            expect(cost1.toString()).equal(toBN(minValue).muln(100).toString());
            const cost2 = await this.feeCollector.priceForTime.call(lastTime.add(toBN(1)), this.weth.address);
            const result = cost1.mul(toBN(deceleration)).div(bn1e36);
            expect(cost2.toString()).equal(result.toString());
        });

        it('add reward 1.5e7 and check cost changing to minValue with time', async function () {
            const lastTime = await this.feeCollector.lastTimeDefault.call();
            await this.weth.updateReward(this.feeCollector.address, wallet, toBN(15000000));
            
            const maxValueBN = toBN(minValue).muln(15000000);
            const minValueBN = toBN(minValue);
            let cost = await this.feeCollector.priceForTime.call(lastTime, this.weth.address);
            expect(cost.toString()).equal(maxValueBN.toString());

            cost = await this.feeCollector.priceForTime.call(lastTime.add(toBN(1)), this.weth.address);
            expect(cost.toString()).equal(maxValueBN.mul(toBN(deceleration)).div(bn1e36).toString());

            const step = 1000;
            for (let i = 0; i < 200; i++) {
                const n = toBN(i).muln(step);
                cost = await this.feeCollector.priceForTime.call(lastTime.add(n), this.weth.address);
                
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

    describe('updateReward', async function () {
        it('lastValueToken changes', async function () {
            let reward = toBN(100);

            const lastValueToken1 = await this.feeCollector.lastValueToken.call(this.weth.address);
            expect(lastValueToken1.toString()).equal("0");


            await this.weth.updateReward(this.feeCollector.address, wallet, reward);

            const lastValueToken2 = await this.feeCollector.lastValueToken.call(this.weth.address);
            expect(lastValueToken2.toString()).equal(toBN(minValue).mul(reward).toString());
        });

        it('TokenInfo after reward', async function () {
            const userEpochBalance1 = await this.feeCollector.getUserEpochBalance.call(wallet, this.weth.address, 0);
            const totalSupplyEpochBalance1 = await this.feeCollector.getTotalSupplyEpochBalance.call(this.weth.address, 0);
            const inchBalanceEpochBalance1 = await this.feeCollector.getInchBalanceEpochBalance.call(this.weth.address, 0);
            const firstUserUnprocessedEpoch1 = await this.feeCollector.getFirstUserUnprocessedEpoch.call(wallet, this.weth.address);
            
            expect(userEpochBalance1.toString()).equal("0");
            expect(totalSupplyEpochBalance1.toString()).equal("0");
            expect(inchBalanceEpochBalance1.toString()).equal("0");
            expect(firstUserUnprocessedEpoch1.toString()).equal("0");

            await this.weth.updateReward(this.feeCollector.address, wallet, toBN(100));

            const userEpochBalance2 = await this.feeCollector.getUserEpochBalance.call(wallet, this.weth.address, 0);
            const totalSupplyEpochBalance2 = await this.feeCollector.getTotalSupplyEpochBalance.call(this.weth.address, 0);
            const inchBalanceEpochBalance2 = await this.feeCollector.getInchBalanceEpochBalance.call(this.weth.address, 0);
            const firstUserUnprocessedEpoch2 = await this.feeCollector.getFirstUserUnprocessedEpoch.call(wallet, this.weth.address);

            expect(userEpochBalance2.toString()).equal("100");
            expect(totalSupplyEpochBalance2.toString()).equal("100");
            expect(inchBalanceEpochBalance2.toString()).equal("0");
            expect(firstUserUnprocessedEpoch2.toString()).equal("0");
        });
    });

    describe('Something', async function () {
        it('Anything', async function () {
            expect(true).equal(true);
        });
    });
});
