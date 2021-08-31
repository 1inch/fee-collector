const networks = {
};

if (process.env.MAINNET_RPC_URL && process.env.MAINNET_PRIVATE_KEY) {
    networks.mainnet = {
        url: process.env.MAINNET_RPC_URL,
        chainId: 1,
        accounts: [process.env.MAINNET_PRIVATE_KEY],
    };
}

module.exports = networks;
