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

async function getTokenInfo(feeCollector, token, user, epoch) {
    const tokenInfo = await feeCollector.tokenInfo.call(token);
    
    const userEpochBalance = await feeCollector.getUserEpochBalance.call(user, token, epoch);
    const totalSupplyEpochBalance = await feeCollector.getTotalSupplyEpochBalance.call(token, epoch);
    const tokenBalanceEpochBalance = await feeCollector.getTokenBalanceEpochBalance.call(token, epoch);
    const inchBalanceEpochBalance = await feeCollector.getInchBalanceEpochBalance.call(token, epoch);
    const firstUserUnprocessedEpoch = await feeCollector.getFirstUserUnprocessedEpoch.call(user, token);
    
    return {
        'epochBalance': {
            'userBalance': userEpochBalance,
            'totalSupply': totalSupplyEpochBalance,
            'tokenBalance': tokenBalanceEpochBalance,
            'inchBalance': inchBalanceEpochBalance,
        },
        'firstUnprocessedEpoch': tokenInfo.firstUnprocessedEpoch,
        'currentEpoch': tokenInfo.currentEpoch,
        'firstUserUnprocessedEpoch': firstUserUnprocessedEpoch,
        'lastPriceValue': tokenInfo.lastPriceValue,
        'lastTime': tokenInfo.lastTime,
    }
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

        await this.weth.mint(wallet, ether('1000000'));
        await this.weth.approve(this.feeCollector.address, ether('1000000'), { 'from': wallet });

        await this.token.mint(this.feeCollector.address, ether('1000'));
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
            const lastTime = await this.feeCollector.lastTokenTimeDefault.call();
            const cost = await this.feeCollector.priceForTime.call(lastTime, this.weth.address);
            expect(cost.toString()).equal(minValue);
        });
    });

    describe('priceForTime', async function () {
        it('one sec after started', async function () {
            const lastTime = await this.feeCollector.lastTokenTimeDefault.call();
            const cost = await this.feeCollector.priceForTime.call(lastTime.add(toBN(1)), this.weth.address);
            expect(cost.toString()).equal(minValue.toString());
        });

        it('two secs after started', async function () {
            const lastTime = await this.feeCollector.lastTokenTimeDefault.call();
            const cost = await this.feeCollector.priceForTime.call(lastTime.add(toBN(2)), this.weth.address);
            expect(cost.toString()).equal(minValue.toString());
        });

        it('add reward 100 and check cost changing', async function () {
            const lastTime = await this.feeCollector.lastTokenTimeDefault.call();
            const cost1 = await this.feeCollector.priceForTime.call(lastTime, this.weth.address);
            await this.weth.updateReward(this.feeCollector.address, wallet, toBN(100));
            const cost2 = await this.feeCollector.priceForTime.call(lastTime, this.weth.address);
            expect(cost1.muln(100).toString()).equal(cost2.toString());
        });

        it('add reward 100 and check cost changing after 1 sec', async function () {
            const lastTime = await this.feeCollector.lastTokenTimeDefault.call();
            await this.weth.updateReward(this.feeCollector.address, wallet, toBN(100));
            const cost1 = await this.feeCollector.priceForTime.call(lastTime, this.weth.address);
            expect(cost1.toString()).equal(toBN(minValue).muln(100).toString());
            const cost2 = await this.feeCollector.priceForTime.call(lastTime.add(toBN(1)), this.weth.address);
            const result = cost1.mul(toBN(deceleration)).div(bn1e36);
            expect(cost2.toString()).equal(result.toString());
        });

        it('add reward 1.5e7 and check cost changing to minValue with time', async function () {
            const lastTime = await this.feeCollector.lastTokenTimeDefault.call();
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
        it('lastTokenPriceValue changes', async function () {
            let reward = toBN(100);

            const tokenInfo1 = await this.feeCollector.tokenInfo.call(this.weth.address);
            expect(tokenInfo1.lastPriceValue.toString()).equal("0");

            await this.weth.updateReward(this.feeCollector.address, wallet, reward);

            const tokenInfo2 = await this.feeCollector.tokenInfo.call(this.weth.address);
            expect(tokenInfo2.lastPriceValue.toString()).equal(toBN(minValue).mul(reward).toString());
        });

        it('lastTokenTime changes', async function () {
            let reward = toBN(100);

            const tokenInfo1 = await this.feeCollector.tokenInfo.call(this.weth.address);
            const lastTIme1 = tokenInfo1.lastTime;

            await this.weth.updateReward(this.feeCollector.address, wallet, reward);

            const tokenInfo2 = await this.feeCollector.tokenInfo.call(this.weth.address);
            const lastTIme2 = tokenInfo2.lastTime;
            expect(lastTIme2 > lastTIme1).equal(true);
        });

        it('tokenInfo after reward', async function () {
            let reward = toBN(100);

            const tokenInfo1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);
            
            expect(tokenInfo1.epochBalance.userBalance.toString()).equal("0");
            expect(tokenInfo1.epochBalance.totalSupply.toString()).equal("0");
            expect(tokenInfo1.epochBalance.tokenBalance.toString()).equal("0");
            expect(tokenInfo1.epochBalance.inchBalance.toString()).equal("0");
            expect(tokenInfo1.firstUserUnprocessedEpoch.toString()).equal("0");
            
            await this.weth.updateReward(this.feeCollector.address, wallet, reward);

            const tokenInfo2 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo2.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2.epochBalance.tokenBalance.toString()).equal(reward.toString());
            expect(tokenInfo2.epochBalance.inchBalance.toString()).equal("0");
            expect(tokenInfo2.firstUserUnprocessedEpoch.toString()).equal("0");
        });

        it('tokenInfo after the freezing epoch', async function () {
            let reward = toBN(100);

            await this.weth.updateReward(this.feeCollector.address, wallet, reward);

            const price = await this.feeCollector.price.call(this.weth.address);
            const tokenInfo1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.tokenBalance.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.inchBalance.toString()).equal("0");
            expect(tokenInfo1.firstUserUnprocessedEpoch.toString()).equal("0");

            const returnAmount = toBN(10);
            const amount = price.mul(returnAmount);

            await this.feeCollector.trade(this.weth.address, amount, { 'from': wallet });
            await this.weth.updateReward(this.feeCollector.address, wallet, reward);

            const tokenInfo2_epoch0 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo2_epoch0.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2_epoch0.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2_epoch0.epochBalance.tokenBalance.toString()).equal(reward.sub(returnAmount).toString());
            expect(tokenInfo2_epoch0.epochBalance.inchBalance.toString()).equal(amount.toString());
            expect(tokenInfo2_epoch0.firstUnprocessedEpoch.toString()).equal("0");

            const tokenInfo2_epoch1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 1);

            expect(tokenInfo2_epoch1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2_epoch1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2_epoch1.epochBalance.tokenBalance.toString()).equal(reward.toString());
            expect(tokenInfo2_epoch1.epochBalance.inchBalance.toString()).equal("0");
            expect(tokenInfo2_epoch1.firstUserUnprocessedEpoch.toString()).equal("0");
        });

        it('tokenInfo after epoch sellout', async function () {
            let reward = toBN(100);

            await this.weth.updateReward(this.feeCollector.address, wallet, reward);

            const price = await this.feeCollector.price.call(this.weth.address);
            const tokenInfo1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);
            
            expect(tokenInfo1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.tokenBalance.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.inchBalance.toString()).equal("0");
            expect(tokenInfo1.firstUserUnprocessedEpoch.toString()).equal("0");
            
            const returnAmount = toBN(100);
            const amount = price.mul(returnAmount);

            await this.feeCollector.trade(this.weth.address, amount, { 'from': wallet });
            await this.weth.updateReward(this.feeCollector.address, wallet, reward);

            const tokenInfo2_epoch0 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);
            
            expect(tokenInfo2_epoch0.epochBalance.userBalance.toString()).equal("0");
            expect(tokenInfo2_epoch0.epochBalance.totalSupply.toString()).equal("0");
            expect(tokenInfo2_epoch0.epochBalance.tokenBalance.toString()).equal("0");
            expect(tokenInfo2_epoch0.epochBalance.inchBalance.toString()).equal("0");
            expect(tokenInfo2_epoch0.firstUnprocessedEpoch.toString()).equal("1");

            const tokenInfo2_epoch1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 1);

            expect(tokenInfo2_epoch1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2_epoch1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2_epoch1.epochBalance.tokenBalance.toString()).equal(reward.toString());
            expect(tokenInfo2_epoch1.epochBalance.inchBalance.toString()).equal("0");
            expect(tokenInfo2_epoch1.firstUserUnprocessedEpoch.toString()).equal("1");
        });

        it('balance after epoch sellout', async function () {
            let reward = toBN(100);

            await this.weth.updateReward(this.feeCollector.address, wallet, reward);

            const price = await this.feeCollector.price.call(this.weth.address);
            const balance1 = await this.feeCollector.balance.call(wallet);
            
            expect(balance1.toString()).equal("0");

            const returnAmount = toBN(100);
            const amount = price.mul(returnAmount);

            await this.feeCollector.trade(this.weth.address, amount, { 'from': wallet });
            await this.weth.updateReward(this.feeCollector.address, wallet, reward);

            const tokenInfo2_epoch0 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);
            const balance2 = await this.feeCollector.balance.call(wallet);

            expect(balance2.toString()).equal(amount.toString());
        });
    });

    describe('trade', async function () {
        it('tokenInfo after trade part of only frozen epoch', async function () {
            let reward = toBN("100");

            await this.weth.updateReward(this.feeCollector.address, wallet, reward);
            
            const price = await this.feeCollector.price.call(this.weth.address);
            const tokenInfo1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.tokenBalance.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.inchBalance.toString()).equal("0");
            expect(tokenInfo1.firstUnprocessedEpoch.toString()).equal("0");
            expect(tokenInfo1.currentEpoch.toString()).equal("0");

            const returnAmount = toBN(10);
            const amount = price.mul(returnAmount);

            await this.feeCollector.trade(this.weth.address, amount, { 'from': wallet });
            
            const tokenInfo2 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo2.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2.epochBalance.tokenBalance.toString()).equal(reward.sub(returnAmount).toString());
            expect(tokenInfo2.epochBalance.inchBalance.toString()).equal(amount.toString());
            expect(tokenInfo2.firstUnprocessedEpoch.toString()).equal("0");
            expect(tokenInfo2.currentEpoch.toString()).equal("1");
        });

        it('tokenInfo after trade all frozen epoch', async function () {
            let reward = toBN("100");

            await this.weth.updateReward(this.feeCollector.address, wallet, reward);
            
            const price = await this.feeCollector.price.call(this.weth.address);
            const tokenInfo1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.tokenBalance.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.inchBalance.toString()).equal("0");
            expect(tokenInfo1.firstUnprocessedEpoch.toString()).equal("0");
            expect(tokenInfo1.currentEpoch.toString()).equal("0");

            const returnAmount = toBN(100);
            const amount = price.mul(returnAmount);

            await this.feeCollector.trade(this.weth.address, amount, { 'from': wallet });
            
            const tokenInfo2 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo2.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2.epochBalance.tokenBalance.toString()).equal(reward.sub(returnAmount).toString());
            expect(tokenInfo2.epochBalance.inchBalance.toString()).equal(amount.toString());
            expect(tokenInfo2.firstUnprocessedEpoch.toString()).equal("1");
            expect(tokenInfo2.currentEpoch.toString()).equal("1");
        });

        it('tokenInfo after trade frozen and current epoch', async function () {
            let reward = toBN("10");

            await this.weth.updateReward(this.feeCollector.address, wallet, reward);
            
            const price = await this.feeCollector.price.call(this.weth.address);
            const returnAmount = toBN(1);
            const amount = price.mul(returnAmount);

            await this.feeCollector.trade(this.weth.address, amount, { 'from': wallet });
            await this.weth.updateReward(this.feeCollector.address, wallet, reward);

            const price2 = await this.feeCollector.price.call(this.weth.address);
            const returnAmount2 = toBN(10);
            const amount2 = price2.mul(returnAmount2);
            await this.feeCollector.trade(this.weth.address, amount2, { 'from': wallet });
            
            const tokenInfo1_epoch0 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo1_epoch0.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo1_epoch0.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo1_epoch0.epochBalance.tokenBalance.toString()).equal("0");
            expect(tokenInfo1_epoch0.epochBalance.inchBalance.toString()).equal(amount.add(amount2.muln(9).divn(10)).toString());
            expect(tokenInfo1_epoch0.firstUnprocessedEpoch.toString()).equal("1");
            expect(tokenInfo1_epoch0.currentEpoch.toString()).equal("2");

            const tokenInfo1_epoch1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 1);

            expect(tokenInfo1_epoch1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo1_epoch1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo1_epoch1.epochBalance.tokenBalance.toString()).equal("9");
            expect(tokenInfo1_epoch1.epochBalance.inchBalance.toString()).equal(amount2.divn(10).toString());
            expect(tokenInfo1_epoch1.firstUnprocessedEpoch.toString()).equal("1");
            expect(tokenInfo1_epoch1.currentEpoch.toString()).equal("2");

            const balance1 = await this.feeCollector.balance.call(wallet);
            expect(balance1.toString()).equal("0");

            // claim with updateReward method
            await this.weth.updateReward(this.feeCollector.address, wallet, reward);

            const tokenInfo2_epoch0 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo2_epoch0.epochBalance.userBalance.toString()).equal("0");
            expect(tokenInfo2_epoch0.epochBalance.totalSupply.toString()).equal("0");
            expect(tokenInfo2_epoch0.epochBalance.tokenBalance.toString()).equal("0");
            expect(tokenInfo2_epoch0.epochBalance.inchBalance.toString()).equal("0");
            expect(tokenInfo2_epoch0.firstUnprocessedEpoch.toString()).equal("1");
            expect(tokenInfo2_epoch0.currentEpoch.toString()).equal("2");

            const tokenInfo2_epoch1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 1);

            expect(tokenInfo2_epoch1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2_epoch1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2_epoch1.epochBalance.tokenBalance.toString()).equal("9");
            expect(tokenInfo2_epoch1.epochBalance.inchBalance.toString()).equal(amount2.divn(10).toString());
            expect(tokenInfo2_epoch1.firstUnprocessedEpoch.toString()).equal("1");
            expect(tokenInfo2_epoch1.currentEpoch.toString()).equal("2");

            const tokenInfo2_epoch2 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 2);

            expect(tokenInfo2_epoch2.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2_epoch2.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2_epoch2.epochBalance.tokenBalance.toString()).equal(reward.toString());
            expect(tokenInfo2_epoch2.epochBalance.inchBalance.toString()).equal("0");
            expect(tokenInfo2_epoch2.firstUnprocessedEpoch.toString()).equal("1");
            expect(tokenInfo2_epoch2.currentEpoch.toString()).equal("2");

            const balance2 = await this.feeCollector.balance.call(wallet);
            expect(balance2.toString()).equal(amount.add(amount2.muln(9).divn(10)).toString());
        });

        it('trade with "not enough" error when frozen and current epochs are equals', async function () {
            let reward = toBN("10");

            await this.weth.updateReward(this.feeCollector.address, wallet, reward);

            const price = await this.feeCollector.price.call(this.weth.address);
            const returnAmount = reward.muln(2000);
            const amount = price.mul(returnAmount);

            try {
                await this.feeCollector.trade(this.weth.address, amount, { 'from': wallet });
                expect(true).equal(false); 
            } catch (error) {
                expect(error.toString().indexOf('not enough tokens') != -1).equal(true);
            }
        });

        it('trade with "not enough" error when frozen and current epochs are not equals', async function () {
            let reward = toBN("10");

            await this.weth.updateReward(this.feeCollector.address, wallet, reward);

            const price = await this.feeCollector.price.call(this.weth.address);
            const returnAmount = toBN(1);
            const amount = price.mul(returnAmount);

            await this.feeCollector.trade(this.weth.address, amount, { 'from': wallet });
            await this.weth.updateReward(this.feeCollector.address, wallet, reward);

            const price2 = await this.feeCollector.price.call(this.weth.address);
            const returnAmount2 = toBN(1000000);
            const amount2 = price2.mul(returnAmount2);
            
            try {
                await this.feeCollector.trade(this.weth.address, amount2, { 'from': wallet });
                expect(true).equal(false); 
            } catch (error) {
                expect(error.toString().indexOf('not enough tokens') != -1).equal(true);
            }
        });
    });

    describe('Something', async function () {
        it('Anything', async function () {
            expect(true).equal(true);
        });
    });
});
