// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/// @title 1inch Limit Order Protocol v1
contract LimitOrderProtocolMock
{
    function getMakerAmount(uint256 orderMakerAmount, uint256 orderTakerAmount, uint256 swapTakerAmount) external pure returns(uint256) {
        revert("Mock");
    }

    function getTakerAmount(uint256 orderMakerAmount, uint256 orderTakerAmount, uint256 swapMakerAmount) external pure returns(uint256) {
        revert("Mock");
    }

    function arbitraryStaticCall(address target, bytes memory data) external view returns(uint256) {
        revert("Mock");
    }
}
