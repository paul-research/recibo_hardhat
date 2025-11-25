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
contract Recibo is ReciboEvents, EIP712 {
    GaslessToken public immutable _token;
    
    bytes32 private constant MESSAGE_TYPEHASH = keccak256("ReciboInfo(address messageFrom,address messageTo,string metadata,bytes message,bytes32 nonce)");
    mapping(address => mapping(bytes32 => bool)) private _authorizationStates;

    struct ReciboInfo {
        address messageFrom;
        address messageTo;
        string metadata;
        bytes message;
        bytes32 nonce;
        bytes signature;
    }

    /**
     * @notice Deploys Recibo
     * @dev Constructor sets target GaslessToken
     * @param token         Any GaslessToken
     */
    constructor(GaslessToken token) EIP712("Recibo", "1") {
        _token = token;
    }

    /**
     * @notice Returns the state of an authorization
     * @param authorizer    Authorizer's address
     * @param nonce         Nonce of the authorization
     * @return True if the nonce is used
     */
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authorizationStates[authorizer][nonce];
    }

    function _verifySignature(ReciboInfo calldata info) internal {
        require(!_authorizationStates[info.messageFrom][info.nonce], "Recibo: authorization is used or canceled");

        bytes32 structHash = keccak256(abi.encode(
            MESSAGE_TYPEHASH,
            info.messageFrom,
            info.messageTo,
            keccak256(bytes(info.metadata)),
            keccak256(info.message),
            info.nonce
        ));
        bytes32 hash = _hashTypedDataV4(structHash);
        require(
            SignatureChecker.isValidSignatureNow(info.messageFrom, hash, info.signature),
            "Recibo: invalid signature"
        );
        
        _authorizationStates[info.messageFrom][info.nonce] = true;
    }

    /**
     * @notice Emits a message
     * @param info         Message
     */
    function sendMsg(
        ReciboInfo calldata info
    ) public {
        // Only require Recibo signature if msg.sender is not the messageFrom.
        // This prevents spoofing when using a relayer.
        if (info.messageFrom != msg.sender) {
            _verifySignature(info);
        }
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
        // Direct calls are authenticated by msg.sender
        require(info.messageFrom == msg.sender, "Recibo: message sender mismatch");
        emit TransferWithMsg(msg.sender, to, info.messageFrom, info.messageTo, value);
        return _token.transferFrom(msg.sender, to, value);
    }


    /**
     * @notice Approve spender allowance
     * @dev Token must support https://eips.ethereum.org/EIPS/eip-2612. The spender may not be this contract.
     * @param owner        Account holder who signed permit
     * @param spender      Give allowance to this address
     * @param value        Allowance amount
     * @param deadline     Approval is valid until this block.timestamp
     * @param v            ECDSA signature
     * @param r            ECDSA signature
     * @param s            ECDSA signature
     * @param info         Message
     */
    function permitWithMsg(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        ReciboInfo calldata info
    ) public {
        require(owner != address(this));
        require(info.messageFrom == owner, "Recibo: message sender mismatch");
        emit ApproveWithMsg(owner, spender, info.messageFrom, info.messageTo, value);
        _token.permit(owner, spender, value, deadline, v, r, s);
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
        require(info.messageFrom == msg.sender, "Recibo: message sender mismatch");
        emit TransferWithMsg(msg.sender, to, info.messageFrom, info.messageTo, value);
        _token.permit(msg.sender, address(this), value, deadline, v, r, s);
        return _token.transferFrom(msg.sender, to, value);
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
        // Bind the message to the token authorization nonce
        bytes32 expectedNonce = keccak256(abi.encode(info.messageFrom, info.messageTo, info.message));
        require(nonce == expectedNonce, "Recibo: nonce must be message hash");
        
        require(info.messageFrom == from, "Recibo: message sender mismatch");

        emit TransferWithMsg(from, to, info.messageFrom, info.messageTo, value);
        _token.transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, signature);
    }

}
