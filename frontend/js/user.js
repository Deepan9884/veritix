const contractAddress = "0xd74C29576B8be4e6eB796103Ac0854299B991270";

const contractABI = [
  "function ownerOf(uint256 tokenId) view returns (address)"
];

let provider, signer, contract;

async function connectWallet() {
  if (!window.ethereum) { alert("Install MetaMask"); return; }

  await window.ethereum.request({ method: "eth_requestAccounts" });

  provider = new ethers.providers.Web3Provider(window.ethereum);
  signer = provider.getSigner();
  contract = new ethers.Contract(contractAddress, contractABI, signer);

  const address = await signer.getAddress();
  document.getElementById("wallet").textContent = address;

  const btn = document.getElementById("connectBtn");
  btn.textContent = "Connected";
  btn.disabled = true;

  document.getElementById("connectPrompt").style.display = "none";

  await checkTickets(address);
}

async function checkTickets(address) {
  let found = false;

  for (let i = 0; i < 100; i++) {
    try {
      const owner = await contract.ownerOf(i);
      if (owner.toLowerCase() === address.toLowerCase()) {
        document.getElementById("ticket").textContent = "Ticket ID: #" + i;
        new QRCode(document.getElementById("qrcode"), {
          text: "ticket-" + i,
          width: 200,
          height: 200
        });
        document.getElementById("ticketWrapper").style.display = "flex";
        found = true;
        break;
      }
    } catch (err) {}
  }

  if (!found) {
    document.getElementById("noTicket").style.display = "block";
  }
}
