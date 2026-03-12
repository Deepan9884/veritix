const contractAddress = "0xdBde2A4d0f06eF088e6De4dfBcA05a23aEE4adb8";

const contractABI = [
  "function ownerOf(uint256 tokenId) view returns (address)"
];
const EXPECTED_CHAIN_HEX = "0xaa36a7";

function normalizeErrorMessage(err, fallback) {
  const raw = err && (err.reason || err.message || err.data?.message || "");
  const text = String(raw || "").toLowerCase();

  if (text.includes("network") || text.includes("chain")) {
    return "Please switch MetaMask to Sepolia network.";
  }

  if (text.includes("user rejected") || text.includes("denied") || text.includes("4001")) {
    return "MetaMask request was rejected.";
  }

  return raw || fallback;
}

async function ensureSepoliaNetwork() {
  if (!window.ethereum) {
    throw new Error("Install MetaMask");
  }

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: EXPECTED_CHAIN_HEX }]
    });
  } catch (error) {
    if (error && error.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: EXPECTED_CHAIN_HEX,
          chainName: "Sepolia",
          nativeCurrency: { name: "Sepolia Ether", symbol: "SEP", decimals: 18 },
          rpcUrls: ["https://rpc.sepolia.org"],
          blockExplorerUrls: ["https://sepolia.etherscan.io"]
        }]
      });
      return;
    }

    throw error;
  }
}

let provider, signer, contract;

async function connectWallet() {
  if (!window.ethereum) { alert("Install MetaMask"); return; }

  try {
    await ensureSepoliaNetwork();
    await window.ethereum.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }]
    });
  } catch (err) {
    alert(normalizeErrorMessage(err, "Unable to request wallet permissions"));
    return;
  }

  try {
    await window.ethereum.request({ method: "eth_requestAccounts" });
    window.location.href = "user-dashboard.html";
  } catch (err) {
    alert(normalizeErrorMessage(err, "Unable to connect wallet"));
  }
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
