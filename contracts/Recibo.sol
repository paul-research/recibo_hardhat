/**
* Copyright 2025 Circle Internet Group, Inc. All rights reserved.
*
* SPDX-License-Identifier: Apache-2.0
*
* Licensed under the Apache License, Version 2.0 (the "License");
* you may not use this file except in compliance with the License.
* You may obtain a copy of the License at
*
*     http://www.apache.org/licenses/LICENSE-2.0
*
* Unless required by applicable law or agreed to in writing, software
* distributed under the License is distributed on an "AS IS" BASIS,
* WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
* See the License for the specific language governing permissions and
* limitations under the License.
*/

pragma solidity ^0.8.24;

import {GaslessToken} from "./mock/GaslessToken.sol";
import {ReciboEvents} from "./ReciboEvents.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
* @title Recibo
* @notice Lets callers record messages related to ERC-20 transfers
*/
contract Recibo is ReciboEvents {
    GaslessToken public immutable _token;
    address public trustedForwarder;
    address public owner;

    struct ReciboInfo {
        address messageFrom;
        address messageTo;
        string metadata;
        bytes message;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Recibo: caller is not the owner");
        _;
    }

    /**
     * @notice Deploys Recibo
     * @dev Constructor sets target GaslessToken
     * @param token         Any GaslessToken
     * @param forwarder     Trusted forwarder address
     */
    constructor(GaslessToken token, address forwarder) {
        _token = token;
        trustedForwarder = forwarder;
        owner = msg.sender;
    }

    /**
     * @notice Sets the trusted forwarder address
     * @param forwarder     New trusted forwarder address
     */
    function setTrustedForwarder(address forwarder) external onlyOwner {
        trustedForwarder = forwarder;
    }

    /**
     * @notice Checks if the sender is authorized to send messages on behalf of messageFrom
     */
    function _requireAuthorizedSender(address messageFrom) internal view {
        if (msg.sender != trustedForwarder) {
            require(msg.sender == messageFrom, "Recibo: sender not authorized");
        }
    }

    /**
     * @notice Emits a message
     * @param info         Message
     */
    function sendMsg(
        ReciboInfo calldata info
    ) public {
        _requireAuthorizedSender(info.messageFrom);
        emit SentMsg(msg.sender, info.messageFrom, info.messageTo);
    }

    /**
     * @notice Transfers tokens from msg.sender to receiver
     * @dev Returns true on success, reverts on failure
     * @param to           Token receiver
     * @param value        Value to transfer
     * @param info         Message
     */
    function transferFromWithMsg(
        address to,
        uint256 value,
        ReciboInfo calldata info
    ) public returns (bool) {
        _requireAuthorizedSender(info.messageFrom);
        emit TransferWithMsg(msg.sender, to, info.messageFrom, info.messageTo, value);
        return _token.transferFrom(msg.sender, to, value);
    }


    /**
     * @notice Approve spender allowance
     * @dev Token must support https://eips.ethereum.org/EIPS/eip-2612. The spender may not be this contract.
     * @param tokenOwner   Account holder who signed permit
     * @param spender      Give allowance to this address
     * @param value        Allowance amount
     * @param deadline     Approval is valid until this block.timestamp
     * @param v            ECDSA signature
     * @param r            ECDSA signature
     * @param s            ECDSA signature
     * @param info         Message
     */
    function permitWithMsg(
        address tokenOwner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        ReciboInfo calldata info
    ) public {
        require(tokenOwner != address(this));
        _requireAuthorizedSender(info.messageFrom);
        // Also enforce that messageFrom matches the token owner for consistency
        require(info.messageFrom == tokenOwner, "Recibo: message sender mismatch");
        
        emit ApproveWithMsg(tokenOwner, spender, info.messageFrom, info.messageTo, value);
        _token.permit(tokenOwner, spender, value, deadline, v, r, s);
    }


    /**
     * @notice Transfers tokens from msg.sender to receiver
     * @dev Token must support https://eips.ethereum.org/EIPS/eip-2612. The token owner must be msg.sender, who
     *      signs the permit authorizing the spender.
     * @param to            Token receiver
     * @param value         Value to transfer
     * @param deadline      Permit is valid until this block.timestamp
     * @param v             ECDSA signature
     * @param r             ECDSA signature
     * @param s             ECDSA signature
     * @param info          Message
     */
    function permitAndTransferFromWithMsg(
        address to,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        ReciboInfo calldata info
    ) public returns (bool) {
        _requireAuthorizedSender(info.messageFrom);
        // If relayed, msg.sender is the forwarder. If direct, msg.sender is the user.
        // Note: standard ERC20 permit requires the owner to sign. 
        // Here msg.sender (Relayer or User) calls permit on behalf of 'msg.sender'? 
        // Wait, if Relayer calls this, msg.sender is Relayer. Relayer cannot permit for User.
        // This function assumes msg.sender IS the user (signer). 
        // If using TrustedForwarder, we should use info.messageFrom as the 'effective' sender.
        
        address effectiveSender = (msg.sender == trustedForwarder) ? info.messageFrom : msg.sender;
        
        emit TransferWithMsg(effectiveSender, to, info.messageFrom, info.messageTo, value);
        _token.permit(effectiveSender, address(this), value, deadline, v, r, s);
        return _token.transferFrom(effectiveSender, to, value);
    }

    /**
     * @notice Transfers tokens
     * @dev Token must support https://eips.ethereum.org/EIPS/eip-3009.
     * @param from          Token owner
     * @param to            Token receiver
     * @param value         Value to transfer
     * @param validAfter    Authorization is valid after this block.timestamp
     * @param validBefore   Authorization is valid before this block.timestamp
     * @param nonce         Nonce
     * @param signature     EOA wallet signatures should be packed in the order of r, s, v.
     * @param info          Message
     */
    function transferWithAuthorizationWithMsg(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes memory signature,
        ReciboInfo calldata info
    ) public {
        // Bind the message to the token authorization nonce - keeping original Python intent
        bytes32 expectedNonce = keccak256(abi.encode(info.messageFrom, info.messageTo, info.message));
        require(nonce == expectedNonce, "Recibo: nonce must be message hash");
        
        require(info.messageFrom == from, "Recibo: message sender mismatch");

        emit TransferWithMsg(from, to, info.messageFrom, info.messageTo, value);
        _token.transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, signature);
    }

}
