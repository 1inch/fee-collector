// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@1inch/solidity-utils/contracts/mocks/TokenMock.sol";
import "../interfaces/IFeeCollector.sol";


contract TokenWithUpdateRewardMock is TokenMock {
    // solhint-disable-next-line no-empty-blocks
    constructor(string memory name, string memory symbol) TokenMock(name, symbol) {}

    function updateReward(IFeeCollector _feeCollector, address referral, uint256 amount) public {
        transfer(address(_feeCollector), amount);
        _feeCollector.updateReward(referral, amount);
    }
}
