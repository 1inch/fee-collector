// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./libraries/UniERC20.sol";
import "./utils/BalanceAccounting.sol";


contract FeeCollector is Ownable, BalanceAccounting {
    using SafeMath for uint256;
    using UniERC20 for IERC20;

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
        uint256 inchBalance;
    }

    struct TokenInfo {
        mapping(uint256 => EpochBalance) epochBalance;
        uint256 firstUnprocessedEpoch;
        uint256 currentEpoch;
        mapping(address => uint256) firstUserUnprocessedEpoch;
    }

    mapping(IERC20 => TokenInfo) public tokenInfo;
    mapping(address => uint256) public balance;

    uint256 public minValue;
    uint256 public lastValueDefault;
    uint256 public lastTimeDefault;
    mapping(address => uint256) public lastValueToken;
    mapping(address => uint256) public lastTimeToken;
    mapping(address => uint256) public feeToken;
    
    constructor(
        IERC20 _token,
        uint256 _minValue,
        uint256 _deceleration
    ) {
        require(_deceleration > 0 && _deceleration < 1e36, "Invalid deceleration");
        token = _token;

        uint256 z;
        uint256[20] memory tmp_k;
        _k00 = tmp_k[0] = z = _deceleration;
        _k01 = tmp_k[1] = z = z * z / 1e36;
        _k02 = tmp_k[2] = z = z * z / 1e36;
        _k03 = tmp_k[3] = z = z * z / 1e36;
        _k04 = tmp_k[4] = z = z * z / 1e36;
        _k05 = tmp_k[5] = z = z * z / 1e36;
        _k06 = tmp_k[6] = z = z * z / 1e36;
        _k07 = tmp_k[7] = z = z * z / 1e36;
        _k08 = tmp_k[8] = z = z * z / 1e36;
        _k09 = tmp_k[9] = z = z * z / 1e36;
        _k10 = tmp_k[10] = z = z * z / 1e36;
        _k11 = tmp_k[11] = z = z * z / 1e36;
        _k12 = tmp_k[12] = z = z * z / 1e36;
        _k13 = tmp_k[13] = z = z * z / 1e36;
        _k14 = tmp_k[14] = z = z * z / 1e36;
        _k15 = tmp_k[15] = z = z * z / 1e36;
        _k16 = tmp_k[16] = z = z * z / 1e36;
        _k17 = tmp_k[17] = z = z * z / 1e36;
        _k18 = tmp_k[18] = z = z * z / 1e36;
        _k19 = tmp_k[19] = z = z * z / 1e36;
        require(z * z < 1e36, "Deceleration is too slow");

        minValue = lastValueDefault = _minValue;
        lastTimeDefault = block.timestamp;
    }

    function decelerationTable() public view returns(uint256[20] memory) {
        return [
            _k00, _k01, _k02, _k03, _k04,
            _k05, _k06, _k07, _k08, _k09,
            _k10, _k11, _k12, _k13, _k14,
            _k15, _k16, _k17, _k18, _k19
        ];
    }

    function price(address _token) public view returns(uint256 result) {
        return priceForTime(block.timestamp, _token);
    }

    function priceForTime(uint256 time, address _token) public view returns(uint256 result) {
        uint256[20] memory table = [
            _k00, _k01, _k02, _k03, _k04,
            _k05, _k06, _k07, _k08, _k09,
            _k10, _k11, _k12, _k13, _k14,
            _k15, _k16, _k17, _k18, _k19
        ];
        uint256 lastTime = (lastTimeToken[_token] == 0 ? lastTimeDefault : lastTimeToken[_token]);
        uint256 secs = time - lastTime;
        result = (lastValueToken[_token] == 0 ? lastValueDefault : lastValueToken[_token]);
        for (uint i = 0; secs > 0 && i < table.length; i++) {
            if (secs & 1 != 0) { 
                result = result * table[i] / 1e36;
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

    function decimals() external view returns(uint8) {
        return uint8(token.uniDecimals());
    }

    function updateRewards(address[] calldata receivers, uint256[] calldata amounts) external {
        for (uint i = 0; i < receivers.length; i++) {
            updateReward(receivers[i], amounts[i]);
        }
    }

    function updateReward(address referral, uint256 amount) public {
        IERC20 erc20 = IERC20(msg.sender);
        TokenInfo storage _token = tokenInfo[erc20];
        uint256 currentEpoch = _token.currentEpoch;

        uint256 fee = _token.epochBalance[currentEpoch].totalSupply;
        lastValueToken[msg.sender] = priceForTime(block.timestamp, msg.sender) * (fee + amount) / (fee == 0 ? 1 : fee);

        // Add new reward to current epoch
        _token.epochBalance[currentEpoch].balances[referral] = _token.epochBalance[currentEpoch].balances[referral].add(amount);
        _token.epochBalance[currentEpoch].totalSupply = _token.epochBalance[currentEpoch].totalSupply.add(amount);

        // Collect all processed epochs and advance user token epoch
        _collectProcessedEpochs(referral, _token, currentEpoch);
    }

    // function freezeEpoch(Mooniswap mooniswap) external nonReentrant validPool(mooniswap) validSpread(mooniswap) {
    //     TokenInfo storage token = tokenInfo[mooniswap];
    //     uint256 currentEpoch = token.currentEpoch;
    //     require(token.firstUnprocessedEpoch == currentEpoch, "Previous epoch is not finalized");

    //     IERC20[] memory tokens = mooniswap.getTokens();
    //     uint256 token0Balance = tokens[0].uniBalanceOf(address(this));
    //     uint256 token1Balance = tokens[1].uniBalanceOf(address(this));
    //     mooniswap.withdraw(mooniswap.balanceOf(address(this)), new uint256[](0));
    //     token.epochBalance[currentEpoch].token0Balance = tokens[0].uniBalanceOf(address(this)).sub(token0Balance);
    //     token.epochBalance[currentEpoch].token1Balance = tokens[1].uniBalanceOf(address(this)).sub(token1Balance);
    //     token.currentEpoch = currentEpoch.add(1);
    // }

    // function trade(Mooniswap mooniswap, IERC20[] memory path) external nonReentrant validPool(mooniswap) validPath(path) {
    //     TokenInfo storage token = tokenInfo[mooniswap];
    //     uint256 firstUnprocessedEpoch = token.firstUnprocessedEpoch;
    //     EpochBalance storage epochBalance = token.epochBalance[firstUnprocessedEpoch];
    //     require(firstUnprocessedEpoch.add(1) == token.currentEpoch, "Prev epoch already finalized");

    //     IERC20[] memory tokens = mooniswap.getTokens();
    //     uint256 availableBalance;
    //     if (path[0] == tokens[0]) {
    //         availableBalance = epochBalance.token0Balance;
    //     } else if (path[0] == tokens[1]) {
    //         availableBalance = epochBalance.token1Balance;
    //     } else {
    //         revert("Invalid first token");
    //     }

    //     (uint256 amount, uint256 returnAmount) = _maxAmountForSwap(path, availableBalance);
    //     if (returnAmount == 0) {
    //         // get rid of dust
    //         if (availableBalance > 0) {
    //             require(availableBalance == amount, "availableBalance is not dust");
    //             for (uint256 i = 0; i + 1 < path.length; i += 1) {
    //                 Mooniswap _mooniswap = mooniswapFactory.pools(path[i], path[i+1]);
    //                 require(_validateSpread(_mooniswap), "Spread is too high");
    //             }
    //             if (path[0].isETH()) {
    //                 tx.origin.transfer(availableBalance);  // solhint-disable-line avoid-tx-origin
    //             } else {
    //                 path[0].safeTransfer(address(mooniswap), availableBalance);
    //             }
    //         }
    //     } else {
    //         uint256 receivedAmount = _swap(path, amount, payable(address(this)));
    //         epochBalance.inchBalance = epochBalance.inchBalance.add(receivedAmount);
    //     }

    //     if (path[0] == tokens[0]) {
    //         epochBalance.token0Balance = epochBalance.token0Balance.sub(amount);
    //     } else {
    //         epochBalance.token1Balance = epochBalance.token1Balance.sub(amount);
    //     }

    //     if (epochBalance.token0Balance == 0 && epochBalance.token1Balance == 0) {
    //         token.firstUnprocessedEpoch = firstUnprocessedEpoch.add(1);
    //     }
    // }

    // function claim(Mooniswap[] memory pools) external {
    //     UserInfo storage user = userInfo[msg.sender];
    //     for (uint256 i = 0; i < pools.length; ++i) {
    //         Mooniswap mooniswap = pools[i];
    //         TokenInfo storage token = tokenInfo[mooniswap];
    //         _collectProcessedEpochs(user, token, mooniswap, token.currentEpoch);
    //     }

    //     uint256 balance = user.balance;
    //     if (balance > 1) {
    //         // Avoid erasing storage to decrease gas footprint for referral payments
    //         user.balance = 1;
    //         inchToken.transfer(msg.sender, balance - 1);
    //     }
    // }

    // function claimCurrentEpoch(Mooniswap mooniswap) external nonReentrant validPool(mooniswap) {
    //     TokenInfo storage token = tokenInfo[mooniswap];
    //     UserInfo storage user = userInfo[msg.sender];
    //     uint256 currentEpoch = token.currentEpoch;
    //     uint256 balance = user.share[mooniswap][currentEpoch];
    //     if (balance > 0) {
    //         user.share[mooniswap][currentEpoch] = 0;
    //         token.epochBalance[currentEpoch].totalSupply = token.epochBalance[currentEpoch].totalSupply.sub(balance);
    //         mooniswap.transfer(msg.sender, balance);
    //     }
    // }

    // function claimFrozenEpoch(Mooniswap mooniswap) external nonReentrant validPool(mooniswap) {
    //     TokenInfo storage token = tokenInfo[mooniswap];
    //     UserInfo storage user = userInfo[msg.sender];
    //     uint256 firstUnprocessedEpoch = token.firstUnprocessedEpoch;
    //     uint256 currentEpoch = token.currentEpoch;

    //     require(firstUnprocessedEpoch.add(1) == currentEpoch, "Epoch already finalized");
    //     require(user.firstUnprocessedEpoch[mooniswap] == firstUnprocessedEpoch, "Epoch funds already claimed");

    //     user.firstUnprocessedEpoch[mooniswap] = currentEpoch;
    //     uint256 share = user.share[mooniswap][firstUnprocessedEpoch];

    //     if (share > 0) {
    //         EpochBalance storage epochBalance = token.epochBalance[firstUnprocessedEpoch];
    //         uint256 totalSupply = epochBalance.totalSupply;
    //         user.share[mooniswap][firstUnprocessedEpoch] = 0;
    //         epochBalance.totalSupply = totalSupply.sub(share);

    //         IERC20[] memory tokens = mooniswap.getTokens();
    //         epochBalance.token0Balance = _transferTokenShare(tokens[0], epochBalance.token0Balance, share, totalSupply);
    //         epochBalance.token1Balance = _transferTokenShare(tokens[1], epochBalance.token1Balance, share, totalSupply);
    //         epochBalance.inchBalance = _transferTokenShare(inchToken, epochBalance.inchBalance, share, totalSupply);
    //     }
    // }

    // function _transferTokenShare(IERC20 token, uint256 balance, uint256 share, uint256 totalSupply) private returns(uint256 newBalance) {
    //     uint256 amount = balance.mul(share).div(totalSupply);
    //     if (amount > 0) {
    //         token.uniTransfer(msg.sender, amount);
    //     }
    //     return balance.sub(amount);
    // }

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
            collected = collected.add(_collectEpoch(user, _token, userEpoch + 1));
        }
        balance[user] = balance[user].add(collected);

        // Update user token epoch counter
        bool emptySecondEpoch = _token.epochBalance[userEpoch + 1].balances[user] == 0;
        _token.firstUserUnprocessedEpoch[user] = (epochCount == 2 || emptySecondEpoch) ? currentEpoch : userEpoch + 1;
    }

    function _collectEpoch(address user, TokenInfo storage _token, uint256 epoch) private returns(uint256 collected) {
        uint256 share = _token.epochBalance[epoch].balances[user];
        if (share > 0) {
            uint256 inchBalance = _token.epochBalance[epoch].inchBalance;
            uint256 totalSupply = _token.epochBalance[epoch].totalSupply;

            collected = inchBalance.mul(share).div(totalSupply);

            _token.epochBalance[epoch].balances[user] = 0;
            _token.epochBalance[epoch].totalSupply = totalSupply.sub(share);
            _token.epochBalance[epoch].inchBalance = inchBalance.sub(collected);
        }
    }

    function getUserEpochBalance(address user, IERC20 _token, uint256 epoch) external view returns(uint256) {
        return tokenInfo[_token].epochBalance[epoch].balances[user];
    }

    function getTotalSupplyEpochBalance(IERC20 _token, uint256 epoch) external view returns(uint256) {
        return tokenInfo[_token].epochBalance[epoch].totalSupply;
    }

    function getInchBalanceEpochBalance(IERC20 _token, uint256 epoch) external view returns(uint256) {
        return tokenInfo[_token].epochBalance[epoch].inchBalance;
    }

    function getFirstUserUnprocessedEpoch(address user, IERC20 _token) external view returns(uint256) {
        return tokenInfo[_token].firstUserUnprocessedEpoch[user];
    } 
}




