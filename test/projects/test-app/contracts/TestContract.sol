pragma solidity ^0.4.24;

import "@aragon/abis/os/contracts/apps/AragonApp.sol";


contract TestContract is AragonApp {
    uint256 public value;

    bytes32 constant public INCREMENT_ROLE = keccak256("INCREMENT_ROLE");
    bytes32 constant public DECREMENT_ROLE = keccak256("DECREMENT_ROLE");

    function initialize(uint initialCount) public onlyInit {
        value = initialCount;
        initialized();
    }

    function increment(uint256 step) external auth(INCREMENT_ROLE) {
        value = value + step;
    }

    function decrement(uint256 step) external auth(DECREMENT_ROLE) {
        value = value - step;
    }

    function getVersion() public pure returns (string) {
        return "0";
    }
}
