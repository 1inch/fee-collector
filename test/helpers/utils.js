const { BN, ether } = require('@openzeppelin/test-helpers');

function price (val) {
    return ether(val).toString();
}

function toBN (num) {
    return new BN(num);
}

function cutLastArg (data, padding = 0) {
    return data.substr(0, data.length - 64 - padding);
}

function cutLastArgUnaligned (data, wrapperDataFactory) {
    return cutLastArg(wrapperDataFactory(data), (64 - (data.length - 2) % 64) % 64);
}

module.exports = {
    price,
    toBN,
    cutLastArg,
    cutLastArgUnaligned,
};
