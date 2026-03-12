const contractAddress = "0xd74C29576B8be4e6eB796103Ac0854299B991270";

const contractABI = [
  "function isValid(uint256 ticketId) view returns (bool)",
  "function verifyAndUse(uint256 ticketId)"
];

let provider, signer, contract;

document.getElementById("connectBtn").onclick = connectWallet;
document.getElementById("verifyBtn").onclick = verifyTicket;

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

async function verifyTicket() {
  if (!contract) { alert("Connect wallet first"); return; }

  const ticketId = document.getElementById("ticketId").value;
  if (ticketId === "") { alert("Enter a ticket ID"); return; }

  const btn = document.getElementById("verifyBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Verifying...';
  hideResult();

  try {
    const valid = await contract.isValid(Number(ticketId));

    if (!valid) {
      showResult("used", "⚠️", "Already Used", "Ticket #" + ticketId + " has already been scanned or does not exist.");
      return;
    }

    btn.innerHTML = '<span class="spinner"></span>Confirming on-chain...';
    const tx = await contract.verifyAndUse(Number(ticketId));
    await tx.wait();

    showResult("valid", "✅", "Admission Granted", "Ticket #" + ticketId + " is valid. Entry approved!");
    document.getElementById("ticketId").value = "";

  } catch (err) {
    showResult("invalid", "❌", "Error", err.reason || err.message || "Verification failed.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = "Verify & Check In";
  }
}

function showResult(type, icon, title, msg) {
  const el = document.getElementById("result");
  el.className = "scan-result result-" + type;
  document.getElementById("resultIcon").textContent = icon;
  document.getElementById("resultTitle").textContent = title;
  document.getElementById("resultMsg").textContent = msg;
  el.style.display = "block";
}

function hideResult() {
  document.getElementById("result").style.display = "none";
}
