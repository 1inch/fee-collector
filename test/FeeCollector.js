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
const periodMaxShift = '1000000000000000000000000';

contract('FeeCollector', async function ([_, wallet]) {
    const privatekey = '2bdd21761a483f71054e14f5b827213567971c676928d9a1808cbfa4b7501201';
    const account = Wallet.fromPrivateKey(Buffer.from(privatekey, 'hex'));

    const zeroAddress = '0x0000000000000000000000000000000000000000';
    const name = '1inch FeeCollector';
    const version = '1';

    const bn1e36 = toBN("1000000000000000000000000000000000000");
    const decelerationBN = toBN(deceleration);
    const periodMaxShiftBN = toBN(periodMaxShift);

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
            const result = toBN(maxValue).mul(toBN(deceleration)).div(bn1e36);
            expect(cost.toString()).equal(result.toString());
        });

        it('two secs after started', async function () {
            const startedTime = await this.feeCollector.started.call();
            const cost = await this.feeCollector.priceForTime.call(startedTime.add(toBN(2)));
            const result = toBN(maxValue).mul(toBN(deceleration)).div(bn1e36).mul(toBN(deceleration)).div(bn1e36);
            expect(cost.toString()).equal(result.toString());
        });

        it('random n < 100 secs after started', async function () {
            const n = getRandomInt(60);

            const startedTime = await this.feeCollector.started.call();
            const cost = await this.feeCollector.priceForTime.call(startedTime.add(toBN(n)));
            
            let result = toBN(maxValue);
            let tableCalc = decelerationBN;
            for (let i = 0; i < Math.floor(Math.log2(n)); i++) {
                if ((n >> i) & 1 != 0) {
                    result = result.mul(tableCalc).div(bn1e36);
                }
                tableCalc = tableCalc.mul(tableCalc).div(bn1e36);
            }

            result = result.mul(tableCalc).div(bn1e36);
            
            let diff;
            if (result.gt(cost)) {
                diff = result.sub(cost);
            } else {
                diff = cost.sub(result);
            }

            expect(diff.lte(toBN(2))).equal(true);
        });

        it('all n < 100 secs after started', async function () {
            const startedTime = await this.feeCollector.started.call();

            for (let n = 0; n < 60; n++) {
                const cost = await this.feeCollector.priceForTime.call(startedTime.add(toBN(n)));
                
                let result = toBN(maxValue);
                let tableCalc = decelerationBN;
                for (let i = 0; i < Math.floor(Math.log2(n)); i++) {
                    if ((n >> i) & 1 != 0) {
                        result = result.mul(tableCalc).div(bn1e36);
                    }
                    tableCalc = tableCalc.mul(tableCalc).div(bn1e36);
                }

                if (n != 0) {
                    result = result.mul(tableCalc).div(bn1e36);
                }
                
                let diff;
                if (result.gt(cost)) {
                    diff = result.sub(cost);
                } else {
                    diff = cost.sub(result);
                }

                expect(diff.lte(toBN(2))).equal(true);
            }
        });

        it('one period', async function () {
            const period = await this.feeCollector.period.call();
            const startedTime = await this.feeCollector.started.call();
            const cost1 = await this.feeCollector.priceForTime.call(startedTime.add(toBN(1000)));
            const cost2 = await this.feeCollector.priceForTime.call(startedTime.add(period).add(toBN(1000)));
            expect(cost1.sub(cost2).lt(periodMaxShiftBN)).equal(true);
        });

        it('random n < 100 periods', async function () {
            const n = getRandomInt(60);
            const period = await this.feeCollector.period.call();
            const startedTime = await this.feeCollector.started.call();

            const cost1 = await this.feeCollector.priceForTime.call(startedTime.add(period).add(toBN(1000)));
            const cost2 = await this.feeCollector.priceForTime.call(startedTime.add(period.muln(n)).add(toBN(1000)));
            expect(cost1.sub(cost2).lt(periodMaxShiftBN.muln(n))).equal(true);
        });

        it('all n < 100 periods', async function () {
            const period = await this.feeCollector.period.call();
            const startedTime = await this.feeCollector.started.call();

            const cost1 = await this.feeCollector.priceForTime.call(startedTime.add(period).add(toBN(1000)));

            for (let n = 0; n < 60; n++) {    
                const cost2 = await this.feeCollector.priceForTime.call(startedTime.add(period.muln(n)).add(toBN(1000)));
                expect(cost1.sub(cost2).lt(periodMaxShiftBN.muln(n))).equal(true);
            }
        });

        it('time without started with setted bit number 19', async function () {
            const period = await this.feeCollector.period.call();
            const startedTime = await this.feeCollector.started.call();
            
            const cost = await this.feeCollector.priceForTime.call(startedTime.add(toBN(528544))); // 1420431875395686025608339619
            // const cost = await this.feeCollector.priceForTime.call(startedTime.add(toBN(524295))); //6646142952591909352797
            expect(cost.toString()).equal("1420431875395686025608339619");
        });

        it('time without started with setted bit numbers 18 and 20', async function () {
            const period = await this.feeCollector.period.call();
            const startedTime = await this.feeCollector.started.call();
            
            
            const cost = await this.feeCollector.priceForTime.call(startedTime.add(toBN(1321360))); // 1308923133626869085058517937
            // const cost = await this.feeCollector.priceForTime.call(startedTime.add(toBN(1310727))); //3639037889598772042739491
            expect(cost.toString()).equal("1308923133626869085058517937");
        });

        // it('some tests', async function () {
        //     const period = await this.feeCollector.period.call();
        //     const startedTime = await this.feeCollector.started.call();
        //     // const newTime = startedTime.add(toBN(1000));
            
        //     // console.log(
        //     //     "\n",
        //     //     (await this.feeCollector.priceForTime.call(startedTime.add(period.muln(1).divn(1)))).toString(), "\n",
        //     //     (await this.feeCollector.priceForTime.call(startedTime.add(period.muln(200).divn(1)))).toString(), "\n",
        //     //     (await this.feeCollector.priceForTime.call(startedTime.add(period.muln(200).subn(340).divn(1)))).toString(),
        //     // )
        //     // console.log(await this.feeCollector.priceForTime.estimateGas(startedTime.add(period.muln(1).divn(1))));
        //     // console.log(await this.feeCollector.priceForTime.estimateGas(startedTime.add(period.muln(10).divn(1))));
        //     // console.log(await this.feeCollector.priceForTime.estimateGas(startedTime.add(period.muln(100).divn(1))));
        //     // console.log(await this.feeCollector.priceForTime.estimateGas(startedTime.add(period.muln(1000).divn(1))));
        //     // console.log(await this.feeCollector.priceForTime.estimateGas(startedTime.add(period.muln(10000).divn(1))));

        //     // console.log(period.muln(10000).toString());
        //     for (let n = 0; n < 300; n++) {
        //         const cost = await this.feeCollector.priceForTime.call(startedTime.add(period.muln(n).divn(1)));
        //         console.log((n < 10 ? '0' : '') + n, "cost=" + cost.toString(), period.muln(n).divn(1).toString())
        //         // expect(cost1.sub(cost2).lt(periodMaxErrorBN)).equal(true);
        //     }
        // });
    });

    describe('Something', async function () {
        it('Anything', async function () {
            expect(true).equal(true);
        });
    });
});
