// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;


library Types {
    struct Order {
        uint256 salt;
        address makerAsset;
        address takerAsset;
        bytes makerAssetData;
        bytes takerAssetData;
        bytes getMakerAmount;
        bytes getTakerAmount;
        bytes predicate;
        bytes permit;
        bytes interaction;
    }
}
