const contractAddress = "0xd74C29576B8be4e6eB796103Ac0854299B991270";

const contractABI = [
  "function mintTicket(address to)"
];

let provider, signer, contract;

document.getElementById("connectBtn").onclick = connectWallet;
document.getElementById("mintBtn").onclick = mintTicket;

async function connectWallet() {
  if (!window.ethereum) { alert("Install MetaMask"); return; }

  await window.ethereum.request({ method: "eth_requestAccounts" });

  provider = new ethers.providers.Web3Provider(window.ethereum);
  signer = provider.getSigner();
  contract = new ethers.Contract(contractAddress, contractABI, signer);

  const address = await signer.getAddress();
  const btn = document.getElementById("connectBtn");
  btn.textContent = "Connected";
  btn.disabled = true;

  const wd = document.getElementById("walletDisplay");
  if (wd) wd.textContent = address;
}

async function mintTicket() {
  if (!contract) { alert("Connect wallet first"); return; }

  const address = document.getElementById("walletAddress").value.trim();
  if (!address) { alert("Enter wallet address"); return; }

  const btn = document.getElementById("mintBtn");
  const statusEl = document.getElementById("status");

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Minting...';
  setStatus(statusEl, "pending", "⏳ Transaction pending...");

  try {
    const tx = await contract.mintTicket(address);
    setStatus(statusEl, "pending", "⏳ Waiting for confirmation...");
    await tx.wait();
    setStatus(statusEl, "success", "✅ Ticket minted successfully!");
    document.getElementById("walletAddress").value = "";
  } catch (err) {
    setStatus(statusEl, "error", "❌ " + (err.reason || err.message || "Transaction failed"));
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Mint Ticket";
  }
}

function setStatus(el, type, msg) {
  el.className = "status-message status-" + type;
  el.textContent = msg;
}
