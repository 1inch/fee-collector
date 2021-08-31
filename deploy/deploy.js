const hre = require('hardhat');
const { getChainId } = hre;
const { ether } = require('@openzeppelin/test-helpers');

module.exports = async ({ getNamedAccounts, deployments }) => {
    console.log('running deploy script');
    console.log('network id ', await getChainId());

    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    const args = ['0x111111111117dC0aa78b770fA6A738034120C302', ether('100').toString()];

    const FeeCollector = await deploy('FeeCollector', {
        args: args,
        from: deployer,
        maxFeePerGas: 100000000000,
        maxPriorityFeePerGas: 2000000000,
        skipIfAlreadyDeployed: true,
    });

    console.log('FeeCollector deployed to:', FeeCollector.address);

    await hre.run('verify:verify', {
        address: FeeCollector.address,
        constructorArguments: args,
    });
};

module.exports.skip = async () => true;
