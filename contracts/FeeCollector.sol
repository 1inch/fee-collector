// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "./helpers/ImmutableOwner.sol";
import "./helpers/HashHelper.sol";
import "./libraries/ArgumentsDecoder.sol";
import "./libraries/UniERC20.sol";
import "./utils/BalanceAccounting.sol";


contract FeeCollector is
    BalanceAccounting,
    HashHelper,
    IERC1271,
    ImmutableOwner {
    using UniERC20 for IERC20;
    using ArgumentsDecoder for bytes;

    uint256 constant private _FROM_INDEX = 0;
    uint256 constant private _TO_INDEX = 1;
    uint256 constant private _AMOUNT_INDEX = 2;
    uint256 constant private FIXED_POINT_MULTIPLIER = 1e36;

    IERC20 public immutable token;
    uint256 private immutable _k00;
    uint256 private immutable _k01;
    uint256 private immutable _k02;
    uint256 private immutable _k03;
    uint256 private immutable _k04;
    uint256 private immutable _k05;
    uint256 private immutable _k06;
    uint256 private immutable _k07;
    uint256 private immutable _k08;
    uint256 private immutable _k09;
    uint256 private immutable _k10;
    uint256 private immutable _k11;
    uint256 private immutable _k12;
    uint256 private immutable _k13;
    uint256 private immutable _k14;
    uint256 private immutable _k15;
    uint256 private immutable _k16;
    uint256 private immutable _k17;
    uint256 private immutable _k18;
    uint256 private immutable _k19;

    struct EpochBalance {
        mapping(address => uint256) balances;
        uint256 totalSupply;
        uint256 tokenBalance;
        uint256 inchBalance;
    }

    struct TokenInfo {
        mapping(uint256 => EpochBalance) epochBalance;
        uint256 firstUnprocessedEpoch;
        uint256 currentEpoch;
        mapping(address => uint256) firstUserUnprocessedEpoch;
        uint256 lastPriceValue;
        uint256 lastTime;
    }

    mapping(IERC20 => TokenInfo) public tokenInfo;

    uint256 public minValue;
    uint256 public lastTokenPriceValueDefault;
    uint256 public lastTokenTimeDefault;

    uint8 public immutable decimals;

    constructor(
        IERC20 _token,
        uint256 _minValue,
        uint256 _deceleration,
        address _limitOrderProtocol
    ) ImmutableOwner(_limitOrderProtocol) {
        require(_deceleration > 0 && _deceleration < FIXED_POINT_MULTIPLIER, "Invalid deceleration");
        token = _token;
        decimals = IERC20Metadata(address(_token)).decimals();

        uint256 z;
        _k00 = z = _deceleration;
        _k01 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k02 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k03 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k04 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k05 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k06 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k07 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k08 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k09 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k10 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k11 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k12 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k13 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k14 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k15 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k16 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k17 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k18 = z = z * z / FIXED_POINT_MULTIPLIER;
        _k19 = z = z * z / FIXED_POINT_MULTIPLIER;
        require(z * z < FIXED_POINT_MULTIPLIER, "Deceleration is too slow");

        minValue = lastTokenPriceValueDefault = _minValue;
        lastTokenTimeDefault = block.timestamp;
    }

    function decelerationTable() public view returns(uint256[20] memory) {
        return [
            _k00, _k01, _k02, _k03, _k04,
            _k05, _k06, _k07, _k08, _k09,
            _k10, _k11, _k12, _k13, _k14,
            _k15, _k16, _k17, _k18, _k19
        ];
    }

    function tokenPriceInInches(IERC20 _token) public view returns(uint256 result) {
        return tokenPriceInInchesForTime(block.timestamp, _token);
    }

    function inchPriceInToken(IERC20 _token) public view returns(uint256 result) {
        return (FIXED_POINT_MULTIPLIER * FIXED_POINT_MULTIPLIER)/tokenPriceInInches(_token);
    }

    function tokenPriceInInchesForTime(uint256 time, IERC20 _token) public view returns(uint256 result) {
        uint256[20] memory table = [
            _k00, _k01, _k02, _k03, _k04,
            _k05, _k06, _k07, _k08, _k09,
            _k10, _k11, _k12, _k13, _k14,
            _k15, _k16, _k17, _k18, _k19
        ];
        uint256 lastTime = (tokenInfo[_token].lastTime == 0 ? lastTokenTimeDefault : tokenInfo[_token].lastTime);
        uint256 secs = time - lastTime;
        result = (tokenInfo[_token].lastPriceValue == 0 ? lastTokenPriceValueDefault : tokenInfo[_token].lastPriceValue);
        for (uint i = 0; secs > 0 && i < table.length; i++) {
            if (secs & 1 != 0) {
                result = result * table[i] / FIXED_POINT_MULTIPLIER;
            }
            if (result < minValue) return minValue;
            secs >>= 1;
        }
    }

    function name() external view returns(string memory) {
        return string(abi.encodePacked("FeeCollector: ", token.uniName()));
    }

    function symbol() external view returns(string memory) {
        return string(abi.encodePacked("fee-", token.uniSymbol()));
    }

    function updateRewards(address[] calldata receivers, uint256[] calldata amounts) external {
        for (uint i = 0; i < receivers.length; i++) {
            _updateReward(IERC20(msg.sender), receivers[i], amounts[i]);
        }
    }

    function updateReward(address referral, uint256 amount) external {
        _updateReward(IERC20(msg.sender), referral, amount);
    }

    function updateRewardNonLP(IERC20 erc20, address referral, uint256 amount) external {
        erc20.transferFrom(msg.sender, address(this), amount);
        _updateReward(erc20, referral, amount);
    }

    function _updateReward(IERC20 erc20, address referral, uint256 amount) private {
        TokenInfo storage _token = tokenInfo[erc20];
        uint256 currentEpoch = _token.currentEpoch;

        uint256 fee = _token.epochBalance[currentEpoch].tokenBalance;
        tokenInfo[erc20].lastPriceValue = tokenPriceInInchesForTime(block.timestamp, erc20) * (fee + amount) / (fee == 0 ? 1 : fee);
        tokenInfo[erc20].lastTime = block.timestamp;

        // Add new reward to current epoch
        _token.epochBalance[currentEpoch].balances[referral] += amount;
        _token.epochBalance[currentEpoch].totalSupply += amount;
        _token.epochBalance[currentEpoch].tokenBalance += amount;

        // Collect all processed epochs and advance user token epoch
        _collectProcessedEpochs(referral, _token, currentEpoch);
    }

    function func_somethingHere(address from, address to, uint256 returnAmount, IERC20 erc20) external onlyImmutableOwner {
        require(to == address(this), "Invalid tokens source");

        TokenInfo storage _token = tokenInfo[erc20];
        uint256 firstUnprocessedEpoch = _token.firstUnprocessedEpoch;
        EpochBalance storage epochBalance = _token.epochBalance[firstUnprocessedEpoch];
        EpochBalance storage currentEpochBalance = _token.epochBalance[_token.currentEpoch];

        uint256 _price = tokenPriceInInches(erc20);
        uint256 amount = returnAmount * _price;

        if (_token.firstUnprocessedEpoch == _token.currentEpoch) {
            _token.currentEpoch = _token.currentEpoch + (1);
        }

        if (returnAmount <= epochBalance.tokenBalance) {
            if (returnAmount == epochBalance.tokenBalance) {
                _token.firstUnprocessedEpoch += 1;
            }

            epochBalance.tokenBalance -= returnAmount;
            epochBalance.inchBalance += amount;
        } else {
            require(firstUnprocessedEpoch + 1 == _token.currentEpoch, "not enough tokens");
            require(epochBalance.tokenBalance + currentEpochBalance.tokenBalance >= returnAmount, "not enough tokens");

            uint256 amountPart = epochBalance.tokenBalance * amount / returnAmount;

            currentEpochBalance.tokenBalance -= (returnAmount - epochBalance.tokenBalance);
            currentEpochBalance.inchBalance += (amount - amountPart);

            epochBalance.tokenBalance = 0;
            epochBalance.inchBalance += amountPart;

            _token.firstUnprocessedEpoch += 1;
            _token.currentEpoch += 1;
        }

        token.transferFrom(msg.sender, address(this), amount);
        erc20.transfer(msg.sender, returnAmount);
    }

    function isValidSignature(bytes32 hash, bytes memory signature) public view override returns(bytes4) {
        //LimitOrderProtocol.Order memory order = abi.decode(signature);
        uint256 info;
        address makerAsset;
        address takerAsset;
        bytes memory makerAssetData;
        bytes memory takerAssetData;
        assembly {  // solhint-disable-line no-inline-assembly
            info := mload(add(signature, 0x40))
            makerAsset := mload(add(signature, 0x60))
            takerAsset := mload(add(signature, 0x80))
            makerAssetData := add(add(signature, 0x40), mload(add(signature, 0xA0)))
            takerAssetData := add(add(signature, 0x40), mload(add(signature, 0xC0)))
        }

        require(
            takerAssetData.decodeAddress(_TO_INDEX) == address(this) &&
            hashOrder(info, makerAsset, takerAsset, makerAssetData, takerAssetData) == hash,
            "FeeCollector: invalid signature"
        );

        return this.isValidSignature.selector;
    }

    function trade(IERC20 erc20, uint256 amount) external {
        TokenInfo storage _token = tokenInfo[erc20];
        uint256 firstUnprocessedEpoch = _token.firstUnprocessedEpoch;
        EpochBalance storage epochBalance = _token.epochBalance[firstUnprocessedEpoch];
        EpochBalance storage currentEpochBalance = _token.epochBalance[_token.currentEpoch];

        uint256 _price = tokenPriceInInches(erc20);
        uint256 returnAmount = amount / _price;

        if (_token.firstUnprocessedEpoch == _token.currentEpoch) {
            _token.currentEpoch += 1;
        }

        if (returnAmount <= epochBalance.tokenBalance) {
            if (returnAmount == epochBalance.tokenBalance) {
                _token.firstUnprocessedEpoch += 1;
            }

            epochBalance.tokenBalance -= returnAmount;
            epochBalance.inchBalance += amount;
        } else {
            require(firstUnprocessedEpoch + 1 == _token.currentEpoch, "not enough tokens");
            require(epochBalance.tokenBalance + currentEpochBalance.tokenBalance >= returnAmount, "not enough tokens");

            uint256 amountPart = epochBalance.tokenBalance * amount / returnAmount;

            currentEpochBalance.tokenBalance -= (returnAmount - epochBalance.tokenBalance);
            currentEpochBalance.inchBalance += (amount - amountPart);

            epochBalance.tokenBalance = 0;
            epochBalance.inchBalance += amountPart;

            _token.firstUnprocessedEpoch += 1;
            _token.currentEpoch += 1;
        }

        token.transferFrom(msg.sender, address(this), amount);
        erc20.transfer(msg.sender, returnAmount);
    }

    function claim(IERC20[] memory pools) external {
        for (uint256 i = 0; i < pools.length; ++i) {
            TokenInfo storage _token = tokenInfo[pools[i]];
            _collectProcessedEpochs(msg.sender, _token, _token.currentEpoch);
        }

        uint256 userBalance = balanceOf(msg.sender);
        if (userBalance > 1) {
            // Avoid erasing storage to decrease gas footprint for referral payments
            unchecked {
                uint256 withdrawn = userBalance - 1;
                _burn(msg.sender, withdrawn);
                token.transfer(msg.sender, withdrawn);
            }
        }
    }

    function claimCurrentEpoch(IERC20 erc20) external {
        TokenInfo storage _token = tokenInfo[erc20];
        uint256 currentEpoch = _token.currentEpoch;
        uint256 userBalance = _token.epochBalance[currentEpoch].balances[msg.sender];
        if (userBalance > 0) {
            _token.epochBalance[currentEpoch].balances[msg.sender] = 0;
            _token.epochBalance[currentEpoch].totalSupply -= userBalance;
            _token.epochBalance[currentEpoch].tokenBalance -= userBalance;
            erc20.transfer(msg.sender, userBalance);
        }
    }

    function claimFrozenEpoch(IERC20 erc20) external {
        TokenInfo storage _token = tokenInfo[erc20];
        uint256 firstUnprocessedEpoch = _token.firstUnprocessedEpoch;
        uint256 currentEpoch = _token.currentEpoch;

        require(firstUnprocessedEpoch + 1 == currentEpoch, "Epoch already finalized");
        require(_token.firstUserUnprocessedEpoch[msg.sender] == firstUnprocessedEpoch, "Epoch funds already claimed");

        _token.firstUserUnprocessedEpoch[msg.sender] = currentEpoch;
        EpochBalance storage epochBalance = _token.epochBalance[firstUnprocessedEpoch];
        uint256 share = epochBalance.balances[msg.sender];

        if (share > 0) {
            uint256 totalSupply = epochBalance.totalSupply;
            epochBalance.balances[msg.sender] = 0;
            epochBalance.totalSupply = totalSupply - share;
            epochBalance.tokenBalance = _transferTokenShare(erc20, epochBalance.tokenBalance, share, totalSupply);
            epochBalance.inchBalance = _transferTokenShare(token, epochBalance.inchBalance, share, totalSupply);
        }
    }

    function _transferTokenShare(IERC20 _token, uint256 balance, uint256 share, uint256 totalSupply) private returns(uint256 newBalance) {
        uint256 amount = balance * share / totalSupply;
        if (amount > 0) {
            _token.uniTransfer(payable(msg.sender), amount);
        }
        return balance - amount;
    }

    function _collectProcessedEpochs(address user, TokenInfo storage _token, uint256 currentEpoch) private {
        uint256 userEpoch = _token.firstUserUnprocessedEpoch[user];

        // Early return for the new users
        if (_token.epochBalance[userEpoch].balances[user] == 0) {
            _token.firstUserUnprocessedEpoch[user] = currentEpoch;
            return;
        }

        uint256 tokenEpoch = _token.firstUnprocessedEpoch;
        if (tokenEpoch <= userEpoch) {
            return;
        }
        uint256 epochCount = Math.min(2, tokenEpoch - userEpoch); // 0, 1 or 2 epochs

        // Claim 1 or 2 processed epochs for the user
        uint256 collected = _collectEpoch(user, _token, userEpoch);
        if (epochCount > 1) {
            collected += _collectEpoch(user, _token, userEpoch + 1);
        }
        _mint(user, collected);

        // Update user token epoch counter
        bool emptySecondEpoch = _token.epochBalance[userEpoch + 1].balances[user] == 0;
        _token.firstUserUnprocessedEpoch[user] = (epochCount == 2 || emptySecondEpoch) ? currentEpoch : userEpoch + 1;
    }

    function _collectEpoch(address user, TokenInfo storage _token, uint256 epoch) private returns(uint256 collected) {
        uint256 share = _token.epochBalance[epoch].balances[user];
        if (share > 0) {
            uint256 inchBalance = _token.epochBalance[epoch].inchBalance;
            uint256 totalSupply = _token.epochBalance[epoch].totalSupply;

            collected = inchBalance * share / totalSupply;

            _token.epochBalance[epoch].balances[user] = 0;
            _token.epochBalance[epoch].totalSupply = totalSupply - share;
            _token.epochBalance[epoch].inchBalance = inchBalance - collected;
        }
    }

    function getUserEpochBalance(address user, IERC20 _token, uint256 epoch) external view returns(uint256) {
        return tokenInfo[_token].epochBalance[epoch].balances[user];
    }

    function getTotalSupplyEpochBalance(IERC20 _token, uint256 epoch) external view returns(uint256) {
        return tokenInfo[_token].epochBalance[epoch].totalSupply;
    }

    function getTokenBalanceEpochBalance(IERC20 _token, uint256 epoch) external view returns(uint256) {
        return tokenInfo[_token].epochBalance[epoch].tokenBalance;
    }

    function getInchBalanceEpochBalance(IERC20 _token, uint256 epoch) external view returns(uint256) {
        return tokenInfo[_token].epochBalance[epoch].inchBalance;
    }

    function getFirstUserUnprocessedEpoch(address user, IERC20 _token) external view returns(uint256) {
        return tokenInfo[_token].firstUserUnprocessedEpoch[user];
    }
}
