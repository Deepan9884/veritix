const contractAddress = "0xd74C29576B8be4e6eB796103Ac0854299B991270";

const contractABI = [
"function mintTicket(address to)"
];

let provider;
let signer;
let contract;

document.getElementById("connectBtn").onclick = connectWallet;
document.getElementById("mintBtn").onclick = mintTicket;

async function connectWallet(){

if(!window.ethereum){
alert("Install MetaMask");
return;
}

await window.ethereum.request({
method:"eth_requestAccounts"
});

provider = new ethers.providers.Web3Provider(window.ethereum);

signer = provider.getSigner();

contract = new ethers.Contract(
contractAddress,
contractABI,
signer
);

document.getElementById("status").innerText="Wallet Connected";
}

async function mintTicket(){

if(!contract){
alert("Connect wallet first");
return;
}

const address=document.getElementById("walletAddress").value;

if(!address){
alert("Enter wallet address");
return;
}

const tx=await contract.mintTicket(address);

document.getElementById("status").innerText="Minting Ticket...";

await tx.wait();

document.getElementById("status").innerText="Ticket Minted!";
}
