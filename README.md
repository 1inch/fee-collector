# 1inch Fee Collector


[![Build Status](https://github.com/1inch/fee-collector/workflows/CI/badge.svg)](https://github.com/1inch/fee-collector/actions)
[![Coverage Status](https://coveralls.io/repos/github/1inch/fee-collector/badge.svg?branch=master)](https://coveralls.io/github/1inch/fee-collector?branch=master)


A contract that collects user rewards and exchanges it for 1inch tokens through an auction.<br>
The auction has parameters `maxValue` and `minValue`, which indicate the maximum and minimum values of the number of 1inch tokens that the contract agrees to receive in exchange for the entire number of certain tokens.
