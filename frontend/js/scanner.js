const contractAddress = "0xdBde2A4d0f06eF088e6De4dfBcA05a23aEE4adb8";

const contractABI = [
  "function isValid(uint256 ticketId) view returns (bool)",
  "function verifyAndUse(uint256 ticketId)"
];
const EXPECTED_CHAIN_ID = 11155111;
const EXPECTED_CHAIN_HEX = "0xaa36a7";

let provider, signer, contract;
let qrScannerInstance = null;
let scannerRunning = false;
let scannedPayload = null;

function normalizeErrorMessage(err, fallback) {
  const raw = err && (err.reason || err.message || err.data?.message || "");
  const text = String(raw || "").toLowerCase();

  if (text.includes("call_exception") || text.includes("function selector") || text.includes("missing revert data")) {
    return "Connected contract is not compatible on this network. Switch to Sepolia and use the latest deployed contract address.";
  }

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

async function validateContractConnection(providerInstance) {
  const network = await providerInstance.getNetwork();
  if (Number(network.chainId) !== EXPECTED_CHAIN_ID) {
    throw new Error("Please switch MetaMask to Sepolia network");
  }

  const code = await providerInstance.getCode(contractAddress);
  if (!code || code === "0x") {
    throw new Error("No EventTicket contract found at configured address on Sepolia");
  }

  const healthContract = new ethers.Contract(
    contractAddress,
    ["function isValid(uint256 ticketId) view returns (bool)"],
    providerInstance
  );
  await healthContract.isValid(0);
}

document.getElementById("connectBtn").onclick = connectWallet;
document.getElementById("verifyBtn").onclick = verifyTicket;
document.getElementById("startScanBtn").onclick = startQrScan;
document.getElementById("stopScanBtn").onclick = stopQrScan;
document.getElementById("ticketId").addEventListener("input", onTicketIdInput);

window.addEventListener("beforeunload", () => {
  stopQrScan();
});

async function connectWallet() {
  if (!window.ethereum) { alert("Install MetaMask"); return; }

  try {
    await ensureSepoliaNetwork();
    await window.ethereum.request({ method: "eth_requestAccounts" });

    provider = new ethers.providers.Web3Provider(window.ethereum);
    await validateContractConnection(provider);
    signer = provider.getSigner();
    contract = new ethers.Contract(contractAddress, contractABI, signer);

    const address = await signer.getAddress();
    const btn = document.getElementById("connectBtn");
    btn.textContent = "Connected";
    btn.disabled = true;

    const wd = document.getElementById("walletDisplay");
    if (wd) wd.textContent = address;
  } catch (err) {
    alert(normalizeErrorMessage(err, "Unable to connect wallet"));
  }
}

function onTicketIdInput() {
  const ticketId = document.getElementById("ticketId").value;
  if (!scannedPayload || String(scannedPayload.tokenId) === String(ticketId)) {
    return;
  }

  scannedPayload = null;
  hidePurchaserDetails();
}

function parseScannedPayload(rawText) {
  try {
    const payload = JSON.parse(rawText);
    if (!payload || payload.type !== "veritix-ticket") {
      return null;
    }

    if (payload.tokenId === undefined || payload.tokenId === null) {
      return null;
    }

    return payload;
  } catch (err) {
    return null;
  }
}

function renderPurchaserDetails(payload) {
  const purchaser = document.getElementById("purchaserDetails");
  purchaser.className = "scan-result result-info";

  const name = payload.purchaserName || "Ticket Holder";
  const wallet = payload.purchaserWallet || "Unknown wallet";
  const eventName = payload.eventName || "Event";
  const eventDate = payload.eventDate || "Date TBD";
  const venue = payload.venue || "Venue TBD";

  document.getElementById("purchaserTitle").textContent = "Purchaser Details";
  document.getElementById("purchaserMsg").textContent = `${name} • ${wallet} • ${eventName} • ${eventDate} • ${venue}`;
  purchaser.style.display = "block";
}

function hidePurchaserDetails() {
  const purchaser = document.getElementById("purchaserDetails");
  purchaser.style.display = "none";
}

async function handleScannedText(decodedText) {
  const payload = parseScannedPayload(decodedText);

  if (payload) {
    scannedPayload = payload;
    document.getElementById("ticketId").value = Number(payload.tokenId);
    renderPurchaserDetails(payload);
    showResult("info", "📷", "QR Scanned", `Ticket #${payload.tokenId} loaded from QR.`);
    return;
  }

  if (/^\d+$/.test(decodedText.trim())) {
    scannedPayload = null;
    hidePurchaserDetails();
    document.getElementById("ticketId").value = Number(decodedText.trim());
    showResult("info", "📷", "QR Scanned", `Ticket #${decodedText.trim()} loaded.`);
    return;
  }

  showResult("invalid", "❌", "Invalid QR", "QR does not contain valid Veritix ticket data.");
}

async function startQrScan() {
  if (scannerRunning) {
    return;
  }

  if (typeof Html5Qrcode === "undefined") {
    alert("QR scanner library not loaded.");
    return;
  }

  const isLocalhost = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!window.isSecureContext && !isLocalhost) {
    showResult(
      "invalid",
      "🔒",
      "Camera Blocked",
      "Camera access requires HTTPS on mobile/LAN. Use localhost on same device or open over HTTPS tunnel."
    );
    return;
  }

  const reader = document.getElementById("qrReader");
  const startButton = document.getElementById("startScanBtn");
  const stopButton = document.getElementById("stopScanBtn");

  startButton.disabled = true;
  reader.style.display = "block";
  hideResult();

  try {
    if (!qrScannerInstance) {
      qrScannerInstance = new Html5Qrcode("qrReader");
    }

    let cameraConfig = { facingMode: "environment" };
    const cameras = await Html5Qrcode.getCameras();
    if (Array.isArray(cameras) && cameras.length > 0) {
      const rearCamera = cameras.find((camera) => /back|rear|environment/i.test(camera.label || ""));
      const preferredCamera = rearCamera || cameras[0];
      cameraConfig = { deviceId: { exact: preferredCamera.id } };
    }

    await qrScannerInstance.start(
      cameraConfig,
      {
        fps: 10,
        qrbox: { width: 220, height: 220 }
      },
      async (decodedText) => {
        await stopQrScan();
        await handleScannedText(decodedText);
      },
      () => {}
    );

    scannerRunning = true;
    stopButton.disabled = false;
  } catch (err) {
    reader.style.display = "none";
    startButton.disabled = false;
    stopButton.disabled = true;

    const rawMessage = String(err && (err.message || err.name || "")).toLowerCase();
    if (rawMessage.includes("notallowed") || rawMessage.includes("permission")) {
      showResult("invalid", "❌", "Camera Permission Denied", "Allow camera permission in browser settings and try again.");
      return;
    }

    if (rawMessage.includes("notfound") || rawMessage.includes("devicesnotfound")) {
      showResult("invalid", "❌", "No Camera Found", "No camera device detected. Use manual ticket ID entry.");
      return;
    }

    showResult("invalid", "❌", "Scan Failed", "Unable to access camera for QR scan. Use manual ticket ID entry.");
  }
}

async function stopQrScan() {
  const reader = document.getElementById("qrReader");
  const startButton = document.getElementById("startScanBtn");
  const stopButton = document.getElementById("stopScanBtn");

  if (qrScannerInstance && scannerRunning) {
    try {
      await qrScannerInstance.stop();
      await qrScannerInstance.clear();
    } catch (err) {}
  }

  scannerRunning = false;
  reader.style.display = "none";
  startButton.disabled = false;
  stopButton.disabled = true;
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
    await validateContractConnection(provider);
    const valid = await contract.isValid(Number(ticketId));

    if (!valid) {
      showResult("used", "⚠️", "Already Used", "Ticket #" + ticketId + " has already been scanned or does not exist.");
      return;
    }

    btn.innerHTML = '<span class="spinner"></span>Confirming on-chain...';
    const tx = await contract.verifyAndUse(Number(ticketId));
    await tx.wait();

    if (scannedPayload && String(scannedPayload.tokenId) === String(ticketId)) {
      const name = scannedPayload.purchaserName || "Ticket Holder";
      const eventName = scannedPayload.eventName || "Event";
      showResult("valid", "✅", "Admission Granted", `${name} admitted for ${eventName}. Ticket #${ticketId} verified.`);
    } else {
      showResult("valid", "✅", "Admission Granted", "Ticket #" + ticketId + " is valid. Entry approved!");
    }

    document.getElementById("ticketId").value = "";
    scannedPayload = null;
    hidePurchaserDetails();

  } catch (err) {
    showResult("invalid", "❌", "Error", normalizeErrorMessage(err, "Verification failed."));
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
