const { EIP712Domain } = require('./eip712');

const Order = [
    { name: 'salt', type: 'uint256' },
    { name: 'makerAsset', type: 'address' },
    { name: 'takerAsset', type: 'address' },
    { name: 'makerAssetData', type: 'bytes' },
    { name: 'takerAssetData', type: 'bytes' },
    { name: 'getMakerAmount', type: 'bytes' },
    { name: 'getTakerAmount', type: 'bytes' },
    { name: 'predicate', type: 'bytes' },
    { name: 'permit', type: 'bytes' },
    { name: 'interaction', type: 'bytes' },
];

const ABIOrder = {
    'Order' : Order.reduce((obj, item) => {
        obj[item.name] = item.type;
        return obj;
    }, {}),
};

const name = '1inch Limit Order Protocol';
const version = '1';

function buildOrderData (chainId, verifyingContract, order) {
    return {
        primaryType: 'Order',
        types: { EIP712Domain, Order },
        domain: { name, version, chainId, verifyingContract },
        message: order,
    };
}

module.exports = {
    ABIOrder,
    buildOrderData,
    name,
    version,
};
