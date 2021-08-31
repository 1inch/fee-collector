require('@nomiclabs/hardhat-ethers');
require('@nomiclabs/hardhat-etherscan');
require('@nomiclabs/hardhat-truffle5');
require('solidity-coverage');
require('hardhat-deploy');
require('hardhat-gas-reporter');
require('dotenv').config();

const networks = require('./hardhat.networks');

module.exports = {
    solidity: {
        version: '0.8.7',
        settings: {
            optimizer: {
                enabled: true,
                runs: 1000000,
            },
        },
    },
    networks: networks,
    etherscan: {
        apiKey: process.env.MAINNET_ETHERSCAN_KEY,
    },
    namedAccounts: {
        deployer: {
            default: 0,
        },
    },
    gasReporter: {
        enable: true,
        currency: 'USD',
    },
};
