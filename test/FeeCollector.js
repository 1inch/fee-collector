const { expect } = require('chai');
const { ether, profileEVM, toBN } = require('@1inch/solidity-utils');

const TokenMock = artifacts.require('TokenMock');
const TokenWithUpdateRewardMock = artifacts.require('TokenWithUpdateRewardMock');
const FeeCollector = artifacts.require('FeeCollector');

async function getTokenInfo (feeCollector, token, user, epoch) {
    const tokenInfo = await feeCollector.tokenInfo.call(token);

    const userEpochBalance = await feeCollector.getUserEpochBalance.call(token, epoch, user);
    const { totalSupply, traded, tokenBalance } = await feeCollector.getEpochBalance.call(token, epoch);
    const firstUserUnprocessedEpoch = await feeCollector.getFirstUserUnprocessedEpoch.call(token, user);

    return {
        epochBalance: {
            userBalance: userEpochBalance,
            totalSupply: totalSupply,
            traded: traded,
            tokenBalance: tokenBalance,
        },
        firstUnprocessedEpoch: tokenInfo.firstUnprocessedEpoch,
        currentEpoch: tokenInfo.currentEpoch,
        firstUserUnprocessedEpoch: firstUserUnprocessedEpoch,
        lastValue: tokenInfo.lastValue,
        lastTime: tokenInfo.lastTime,
    };
}

async function getTokenBalance (feeCollector, token) {
    const tokenInfo = await feeCollector.tokenInfo.call(token);

    const currentEpoch = tokenInfo.currentEpoch;
    const firstUnprocessedEpoch = tokenInfo.firstUnprocessedEpoch;

    let { totalSupply, traded } = await feeCollector.getEpochBalance.call(token, firstUnprocessedEpoch);
    if (!firstUnprocessedEpoch.eq(currentEpoch)) {
        const currentEpochBalance = await feeCollector.getEpochBalance.call(token, currentEpoch);
        traded = traded.add(currentEpochBalance.traded);
        totalSupply = totalSupply.add(currentEpochBalance.totalSupply);
    }
    return totalSupply.sub(traded);
}

contract('FeeCollector', async function ([_, wallet, wallet2]) {
    const name = 'FeeCollector: INCH';
    const symbol = 'fee-INCH';

    const minValue = '100000000000000000000';
    const deceleration = '999900000000000000000000000000000000';

    const bn1e36 = toBN('1000000000000000000000000000000000000');
    const decelerationBN = toBN(deceleration);

    before(async function () {
    });

    beforeEach(async function () {
        this.weth = await TokenWithUpdateRewardMock.new('WETH', 'WETH');
        this.token = await TokenMock.new('INCH', 'INCH');

        this.feeCollector = await FeeCollector.new(this.token.address, minValue);

        await this.weth.mint(wallet, ether('1000000'));
        await this.weth.approve(this.feeCollector.address, ether('1000000'), { from: wallet });

        await this.token.mint(this.feeCollector.address, ether('1000'));

        await this.token.mint(wallet2, ether('1000000'));
        await this.token.approve(this.feeCollector.address, ether('1000000'), { from: wallet2 });
    });

    describe('Gas measurements', async function () {
        it('should be cheap', async function () {
            await this.feeCollector.contract.methods.valueForTime(0, this.weth.address).send({ from: _ });
            await this.feeCollector.contract.methods.valueForTime(1000, this.weth.address).send({ from: _ });
            await this.feeCollector.contract.methods.valueForTime(1000000, this.weth.address).send({ from: _ });
            const receipt = await this.feeCollector.contract.methods.valueForTime(0xFFFFF, this.weth.address).send({ from: _ });
            if (process.env.npm_lifecycle_event !== 'coverage') {
                expect(await profileEVM(receipt.transactionHash, ['SLOAD'])).to.be.deep.equals([1]);
            }

            // await this.feeCollector.contract.methods.valueForTimeSimple(0, this.weth.address).send({ from: _ });
            // await this.feeCollector.contract.methods.valueForTimeSimple(1000, this.weth.address).send({ from: _ });
            // await this.feeCollector.contract.methods.valueForTimeSimple(1000000, this.weth.address).send({ from: _ });
            // const receipt2 = await this.feeCollector.contract.methods.valueForTimeSimple(0xFFFFF, this.weth.address).send({ from: _ });
            // if (process.env.npm_lifecycle_event !== 'coverage') {
            //     expect(await profileEVM(receipt2.transactionHash, 'SLOAD')).equal(1);
            // }
        });
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

        it('started value', async function () {
            const cost = await this.feeCollector.valueForTime.call(toBN(0), this.weth.address);
            expect(cost.toString()).equal(minValue);
        });

        it('name', async function () {
            const result = await this.feeCollector.name.call();
            expect(result).equal(name);
        });

        it('symbol', async function () {
            const result = await this.feeCollector.symbol.call();
            expect(result).equal(symbol);
        });
    });

    describe('valueForTime', async function () {
        it('current time before reward', async function () {
            const currTime = toBN(new Date().getTime());
            const cost = await this.feeCollector.valueForTime.call(currTime, this.weth.address);
            expect(cost.toString()).equal(minValue.toString());
        });

        it('add reward 100 and check cost changing', async function () {
            let lastTime = toBN(new Date().getTime());
            const cost1 = await this.feeCollector.valueForTime.call(lastTime, this.weth.address);

            await this.weth.updateReward(this.feeCollector.address, wallet, toBN(100), { from: wallet });

            const tokenInfo = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);
            lastTime = tokenInfo.lastTime;
            const cost2 = await this.feeCollector.valueForTime.call(lastTime, this.weth.address);
            expect(cost1.muln(100).toString()).equal(cost2.toString());
        });

        it('add reward 100 and check cost changing after 1 sec', async function () {
            await this.weth.updateReward(this.feeCollector.address, wallet, toBN(100), { from: wallet });

            const tokenInfo = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);
            const lastTime = tokenInfo.lastTime;

            const cost1 = await this.feeCollector.valueForTime.call(lastTime, this.weth.address);
            expect(cost1.toString()).equal(toBN(minValue).muln(100).toString());

            const cost2 = await this.feeCollector.valueForTime.call(lastTime.add(toBN(1)), this.weth.address);
            const result = cost1.mul(toBN(deceleration)).div(bn1e36);
            expect(cost2.toString()).equal(result.toString());
        });

        it('add reward 1.5e7 and check cost changing to minValue with time', async function () {
            await this.weth.updateReward(this.feeCollector.address, wallet, toBN(15000000), { from: wallet });

            const tokenInfo = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);
            const lastTime = tokenInfo.lastTime;
            const maxValueBN = toBN(minValue).muln(15000000);
            const minValueBN = toBN(minValue);
            let cost = await this.feeCollector.valueForTime.call(lastTime, this.weth.address);
            expect(cost.toString()).equal(maxValueBN.toString());

            cost = await this.feeCollector.valueForTime.call(lastTime.add(toBN(1)), this.weth.address);
            expect(cost.toString()).equal(maxValueBN.mul(toBN(deceleration)).div(bn1e36).toString());

            const step = 1000;
            for (let i = 0; i < 200; i++) {
                const n = toBN(i).muln(step);

                cost = await this.feeCollector.valueForTime.call(lastTime.add(n), this.weth.address);

                let result = maxValueBN;
                let tableCalc = decelerationBN;
                for (let j = 0; j < Math.floor(Math.log2(n)); j++) {
                    if ((n >> j) & 1 !== 0) {
                        result = result.mul(tableCalc).div(bn1e36);
                    }
                    tableCalc = tableCalc.mul(tableCalc).div(bn1e36);
                }

                if (!n.eq(toBN(0))) {
                    result = result.mul(tableCalc).div(bn1e36);
                }

                if (result.lt(minValueBN)) {
                    result = minValueBN;
                }

                expect(result.toString()).equal(cost.toString());
            }
        });

        it('_updateTokenState', async function () {
            const reward = toBN(100);

            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            // tokenInfo
            const tokenInfo = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);
            const lastValue = tokenInfo.lastValue;
            expect(lastValue).to.be.bignumber.equal(toBN(minValue).mul(reward));
            expect(tokenInfo.epochBalance.traded).to.be.bignumber.equal('0');

            // trade half of tokens
            let value = await this.feeCollector.value.call(this.weth.address);
            const returnAmount = reward.divn(2);
            const amount = value.divn(2);
            expect(value).to.be.bignumber.equal(toBN(minValue).mul(reward));
            expect(amount).to.be.bignumber.equal(value.divn(2));

            await this.feeCollector.trade(this.weth.address, amount, '1', { from: wallet2 });

            // tokenInfo after trade
            value = await this.feeCollector.value.call(this.weth.address);
            const tokenInfo2 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);
            const lastValue2 = tokenInfo2.lastValue;
            expect(lastValue2).to.be.bignumber.equal(value);
            expect(lastValue.div(lastValue2)).to.be.bignumber.equal('2');
            expect(tokenInfo2.epochBalance.traded).to.be.bignumber.equal(reward.divn(2));

            // update reward and check token state
            await this.weth.updateReward(this.feeCollector.address, wallet, returnAmount, { from: wallet });

            // tokenInfo after reward
            value = await this.feeCollector.value.call(this.weth.address);
            const tokenInfo3 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);
            const lastValue3 = tokenInfo3.lastValue;
            expect(lastValue3).to.be.bignumber.equal(value);
            expect(lastValue.div(lastValue3)).to.be.bignumber.equal('1');
            expect(tokenInfo3.epochBalance.traded).to.be.bignumber.equal(reward.divn(2));
            const tokenInfo31 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 1);
            expect(tokenInfo31.epochBalance.traded).to.be.bignumber.equal('0');
        });
    });

    describe('updateReward', async function () {
        it('lastTokenValue changes', async function () {
            const reward = toBN(100);

            const tokenInfo1 = await this.feeCollector.tokenInfo.call(this.weth.address);
            expect(tokenInfo1.lastValue.toString()).equal('0');

            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const tokenInfo2 = await this.feeCollector.tokenInfo.call(this.weth.address);
            expect(tokenInfo2.lastValue.toString()).equal(toBN(minValue).mul(reward).toString());
        });

        it('lastTokenTime changes', async function () {
            const reward = toBN(100);

            const tokenInfo1 = await this.feeCollector.tokenInfo.call(this.weth.address);
            const lastTIme1 = tokenInfo1.lastTime;

            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const tokenInfo2 = await this.feeCollector.tokenInfo.call(this.weth.address);
            const lastTIme2 = tokenInfo2.lastTime;
            expect(lastTIme2 > lastTIme1).equal(true);
        });

        it('tokenInfo after reward', async function () {
            const reward = toBN(100);

            const tokenInfo1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo1.epochBalance.userBalance.toString()).equal('0');
            expect(tokenInfo1.epochBalance.totalSupply.toString()).equal('0');
            expect(tokenInfo1.epochBalance.traded.toString()).equal('0');
            expect(tokenInfo1.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo1.firstUserUnprocessedEpoch.toString()).equal('0');

            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const tokenInfo2 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo2.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2.epochBalance.traded.toString()).equal('0');
            expect(tokenInfo2.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo2.firstUserUnprocessedEpoch.toString()).equal('0');
        });

        it('tokenInfo after the freezing epoch', async function () {
            const reward = toBN(100);

            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const value = await this.feeCollector.value.call(this.weth.address);
            const tokenInfo1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.traded.toString()).equal('0');
            expect(tokenInfo1.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo1.firstUserUnprocessedEpoch.toString()).equal('0');

            const tokenBalance = await getTokenBalance(this.feeCollector, this.weth.address);
            const returnAmount = toBN(10);
            const amount = value.mul(returnAmount).div(tokenBalance);

            await this.feeCollector.trade(this.weth.address, amount, '1', { from: wallet2 });
            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const tokenInfo2epoch0 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo2epoch0.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2epoch0.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2epoch0.epochBalance.traded.toString()).equal(returnAmount.toString());
            expect(tokenInfo2epoch0.epochBalance.tokenBalance.toString()).equal(amount.toString());
            expect(tokenInfo2epoch0.firstUnprocessedEpoch.toString()).equal('0');

            const tokenInfo2epoch1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 1);

            expect(tokenInfo2epoch1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2epoch1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2epoch1.epochBalance.traded.toString()).equal('0');
            expect(tokenInfo2epoch1.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo2epoch1.firstUserUnprocessedEpoch.toString()).equal('0');
        });

        it('tokenInfo after epoch sellout', async function () {
            const reward = toBN(100);

            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const value = await this.feeCollector.value.call(this.weth.address);
            const tokenInfo1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.traded.toString()).equal('0');
            expect(tokenInfo1.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo1.firstUserUnprocessedEpoch.toString()).equal('0');

            const tokenBalance = await getTokenBalance(this.feeCollector, this.weth.address);
            const returnAmount = toBN(100);
            const amount = value.mul(returnAmount).div(tokenBalance);

            await this.feeCollector.trade(this.weth.address, amount, '1', { from: wallet2 });
            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const tokenInfo2epoch0 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo2epoch0.epochBalance.userBalance.toString()).equal('0');
            expect(tokenInfo2epoch0.epochBalance.totalSupply.toString()).equal('0');
            expect(tokenInfo2epoch0.epochBalance.traded.toString()).equal(returnAmount.toString());
            expect(tokenInfo2epoch0.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo2epoch0.firstUnprocessedEpoch.toString()).equal('1');

            const tokenInfo2epoch1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 1);

            expect(tokenInfo2epoch1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2epoch1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2epoch1.epochBalance.traded.toString()).equal('0');
            expect(tokenInfo2epoch1.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo2epoch1.firstUserUnprocessedEpoch.toString()).equal('1');
        });

        it('balance after epoch sellout', async function () {
            const reward = toBN(100);

            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const value = await this.feeCollector.value.call(this.weth.address);
            const balance1 = await this.feeCollector.balanceOf.call(wallet);

            expect(balance1.toString()).equal('0');

            const tokenBalance = await getTokenBalance(this.feeCollector, this.weth.address);
            const returnAmount = toBN(100);
            const amount = value.mul(returnAmount).div(tokenBalance);

            await this.feeCollector.trade(this.weth.address, amount, '1', { from: wallet2 });
            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const balance2 = await this.feeCollector.balanceOf.call(wallet);
            expect(balance2.toString()).equal(amount.toString());
        });
    });

    describe('updateRewardNonLP', async function () {
        it('lastTokenValue changes', async function () {
            const reward = toBN(100);

            const tokenInfo1 = await this.feeCollector.tokenInfo.call(this.weth.address);
            expect(tokenInfo1.lastValue.toString()).equal('0');

            await this.feeCollector.updateRewardNonLP(this.weth.address, wallet, reward, { from: wallet });

            const tokenInfo2 = await this.feeCollector.tokenInfo.call(this.weth.address);
            expect(tokenInfo2.lastValue.toString()).equal(toBN(minValue).mul(reward).toString());
        });

        it('lastTokenTime changes', async function () {
            const reward = toBN(100);

            const tokenInfo1 = await this.feeCollector.tokenInfo.call(this.weth.address);
            const lastTIme1 = tokenInfo1.lastTime;

            await this.feeCollector.updateRewardNonLP(this.weth.address, wallet, reward, { from: wallet });

            const tokenInfo2 = await this.feeCollector.tokenInfo.call(this.weth.address);
            const lastTIme2 = tokenInfo2.lastTime;
            expect(lastTIme2 > lastTIme1).equal(true);
        });

        it('tokenInfo after reward', async function () {
            const reward = toBN(100);

            const tokenInfo1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo1.epochBalance.userBalance.toString()).equal('0');
            expect(tokenInfo1.epochBalance.totalSupply.toString()).equal('0');
            expect(tokenInfo1.epochBalance.traded.toString()).equal('0');
            expect(tokenInfo1.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo1.firstUserUnprocessedEpoch.toString()).equal('0');

            await this.feeCollector.updateRewardNonLP(this.weth.address, wallet, reward, { from: wallet });

            const tokenInfo2 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo2.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2.epochBalance.traded.toString()).equal('0');
            expect(tokenInfo2.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo2.firstUserUnprocessedEpoch.toString()).equal('0');
        });

        it('tokenInfo after the freezing epoch', async function () {
            const reward = toBN(100);

            await this.feeCollector.updateRewardNonLP(this.weth.address, wallet, reward, { from: wallet });

            const value = await this.feeCollector.value.call(this.weth.address);
            const tokenInfo1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.traded.toString()).equal('0');
            expect(tokenInfo1.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo1.firstUserUnprocessedEpoch.toString()).equal('0');

            const tokenBalance = await getTokenBalance(this.feeCollector, this.weth.address);
            const returnAmount = toBN(10);
            const amount = value.mul(returnAmount).div(tokenBalance);

            await this.feeCollector.trade(this.weth.address, amount, '1', { from: wallet2 });
            await this.feeCollector.updateRewardNonLP(this.weth.address, wallet, reward, { from: wallet });

            const tokenInfo2epoch0 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo2epoch0.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2epoch0.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2epoch0.epochBalance.traded.toString()).equal(returnAmount.toString());
            expect(tokenInfo2epoch0.epochBalance.tokenBalance.toString()).equal(amount.toString());
            expect(tokenInfo2epoch0.firstUnprocessedEpoch.toString()).equal('0');

            const tokenInfo2epoch1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 1);

            expect(tokenInfo2epoch1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2epoch1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2epoch1.epochBalance.traded.toString()).equal('0');
            expect(tokenInfo2epoch1.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo2epoch1.firstUserUnprocessedEpoch.toString()).equal('0');
        });

        it('tokenInfo after epoch sellout', async function () {
            const reward = toBN(100);

            await this.feeCollector.updateRewardNonLP(this.weth.address, wallet, reward, { from: wallet });

            const value = await this.feeCollector.value.call(this.weth.address);
            const tokenInfo1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.traded.toString()).equal('0');
            expect(tokenInfo1.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo1.firstUserUnprocessedEpoch.toString()).equal('0');

            const traded = await getTokenBalance(this.feeCollector, this.weth.address);
            const returnAmount = toBN(100);
            const amount = value.mul(returnAmount).div(traded);

            await this.feeCollector.trade(this.weth.address, amount, '1', { from: wallet2 });
            await this.feeCollector.updateRewardNonLP(this.weth.address, wallet, reward, { from: wallet });

            const tokenInfo2epoch0 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo2epoch0.epochBalance.userBalance.toString()).equal('0');
            expect(tokenInfo2epoch0.epochBalance.totalSupply.toString()).equal('0');
            expect(tokenInfo2epoch0.epochBalance.traded.toString()).equal(returnAmount.toString());
            expect(tokenInfo2epoch0.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo2epoch0.firstUnprocessedEpoch.toString()).equal('1');

            const tokenInfo2epoch1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 1);

            expect(tokenInfo2epoch1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2epoch1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2epoch1.epochBalance.traded.toString()).equal('0');
            expect(tokenInfo2epoch1.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo2epoch1.firstUserUnprocessedEpoch.toString()).equal('1');
        });

        it('balance after epoch sellout', async function () {
            const reward = toBN(100);

            await this.feeCollector.updateRewardNonLP(this.weth.address, wallet, reward, { from: wallet });

            const value = await this.feeCollector.value.call(this.weth.address);
            const balance1 = await this.feeCollector.balanceOf.call(wallet);

            expect(balance1.toString()).equal('0');

            const tokenBalance = await getTokenBalance(this.feeCollector, this.weth.address);
            const returnAmount = toBN(100);
            const amount = value.mul(returnAmount).div(tokenBalance);

            await this.feeCollector.trade(this.weth.address, amount, '1', { from: wallet2 });
            await this.feeCollector.updateRewardNonLP(this.weth.address, wallet, reward, { from: wallet });

            const balance2 = await this.feeCollector.balanceOf.call(wallet);
            expect(balance2.toString()).equal(amount.toString());
        });
    });

    describe('trade', async function () {
        it('tokenInfo after trade part of only frozen epoch', async function () {
            const reward = toBN('100');

            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const value = await this.feeCollector.value.call(this.weth.address);
            const tokenInfo1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.traded.toString()).equal('0');
            expect(tokenInfo1.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo1.firstUnprocessedEpoch.toString()).equal('0');
            expect(tokenInfo1.currentEpoch.toString()).equal('0');

            const tokenBalance = await getTokenBalance(this.feeCollector, this.weth.address);
            const returnAmount = toBN(10);
            const amount = value.mul(returnAmount).div(tokenBalance);

            await this.feeCollector.trade(this.weth.address, amount, '1', { from: wallet2 });

            const tokenInfo2 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo2.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2.epochBalance.traded.toString()).equal(returnAmount.toString());
            expect(tokenInfo2.epochBalance.tokenBalance.toString()).equal(amount.toString());
            expect(tokenInfo2.firstUnprocessedEpoch.toString()).equal('0');
            expect(tokenInfo2.currentEpoch.toString()).equal('1');
        });

        it('tokenInfo after trade all frozen epoch', async function () {
            const reward = toBN('100');

            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const value = await this.feeCollector.value.call(this.weth.address);
            const tokenInfo1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo1.epochBalance.traded.toString()).equal('0');
            expect(tokenInfo1.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo1.firstUnprocessedEpoch.toString()).equal('0');
            expect(tokenInfo1.currentEpoch.toString()).equal('0');

            const tokenBalance = await getTokenBalance(this.feeCollector, this.weth.address);
            const returnAmount = toBN(100);
            const amount = value.mul(returnAmount).div(tokenBalance);

            await this.feeCollector.trade(this.weth.address, amount, '1', { from: wallet2 });

            const tokenInfo2 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo2.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2.epochBalance.traded.toString()).equal(returnAmount.toString());
            expect(tokenInfo2.epochBalance.tokenBalance.toString()).equal(amount.toString());
            expect(tokenInfo2.firstUnprocessedEpoch.toString()).equal('1');
            expect(tokenInfo2.currentEpoch.toString()).equal('1');
        });

        it('tokenInfo after trade frozen and current epoch', async function () {
            const reward = toBN('10');

            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const value = await this.feeCollector.value.call(this.weth.address);
            const tokenBalance = await getTokenBalance(this.feeCollector, this.weth.address);
            const returnAmount = toBN(1);
            const amount = value.mul(returnAmount).div(tokenBalance);

            await this.feeCollector.trade(this.weth.address, amount, '1', { from: wallet2 });
            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const value2 = await this.feeCollector.value.call(this.weth.address);
            const tokenBalance2 = await getTokenBalance(this.feeCollector, this.weth.address);
            const returnAmount2 = toBN(10);
            const amount2 = value2.mul(returnAmount2).div(tokenBalance2);
            await this.feeCollector.trade(this.weth.address, amount2, '1', { from: wallet2 });

            const tokenInfo1epoch0 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo1epoch0.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo1epoch0.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo1epoch0.epochBalance.traded.toString()).equal('10');
            expect(tokenInfo1epoch0.epochBalance.tokenBalance.toString()).equal(amount.add(amount2.muln(9).divn(10)).toString());
            expect(tokenInfo1epoch0.firstUnprocessedEpoch.toString()).equal('1');
            expect(tokenInfo1epoch0.currentEpoch.toString()).equal('2');

            const tokenInfo1epoch1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 1);

            expect(tokenInfo1epoch1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo1epoch1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo1epoch1.epochBalance.traded.toString()).equal('1');
            expect(tokenInfo1epoch1.epochBalance.tokenBalance.toString()).equal(amount2.divn(10).toString());
            expect(tokenInfo1epoch1.firstUnprocessedEpoch.toString()).equal('1');
            expect(tokenInfo1epoch1.currentEpoch.toString()).equal('2');

            const balance1 = await this.feeCollector.balanceOf.call(wallet);
            expect(balance1.toString()).equal('0');

            // claim with updateReward method
            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const tokenInfo2epoch0 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 0);

            expect(tokenInfo2epoch0.epochBalance.userBalance.toString()).equal('0');
            expect(tokenInfo2epoch0.epochBalance.totalSupply.toString()).equal('0');
            expect(tokenInfo2epoch0.epochBalance.traded.toString()).equal('10');
            expect(tokenInfo2epoch0.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo2epoch0.firstUnprocessedEpoch.toString()).equal('1');
            expect(tokenInfo2epoch0.currentEpoch.toString()).equal('2');

            const tokenInfo2epoch1 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 1);

            expect(tokenInfo2epoch1.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2epoch1.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2epoch1.epochBalance.traded.toString()).equal('1');
            expect(tokenInfo2epoch1.epochBalance.tokenBalance.toString()).equal(amount2.divn(10).toString());
            expect(tokenInfo2epoch1.firstUnprocessedEpoch.toString()).equal('1');
            expect(tokenInfo2epoch1.currentEpoch.toString()).equal('2');

            const tokenInfo2epoch2 = await getTokenInfo(this.feeCollector, this.weth.address, wallet, 2);

            expect(tokenInfo2epoch2.epochBalance.userBalance.toString()).equal(reward.toString());
            expect(tokenInfo2epoch2.epochBalance.totalSupply.toString()).equal(reward.toString());
            expect(tokenInfo2epoch2.epochBalance.traded.toString()).equal('0');
            expect(tokenInfo2epoch2.epochBalance.tokenBalance.toString()).equal('0');
            expect(tokenInfo2epoch2.firstUnprocessedEpoch.toString()).equal('1');
            expect(tokenInfo2epoch2.currentEpoch.toString()).equal('2');

            const balance2 = await this.feeCollector.balanceOf.call(wallet);
            expect(balance2.toString()).equal(amount.add(amount2.muln(9).divn(10)).toString());
        });

        it('trade with "not enough" error when frozen and current epochs are equals', async function () {
            const reward = toBN('10');

            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const value = await this.feeCollector.value.call(this.weth.address);
            const returnAmount = reward.muln(2000);
            const amount = value.mul(returnAmount);

            try {
                await this.feeCollector.trade(this.weth.address, amount, '1', { from: wallet2 });
                expect(true).equal(false);
            } catch (error) {
                expect(error.toString().indexOf('not enough tokens') !== -1).equal(true);
            }
        });

        it('trade with "not enough" error when frozen and current epochs are not equals', async function () {
            const reward = toBN('10');

            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const value = await this.feeCollector.value.call(this.weth.address);
            const returnAmount = toBN(1);
            const amount = value.mul(returnAmount);

            await this.feeCollector.trade(this.weth.address, amount, '1', { from: wallet2 });
            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const value2 = await this.feeCollector.value.call(this.weth.address);
            const returnAmount2 = toBN(1000000);
            const amount2 = value2.mul(returnAmount2);

            try {
                await this.feeCollector.trade(this.weth.address, amount2, '1', { from: wallet2 });
                expect(true).equal(false);
            } catch (error) {
                expect(error.toString().indexOf('not enough tokens') !== -1).equal(true);
            }
        });
    });

    describe('claim', async function () {
        it('claim zero balance', async function () {
            const reward = toBN('10');
            const balance1 = await this.token.balanceOf.call(wallet);

            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });
            await this.feeCollector.claim([this.token.address], { from: wallet });

            const balance2 = await this.token.balanceOf.call(wallet);
            expect(balance1).to.be.bignumber.equal(balance2);
            expect(balance1).to.be.bignumber.equal('0');
        });

        it('claim non zero balance', async function () {
            const reward = toBN('10');
            const balance1 = await this.token.balanceOf.call(wallet);

            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const value = await this.feeCollector.value.call(this.weth.address);
            const tokenBalance = await getTokenBalance(this.feeCollector, this.weth.address);
            const returnAmount = reward;
            const amount = value.mul(returnAmount).div(tokenBalance);

            await this.feeCollector.trade(this.weth.address, amount, '1', { from: wallet2 });
            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });
            await this.feeCollector.claim([this.token.address], { from: wallet });

            const balance2 = await this.token.balanceOf.call(wallet);

            expect(balance1).to.be.bignumber.equal('0');
            expect(balance2).to.be.bignumber.equal(amount.sub(toBN(1)));
        });

        it('claimCurrentEpoch when firstUnprocessedEpoch is equal to currentEpoch', async function () {
            const reward = toBN('10');
            const balance1 = await this.weth.balanceOf.call(wallet2);

            expect(balance1).to.be.bignumber.equal('0');

            await this.weth.updateReward(this.feeCollector.address, wallet2, reward, { from: wallet });
            await this.feeCollector.claimCurrentEpoch(this.weth.address, { from: wallet2 });

            const balance2 = await this.weth.balanceOf.call(wallet2);

            expect(balance2).to.be.bignumber.equal(reward);
        });

        it('claimCurrentEpoch when firstUnprocessedEpoch is not equal to currentEpoch', async function () {
            const reward = toBN('10');

            const balanceWeth1 = await this.weth.balanceOf.call(wallet);
            const balanceToken1 = await this.token.balanceOf.call(wallet);
            expect(balanceToken1).to.be.bignumber.equal('0');

            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const balanceWeth2 = await this.weth.balanceOf.call(wallet);
            const balanceToken2 = await this.token.balanceOf.call(wallet);
            expect(balanceWeth2).to.be.bignumber.equal(balanceWeth1.sub(reward));
            expect(balanceToken2).to.be.bignumber.equal('0');

            const value = await this.feeCollector.value.call(this.weth.address);
            const tokenBalance = await getTokenBalance(this.feeCollector, this.weth.address);
            const returnAmount = reward.divn(2);
            const amount = value.mul(returnAmount).div(tokenBalance);
            await this.feeCollector.trade(this.weth.address, amount, '1', { from: wallet2 });
            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const balanceWeth3 = await this.weth.balanceOf.call(wallet);
            const balanceToken3 = await this.token.balanceOf.call(wallet);
            expect(balanceWeth3).to.be.bignumber.equal(balanceWeth2.sub(reward));
            expect(balanceToken3).to.be.bignumber.equal('0');

            await this.feeCollector.claimCurrentEpoch(this.weth.address, { from: wallet });

            const balanceWeth4 = await this.weth.balanceOf.call(wallet);
            const balanceToken4 = await this.token.balanceOf.call(wallet);
            expect(balanceWeth4).to.be.bignumber.equal(balanceWeth3.add(reward));
            expect(balanceToken4).to.be.bignumber.equal('0');
        });

        it('claimFrozenEpoch with "Epoch already finalized" error', async function () {
            const reward = toBN('10');

            await this.weth.updateReward(this.feeCollector.address, wallet2, reward, { from: wallet });

            try {
                await this.feeCollector.claimFrozenEpoch(this.weth.address, { from: wallet2 });
                expect(true).equal(false);
            } catch (error) {
                expect(error.toString().indexOf('Epoch already finalized') !== -1).equal(true);
            }
        });

        it('claimFrozenEpoch with "Epoch funds already claimed" error', async function () {
            const reward = toBN('10');

            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });
            await this.feeCollector.claimCurrentEpoch(this.weth.address, { from: wallet });
            await this.weth.updateReward(this.feeCollector.address, wallet2, reward, { from: wallet });

            const value = await this.feeCollector.value.call(this.weth.address);
            const tokenBalance = await getTokenBalance(this.feeCollector, this.weth.address);
            const returnAmount = reward;
            const amount = value.mul(returnAmount).div(tokenBalance);

            await this.feeCollector.trade(this.weth.address, amount, '1', { from: wallet2 });
            await this.weth.updateReward(this.feeCollector.address, wallet2, reward, { from: wallet });

            const value2 = await this.feeCollector.value.call(this.weth.address);
            const tokenBalance2 = await getTokenBalance(this.feeCollector, this.weth.address);
            const returnAmount2 = reward.divn(2);
            const amount2 = value2.mul(returnAmount2).div(tokenBalance2);

            await this.feeCollector.trade(this.weth.address, amount2, '1', { from: wallet2 });

            try {
                await this.feeCollector.claimFrozenEpoch(this.weth.address, { from: wallet });
                expect(true).equal(false);
            } catch (error) {
                expect(error.toString().indexOf('Epoch funds already claimed') !== -1).equal(true);
            }
        });

        it('claimFrozenEpoch without error', async function () {
            const reward = toBN('10');

            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });
            await this.feeCollector.claimCurrentEpoch(this.weth.address, { from: wallet });
            await this.weth.updateReward(this.feeCollector.address, wallet2, reward, { from: wallet });

            const value = await this.feeCollector.value.call(this.weth.address);
            const tokenBalance = await getTokenBalance(this.feeCollector, this.weth.address);
            const returnAmount = reward;
            const amount = value.mul(returnAmount).div(tokenBalance);

            await this.feeCollector.trade(this.weth.address, amount, '1', { from: wallet2 });
            await this.weth.updateReward(this.feeCollector.address, wallet2, reward, { from: wallet });

            const value2 = await this.feeCollector.value.call(this.weth.address);
            const tokenBalance2 = await getTokenBalance(this.feeCollector, this.weth.address);
            const returnAmount2 = reward.divn(3);
            const amount2 = value2.mul(returnAmount2).div(tokenBalance2);

            await this.feeCollector.trade(this.weth.address, amount2, '1', { from: wallet2 });

            const balanceWeth1 = await this.weth.balanceOf.call(wallet2);
            const balanceToken1 = await this.token.balanceOf.call(wallet2);

            let tokenInfo = await getTokenInfo(this.feeCollector, this.weth.address, wallet2, 0);
            const firstUnprocessedEpoch = tokenInfo.firstUnprocessedEpoch;

            tokenInfo = await getTokenInfo(this.feeCollector, this.weth.address, wallet2, firstUnprocessedEpoch);
            const tokenInfoTokenBalance = tokenInfo.epochBalance.totalSupply.sub(tokenInfo.epochBalance.traded);
            const tokenInfoInchBalance = tokenInfo.epochBalance.tokenBalance;

            await this.feeCollector.claimFrozenEpoch(this.weth.address, { from: wallet2 });

            const balanceWeth2 = await this.weth.balanceOf.call(wallet2);
            const balanceToken2 = await this.token.balanceOf.call(wallet2);

            expect(balanceWeth2).to.be.bignumber.equal(balanceWeth1.add(tokenInfoTokenBalance));
            expect(balanceToken2).to.be.bignumber.equal(balanceToken1.add(tokenInfoInchBalance));

            tokenInfo = await getTokenInfo(this.feeCollector, this.weth.address, wallet2, firstUnprocessedEpoch);
            expect(tokenInfo.epochBalance.userBalance).to.be.bignumber.equal('0');
            expect(tokenInfo.epochBalance.totalSupply).to.be.bignumber.equal('0');
            expect(tokenInfo.epochBalance.traded).to.be.bignumber.equal(reward.divn(3));
            expect(tokenInfo.epochBalance.tokenBalance).to.be.bignumber.equal('0');
        });
    });

    describe('ERC-20 like interface for balance accounting', async function () {
        it('mint and burn', async function () {
            const reward = toBN('10');

            // mint
            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const value = await this.feeCollector.value.call(this.weth.address);
            const tokenBalance = await getTokenBalance(this.feeCollector, this.weth.address);
            const returnAmount = reward;
            const amount = value.mul(returnAmount).div(tokenBalance);

            await this.feeCollector.trade(this.weth.address, amount, '1', { from: wallet2 });
            await this.weth.updateReward(this.feeCollector.address, wallet, reward, { from: wallet });

            const balance = await this.feeCollector.balanceOf(wallet);

            expect(balance).to.be.bignumber.equal(amount);

            // burn
            await this.feeCollector.claim([this.token.address], { from: wallet });

            const balance2 = await this.feeCollector.balanceOf(wallet);

            expect(balance2).to.be.bignumber.equal('1');
        });
    });

    describe('Something', async function () {
        it('Anything', async function () {
            expect(true).equal(true);
        });
    });
});
