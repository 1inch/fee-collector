// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "./libraries/UniERC20.sol";
// import "./utils/BalanceAccounting.sol";


contract FeeCollector is Ownable /*, BalanceAccounting*/ {
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

    struct TokenEpochMarket {
        mapping(address => uint256) balances;
        uint256 totalSupply;
        uint256 srcAmount;
        uint256 dstAmount;
    }

    mapping(address => uint256) public balancesOf;
    
    mapping(address => uint256) public tokenEpoch;
    mapping(address => mapping(uint256 => TokenEpochMarket)) public tokenEpochMarket;

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

    function addReward(uint256 _fee, address _token, address _user) public {

        uint256 fee = tokenEpochMarket[_token][tokenEpoch[_token]].totalSupply;
        lastValueToken[_token] = priceForTime(block.timestamp, _token) * (fee + _fee) / (fee == 0 ? 1 : fee);
        
        tokenEpochMarket[_token][tokenEpoch[_token]].totalSupply += _fee;
        tokenEpochMarket[_token][tokenEpoch[_token]].balances[_user] += _fee;
        tokenEpochMarket[_token][tokenEpoch[_token]].srcAmount += _fee;

        // give to user reward from prev epoch
        uint256 amount = 0;
        for (uint256 i = 0; i < tokenEpoch[_token]; i++) {
            if (tokenEpochMarket[_token][i].balances[_user] != 0) {
                amount += tokenEpochMarket[_token][i].balances[_user];
                tokenEpochMarket[_token][i].balances[_user] = 0;
            }
        }
        if (amount != 0) {
            token.transferFrom(address(this), _user, amount);
        }
    }

    function removeReward() public {
        // address user = msg.sender;

        // _removeReward(address(token));
        
        // balancesOf[user] = 0;
    }    

    function _removeReward(address _token) public {
        // address user = msg.sender;

        // require(tokenBalancesOf[user][_token] > 0, 'there are no reward in base token');

        // IERC20(_token).transferFrom(address(this), user, amount);

        // tokenBalancesOf[user][_token] = 0;
    }

    function trade(address _token, uint256 amount) public {
        // if(tokenEpoch[_token] == 0){
        //     require(tokenEpochMarket[0].totalSupply >= amount, 'not enough tokens');
        //     token.transferFrom(msg.sender, address(this), amount);

        //     uint256 tokenAmount = price(_token) / amount;
        //     IERC20(_token).transferFrom(address(this), msg.sender, tokenAmount);

        //     tokenEpochMarket[0].totalSupply -= tokenAmount;
        // }
    }
}




