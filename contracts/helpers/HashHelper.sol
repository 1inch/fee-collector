// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";

contract HashHelper is EIP712("1inch Hashing Helper", "1") {
    bytes32 constant public LIMIT_ORDER_RFQ_TYPEHASH = keccak256(
        "OrderRFQ(uint256 info,address makerAsset,address takerAsset,bytes makerAssetData,bytes takerAssetData)"
    );

    function hashOrder(
        uint256 info,
        address makerAsset,
        address takerAsset,
        bytes memory makerAssetData,
        bytes memory takerAssetData
    ) internal view returns(bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    LIMIT_ORDER_RFQ_TYPEHASH,
                    info,
                    makerAsset,
                    takerAsset,
                    keccak256(makerAssetData),
                    keccak256(takerAssetData)
                )
            )
        );
    }
}
