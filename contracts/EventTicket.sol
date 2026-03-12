// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract EventTicket is ERC721, Ownable {

    uint256 public nextTicketId;

    struct Ticket {
        uint256 id;
        bool used;
    }

    mapping(uint256 => Ticket) public tickets;

    constructor() ERC721("EventTicket", "ETKT") {}

    function mintTicket(address to) public onlyOwner {

        uint256 ticketId = nextTicketId;

        _safeMint(to, ticketId);

        tickets[ticketId] = Ticket(ticketId,false);

        nextTicketId++;
    }

    function verifyAndUse(uint256 ticketId) public {

        require(_exists(ticketId), "Ticket does not exist");

        require(!tickets[ticketId].used, "Ticket already used");

        tickets[ticketId].used = true;
    }

    function isValid(uint256 ticketId) public view returns(bool){

        if(!_exists(ticketId)){
            return false;
        }

        return !tickets[ticketId].used;
    }

}