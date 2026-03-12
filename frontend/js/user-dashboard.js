const contractAddress = "0xdBde2A4d0f06eF088e6De4dfBcA05a23aEE4adb8";
const contractABI = [
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function isValid(uint256 ticketId) view returns (bool)",
  "function nextTicketId() view returns (uint256)",
  "function bookTicket(uint256 ticketId)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)"
];
const EXPECTED_CHAIN_ID = 11155111;
const EXPECTED_CHAIN_HEX = "0xaa36a7";
const API_BASE_URL = `${window.location.protocol}//${window.location.hostname}:4000/api`;
const EVENT_SYNC_INTERVAL_MS = 5000;

let provider;
let signer;
let contract;
let userAddress = "";
let userProfile = {};
let userTickets = [];
let availableShows = [];
let selectedTicket = null;
let selectedTicketQrPayload = "";
let availableShowsFingerprint = "";
let attendeeShowsPollTimer = null;
let attendeeShowsPollInFlight = false;

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    let message = "Request failed";
    try {
      const payload = await response.json();
      message = payload.error || payload.message || message;
    } catch (err) {}
    throw new Error(message);
  }

  return response.json();
}

async function fetchPublicEvents() {
  return apiRequest("/events");
}

async function updatePublicEvent(eventId, patchPayload) {
  return apiRequest(`/events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify(patchPayload)
  });
}

function getShowsFingerprint(shows) {
  return shows
    .map((show) => {
      const tokenIds = Array.isArray(show.tokenIds) ? show.tokenIds.join(",") : "";
      return [
        show.id,
        show.name,
        show.date,
        show.venue,
        Number(show.price || 0),
        Number(show.totalTickets || 0),
        Number(show.soldTickets || 0),
        tokenIds
      ].join("|");
    })
    .join("||");
}

function getActiveTabName() {
  const activeButton = document.querySelector(".nav-item.active");
  return activeButton ? activeButton.getAttribute("data-tab") : "profile";
}

function isTicketDetailOpen() {
  const detailPanel = document.getElementById("ticketDetailPanel");
  return Boolean(detailPanel && detailPanel.style.display !== "none");
}

function reconcileUserTicketsWithShows() {
  const seen = new Set();
  userTickets = userTickets
    .map((ticket) => {
      const show = getShowForTokenId(ticket.id);
      return {
        ...ticket,
        showId: ticket.showId || (show ? show.id : null),
        title: ticket.title || (show ? show.name : `Event Ticket #${ticket.id}`),
        venue: ticket.venue || (show ? show.venue : ""),
        eventDate: ticket.eventDate || (show ? show.date : "")
      };
    })
    .filter((ticket) => {
      const key = String(ticket.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (userAddress) {
    localStorage.setItem("veritix_tickets_" + userAddress, JSON.stringify(userTickets));
  }
}

function startAttendeeShowsAutoSync() {
  stopAttendeeShowsAutoSync();

  attendeeShowsPollTimer = setInterval(async () => {
    if (attendeeShowsPollInFlight || !userAddress) {
      return;
    }

    attendeeShowsPollInFlight = true;
    try {
      const changed = await loadShowsFromServer({ silent: true, skipIfUnchanged: true });
      if (!changed) {
        return;
      }

      reconcileUserTicketsWithShows();

      const activeTab = getActiveTabName();
      if (activeTab === "shows") {
        renderShows();
      } else if (activeTab === "mytickets" && !isTicketDetailOpen()) {
        renderMyTickets();
      }
    } finally {
      attendeeShowsPollInFlight = false;
    }
  }, EVENT_SYNC_INTERVAL_MS);
}

function stopAttendeeShowsAutoSync() {
  if (attendeeShowsPollTimer) {
    clearInterval(attendeeShowsPollTimer);
    attendeeShowsPollTimer = null;
  }
}

function shortWallet(address) {
  if (!address) return "-";
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

function getThemeColor(variableName, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  return value || fallback;
}

function getShowForTokenId(ticketId) {
  return availableShows.find((show) =>
    Array.isArray(show.tokenIds) && show.tokenIds.some((tokenId) => Number(tokenId) === Number(ticketId))
  );
}

function buildTicketMetadata(ticket) {
  const purchaserName = userProfile.name || "Ticket Holder";
  const seatNumber = String((Number(ticket.id) % 90) + 10).padStart(2, "0");

  return {
    eventName: ticket.title || `Event Ticket #${ticket.id}`,
    eventDate: ticket.eventDate || "Date TBD",
    venue: ticket.venue || "Venue TBD",
    tokenId: Number(ticket.id),
    purchaserName,
    purchaserWallet: userAddress,
    bookedDate: ticket.bookedDate || new Date().toLocaleDateString(),
    seatLabel: `VIP BOX | A-${seatNumber}`,
    reference: `VTX${String(ticket.id).padStart(6, "0")}${String(ticket.showId || 0).padStart(4, "0")}`,
    qrId: `VTX-${ticket.id}-${ticket.showId || "GEN"}-${userAddress.slice(2, 8).toUpperCase()}`
  };
}

function buildTicketQrPayload(ticket) {
  const metadata = buildTicketMetadata(ticket);
  return JSON.stringify({
    type: "veritix-ticket",
    version: 1,
    qrId: metadata.qrId,
    tokenId: metadata.tokenId,
    eventName: metadata.eventName,
    eventDate: metadata.eventDate,
    venue: metadata.venue,
    purchaserName: metadata.purchaserName,
    purchaserWallet: metadata.purchaserWallet,
    bookedDate: metadata.bookedDate,
    reference: metadata.reference
  });
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = String(text || "").split(" ");
  let line = "";
  let lineIndex = 0;

  for (let index = 0; index < words.length; index++) {
    const testLine = line ? `${line} ${words[index]}` : words[index];
    const testWidth = ctx.measureText(testLine).width;
    if (testWidth > maxWidth && lineIndex < maxLines - 1) {
      ctx.fillText(line, x, y + lineIndex * lineHeight);
      line = words[index];
      lineIndex += 1;
    } else {
      line = testLine;
    }
  }

  if (lineIndex >= maxLines - 1 && ctx.measureText(line).width > maxWidth) {
    while (ctx.measureText(`${line}…`).width > maxWidth && line.length > 0) {
      line = line.slice(0, -1);
    }
    line = `${line}…`;
  }

  ctx.fillText(line, x, y + lineIndex * lineHeight);
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

async function generateQrDataUrl(payload) {
  if (typeof QRCode === "undefined") {
    throw new Error("QR generator library not loaded. Refresh the page and try again.");
  }

  if (typeof QRCode.toDataURL === "function") {
    return QRCode.toDataURL(payload, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 250,
      color: { dark: "#111111", light: "#ffffff" }
    });
  }

  if (typeof QRCode === "function") {
    const hiddenHolder = document.createElement("div");
    hiddenHolder.style.position = "fixed";
    hiddenHolder.style.left = "-9999px";
    hiddenHolder.style.top = "-9999px";
    document.body.appendChild(hiddenHolder);

    try {
      new QRCode(hiddenHolder, {
        text: payload,
        width: 250,
        height: 250,
        correctLevel: QRCode.CorrectLevel ? QRCode.CorrectLevel.M : undefined
      });

      await new Promise((resolve) => setTimeout(resolve, 40));

      const qrCanvas = hiddenHolder.querySelector("canvas");
      if (qrCanvas) {
        return qrCanvas.toDataURL("image/png");
      }

      const qrImage = hiddenHolder.querySelector("img");
      if (qrImage && qrImage.src) {
        return qrImage.src;
      }

      throw new Error("Unable to render QR image");
    } finally {
      hiddenHolder.remove();
    }
  }

  throw new Error("Unsupported QR generator implementation");
}

async function drawTicketCanvas(canvas, ticket, qrPayload) {
  canvas.width = 1200;
  canvas.height = 450;

  const ctx = canvas.getContext("2d");
  const deep = getThemeColor("--bg-deep", "#060612");
  const purple = getThemeColor("--purple", "#7b2fff");
  const cyan = getThemeColor("--cyan", "#00d4ff");
  const yellow = getThemeColor("--yellow", "#ffd166");

  const metadata = buildTicketMetadata(ticket);

  ctx.fillStyle = "#ececf2";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const leftWidth = 790;
  const gradient = ctx.createLinearGradient(0, 0, leftWidth, canvas.height);
  gradient.addColorStop(0, deep);
  gradient.addColorStop(1, purple);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, leftWidth, canvas.height);

  ctx.fillStyle = yellow;
  ctx.font = "700 46px Inter, Arial";
  ctx.fillText("VERITIX 2026", 52, 86);

  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.font = "700 26px Inter, Arial";
  ctx.fillText("NFT EVENT PASS", 52, 126);

  ctx.fillStyle = "#ffffff";
  ctx.font = "800 72px Inter, Arial";
  wrapText(ctx, metadata.eventName.toUpperCase(), 52, 220, 670, 84, 2);

  ctx.font = "600 36px Inter, Arial";
  ctx.fillStyle = yellow;
  ctx.fillText(`DATE: ${metadata.eventDate}`, 52, 320);

  ctx.fillStyle = "#ffffff";
  ctx.fillText(`VENUE: ${metadata.venue}`, 52, 372);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(leftWidth, 0, canvas.width - leftWidth, canvas.height);

  const qrDataUrl = await generateQrDataUrl(qrPayload);
  const qrImage = await loadImage(qrDataUrl);
  ctx.drawImage(qrImage, 860, 58, 250, 250);

  ctx.fillStyle = deep;
  ctx.fillRect(845, 334, 280, 56);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 30px Inter, Arial";
  ctx.textAlign = "center";
  ctx.fillText(metadata.seatLabel, 985, 371);
  ctx.textAlign = "start";

  ctx.fillStyle = "#707084";
  ctx.font = "500 20px Inter, Arial";
  ctx.fillText(`REF: ${metadata.reference}`, 880, 422);
}

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
    ["function nextTicketId() view returns (uint256)"],
    providerInstance
  );
  await healthContract.nextTicketId();
}

window.addEventListener("DOMContentLoaded", async () => {
  await initializeWallet();
  loadProfileData();
  setupTabNavigation();
  setupEventListeners();
  await loadShowsFromServer();
  await loadUserTickets();
  renderShows();
  startAttendeeShowsAutoSync();
});

window.addEventListener("beforeunload", () => {
  stopAttendeeShowsAutoSync();
});

async function initializeWallet() {
  if (!window.ethereum) return;

  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });

    if (accounts.length === 0) {
      window.location.href = "user.html";
      return;
    }

    await ensureSepoliaNetwork();
    provider = new ethers.providers.Web3Provider(window.ethereum);
    await validateContractConnection(provider);
    signer = provider.getSigner();
    contract = new ethers.Contract(contractAddress, contractABI, signer);
    userAddress = accounts[0];

    updateWalletDisplay();
  } catch (err) {
    alert(normalizeErrorMessage(err, "Wallet init failed"));
    console.error("Wallet init failed:", err);
    window.location.href = "user.html";
  }
}

function updateWalletDisplay() {
  if (!userAddress) return;

  const shortAddr = userAddress.substring(0, 6) + "..." + userAddress.substring(userAddress.length - 4);
  document.getElementById("sidebarWallet").textContent = shortAddr;

  const displayName = userProfile.name || "User";
  document.getElementById("sidebarUsername").textContent = displayName;
}

function loadProfileData() {
  if (!userAddress) return;

  const stored = localStorage.getItem("veritix_profile_" + userAddress);
  if (stored) {
    userProfile = JSON.parse(stored);
    populateProfileForm();
  }
  updateWalletDisplay();
}

function populateProfileForm() {
  document.getElementById("profileName").value = userProfile.name || "";
  document.getElementById("profileEmail").value = userProfile.email || "";
  document.getElementById("profilePhone").value = userProfile.phone || "";
  document.getElementById("profileLocation").value = userProfile.location || "";
  document.getElementById("profileTitle").value = userProfile.title || "";
  document.getElementById("profileBio").value = userProfile.bio || "";

  if (userProfile.avatar) {
    document.getElementById("profileAvatar").textContent = userProfile.avatar;
    document.getElementById("profilePhoto").textContent = userProfile.avatar;
  }
}

function saveProfile() {
  userProfile = {
    name: document.getElementById("profileName").value,
    email: document.getElementById("profileEmail").value,
    phone: document.getElementById("profilePhone").value,
    location: document.getElementById("profileLocation").value,
    title: document.getElementById("profileTitle").value,
    bio: document.getElementById("profileBio").value,
    avatar: userProfile.avatar || "👤"
  };

  localStorage.setItem("veritix_profile_" + userAddress, JSON.stringify(userProfile));
  updateWalletDisplay();
  showStatus("profileStatus", "success", "✅ Profile saved successfully!");
}

function setupTabNavigation() {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabName = btn.getAttribute("data-tab");
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  document.querySelectorAll(".tab-content").forEach((tab) => {
    tab.style.display = "none";
  });

  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.remove("active");
  });

  const tab = document.getElementById(tabName + "-tab");
  if (tab) tab.style.display = "block";

  const navItem = document.querySelector(`[data-tab="${tabName}"]`);
  if (navItem) navItem.classList.add("active");

  if (tabName === "shows") {
    loadShowsFromServer({ silent: false })
      .then(() => {
        renderShows();
      })
      .catch((err) => {
        showStatus("bookingStatus", "error", "❌ " + (err.message || "Unable to load shows"));
      });
  }

  if (tabName === "mytickets") {
    closeTicketDetails(true);
    renderMyTickets();
  }

  if (tabName === "transfer") {
    populateTransferDropdown();
  }
}

async function loadShowsFromServer(options = {}) {
  const { silent = false, skipIfUnchanged = false } = options;

  try {
    const events = await fetchPublicEvents();
    const nextShows = events
      ? events.map((show) => ({
        ...show,
        tokenIds: Array.isArray(show.tokenIds) ? show.tokenIds : [],
        totalTickets: Number(show.totalTickets || 0),
        soldTickets: Number(show.soldTickets || 0)
      }))
      : [];

    nextShows.sort((first, second) => {
      const firstDate = new Date(first.date).getTime();
      const secondDate = new Date(second.date).getTime();
      return firstDate - secondDate;
    });

    const nextFingerprint = getShowsFingerprint(nextShows);
    if (skipIfUnchanged && nextFingerprint === availableShowsFingerprint) {
      return false;
    }

    availableShows = nextShows;
    availableShowsFingerprint = nextFingerprint;
    return true;
  } catch (err) {
    if (silent) {
      console.warn("Attendee auto-sync failed:", err.message || err);
      return false;
    }

    throw err;
  }
}

function renderShows() {
  const grid = document.getElementById("showsGrid");
  if (!grid) return;

  if (availableShows.length === 0) {
    grid.innerHTML = `
      <div class="glass-card" style="grid-column: 1 / -1;">
        <p class="card-desc" style="margin-bottom:0;">No shows available yet. Check back after organizers publish events.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = availableShows.map((show) => {
    const total = Array.isArray(show.tokenIds) ? show.tokenIds.length : Number(show.totalTickets || 0);
    const sold = Math.min(Number(show.soldTickets || 0), total);
    const left = Math.max(total - sold, 0);
    const soldOut = left <= 0;

    return `
      <div class="show-card">
        <div class="show-poster">🎭</div>
        <div class="show-content">
          <div class="show-title">${show.name}</div>
          <div class="show-date">📅 ${show.date}</div>
          <div class="show-location">📍 ${show.venue}</div>
          <div class="show-price">$${Number(show.price || 0).toFixed(2)}</div>
          <div class="ticket-item-meta">NFT Tickets Left: ${left} / ${total}</div>
          <button class="btn btn-primary btn-sm" ${soldOut ? "disabled" : ""} onclick="bookTicket(${show.id})">
            ${soldOut ? "Sold Out" : "Book Ticket"}
          </button>
        </div>
      </div>
    `;
  }).join("");
}

async function findAvailableTokenId(show) {
  if (!contract || !Array.isArray(show.tokenIds) || show.tokenIds.length === 0) {
    return null;
  }

  const organizer = (show.organizerAddress || "").toLowerCase();

  for (const tokenIdRaw of show.tokenIds) {
    const tokenId = Number(tokenIdRaw);
    try {
      const owner = await contract.ownerOf(tokenId);
      if (owner.toLowerCase() === organizer) {
        return tokenId;
      }
    } catch (err) {}
  }

  return null;
}

async function bookTicket(showId) {
  if (!userAddress || !contract) {
    alert("Connect wallet first");
    return;
  }

  let allShows = [];
  try {
    allShows = await fetchPublicEvents();
  } catch (err) {
    showStatus("bookingStatus", "error", "❌ " + (err.message || "Unable to load shows"));
    return;
  }

  const show = allShows.find((item) => Number(item.id) === Number(showId));

  if (!show) {
    showStatus("bookingStatus", "error", "❌ Show not found");
    return;
  }

  show.tokenIds = Array.isArray(show.tokenIds) ? show.tokenIds : [];
  show.totalTickets = show.tokenIds.length;
  show.soldTickets = Number(show.soldTickets || 0);

  if (show.tokenIds.length === 0) {
    showStatus("bookingStatus", "error", "❌ No NFT inventory found for this event");
    return;
  }

  try {
    await validateContractConnection(provider);
  } catch (err) {
    showStatus("bookingStatus", "error", "❌ " + normalizeErrorMessage(err, "Wallet not connected to Sepolia"));
    return;
  }

  showStatus("bookingStatus", "pending", "⏳ Finding available NFT ticket...");
  const tokenId = await findAvailableTokenId(show);

  if (tokenId === null) {
    showStatus("bookingStatus", "error", "❌ This show is sold out");
    return;
  }

  try {
    showStatus("bookingStatus", "pending", `⏳ Booking NFT ticket #${tokenId}...`);
    const tx = await contract.bookTicket(tokenId);
    showStatus("bookingStatus", "pending", "⏳ Waiting for blockchain confirmation...");
    await tx.wait();

    show.soldTickets = Math.min(show.totalTickets, Number(show.soldTickets || 0) + 1);
    await updatePublicEvent(show.id, {
      soldTickets: show.soldTickets
    });

    if (!userTickets.find((ticket) => String(ticket.id) === String(tokenId))) {
      userTickets.push({
        id: tokenId,
        showId: show.id,
        title: show.name,
        price: Number(show.price || 0).toFixed(2),
        bookedDate: new Date().toLocaleDateString(),
        status: "valid",
        venue: show.venue,
        eventDate: show.date
      });
      localStorage.setItem("veritix_tickets_" + userAddress, JSON.stringify(userTickets));
    }

    await loadShowsFromServer();
    renderShows();
    showStatus("bookingStatus", "success", `✅ NFT ticket #${tokenId} booked successfully!`);

    setTimeout(() => {
      switchTab("mytickets");
    }, 1200);
  } catch (err) {
    showStatus("bookingStatus", "error", "❌ " + normalizeErrorMessage(err, "Booking failed"));
  }
}

async function loadUserTickets() {
  const stored = localStorage.getItem("veritix_tickets_" + userAddress);
  if (stored) {
    userTickets = JSON.parse(stored);
  }

  if (contract) {
    try {
      await validateContractConnection(provider);
      const nextIdRaw = await contract.nextTicketId();
      const nextId = Number(nextIdRaw.toString());

      for (let tokenId = 0; tokenId < nextId; tokenId++) {
        try {
          const owner = await contract.ownerOf(tokenId);
          if (owner.toLowerCase() === userAddress.toLowerCase()) {
            if (!userTickets.find((ticket) => String(ticket.id) === String(tokenId))) {
              const valid = await contract.isValid(tokenId);
              const show = getShowForTokenId(tokenId);
              userTickets.push({
                id: tokenId,
                showId: show ? show.id : null,
                title: show ? show.name : "Event Ticket #" + tokenId,
                status: valid ? "valid" : "used",
                venue: show ? show.venue : "",
                eventDate: show ? show.date : ""
              });
            }
          }
        } catch (err) {}
      }
    } catch (err) {
      console.log("Could not load tickets from blockchain:", normalizeErrorMessage(err, "Unknown error"));
    }
  }

  reconcileUserTicketsWithShows();
}

function renderMyTickets() {
  const list = document.getElementById("ticketsList");
  const noMessage = document.getElementById("noTicketsMessage");
  const detailPanel = document.getElementById("ticketDetailPanel");

  if (userTickets.length === 0) {
    list.innerHTML = "";
    list.style.display = "grid";
    noMessage.style.display = "block";
    if (detailPanel) detailPanel.style.display = "none";
    return;
  }

  noMessage.style.display = "none";
  list.style.display = "grid";
  list.innerHTML = userTickets.map((ticket) => `
    <div class="ticket-item selectable" onclick="openTicketDetails(${ticket.id})">
      <div class="ticket-item-header">
        <div>
          <div class="ticket-item-title">${ticket.title}</div>
          <div class="ticket-item-meta">Token ID #${ticket.id}</div>
        </div>
        <span class="ticket-status-badge badge-${ticket.status}">${ticket.status.toUpperCase()}</span>
      </div>
      ${ticket.price ? `<div class="ticket-item-meta">💰 $${ticket.price}</div>` : ""}
      ${ticket.eventDate ? `<div class="ticket-item-meta">📅 Event: ${ticket.eventDate}</div>` : ""}
      ${ticket.venue ? `<div class="ticket-item-meta">📍 Venue: ${ticket.venue}</div>` : ""}
      ${ticket.bookedDate ? `<div class="ticket-item-meta">🧾 Booked: ${ticket.bookedDate}</div>` : ""}
      <div class="ticket-view-hint">Tap to view full ticket & download</div>
    </div>
  `).join("");
}

async function openTicketDetails(ticketId) {
  const ticket = userTickets.find((item) => String(item.id) === String(ticketId));
  if (!ticket) {
    showStatus("noTicketsMessage", "error", "❌ Ticket not found");
    return;
  }

  selectedTicket = ticket;
  selectedTicketQrPayload = buildTicketQrPayload(ticket);

  const list = document.getElementById("ticketsList");
  const noMessage = document.getElementById("noTicketsMessage");
  const panel = document.getElementById("ticketDetailPanel");

  document.getElementById("detailEventName").textContent = ticket.title || "Event Ticket";
  document.getElementById("detailEventDate").textContent = ticket.eventDate || "Date TBD";
  document.getElementById("detailEventVenue").textContent = ticket.venue || "Venue TBD";
  document.getElementById("detailTokenId").textContent = `#${ticket.id}`;
  document.getElementById("detailPurchaserName").textContent = userProfile.name || "Ticket Holder";
  document.getElementById("detailPurchaserWallet").textContent = shortWallet(userAddress);

  list.style.display = "none";
  noMessage.style.display = "none";
  panel.style.display = "block";

  const previewCanvas = document.getElementById("ticketPreviewCanvas");
  try {
    await drawTicketCanvas(previewCanvas, ticket, selectedTicketQrPayload);
  } catch (err) {
    console.error("Ticket preview generation failed:", err);
    showStatus("ticketDownloadStatus", "error", "❌ " + (err.message || "Unable to generate ticket preview"));
  }
}

function closeTicketDetails(keepSelection = false) {
  const list = document.getElementById("ticketsList");
  const panel = document.getElementById("ticketDetailPanel");
  const status = document.getElementById("ticketDownloadStatus");

  if (panel) panel.style.display = "none";
  if (list && userTickets.length > 0) list.style.display = "grid";
  if (status) status.style.display = "none";

  if (!keepSelection) {
    selectedTicket = null;
    selectedTicketQrPayload = "";
  }
}

async function downloadSelectedTicket() {
  if (!selectedTicket) {
    showStatus("ticketDownloadStatus", "error", "❌ Open a ticket first");
    return;
  }

  const button = document.getElementById("downloadTicketBtn");
  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span>Preparing...';

  try {
    const canvas = document.createElement("canvas");
    const qrPayload = selectedTicketQrPayload || buildTicketQrPayload(selectedTicket);
    await drawTicketCanvas(canvas, selectedTicket, qrPayload);
    const pngDataUrl = canvas.toDataURL("image/png");

    const link = document.createElement("a");
    link.href = pngDataUrl;
    link.download = `veritix-ticket-${selectedTicket.id}.png`;

    if (typeof link.download === "string") {
      document.body.appendChild(link);
      link.click();
      link.remove();
    } else {
      window.open(pngDataUrl, "_blank");
    }

    showStatus("ticketDownloadStatus", "success", "✅ Ticket downloaded successfully");
  } catch (err) {
    console.error("Ticket download failed:", err);
    showStatus("ticketDownloadStatus", "error", "❌ " + (err.message || "Failed to download ticket"));
  } finally {
    button.disabled = false;
    button.innerHTML = "Download Ticket";
  }
}

function transferTicketModal(ticketId) {
  switchTab("transfer");
  document.getElementById("transferTicketId").value = ticketId;
  document.getElementById("transferTicketId").dispatchEvent(new Event("change"));
}

function populateTransferDropdown() {
  const select = document.getElementById("transferTicketId");
  select.innerHTML = '<option value="">-- Choose a ticket --</option>';

  userTickets.forEach((ticket) => {
    if (ticket.status === "valid") {
      const option = document.createElement("option");
      option.value = ticket.id;
      option.textContent = `${ticket.title} (#${ticket.id})`;
      select.appendChild(option);
    }
  });
}

async function transferTicket() {
  const ticketId = document.getElementById("transferTicketId").value;
  const recipientAddress = document.getElementById("recipientAddress").value.trim();

  if (!ticketId) {
    alert("Select a ticket");
    return;
  }

  if (!recipientAddress || !recipientAddress.startsWith("0x")) {
    alert("Enter valid wallet address");
    return;
  }

  const button = document.getElementById("transferBtn");
  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span>Transferring...';
  setStatus(document.getElementById("transferStatus"), "pending", "⏳ Processing NFT transfer...");

  try {
    await validateContractConnection(provider);
    const tx = await contract["safeTransferFrom(address,address,uint256)"](
      userAddress,
      recipientAddress,
      Number(ticketId)
    );
    setStatus(document.getElementById("transferStatus"), "pending", "⏳ Waiting for blockchain confirmation...");
    await tx.wait();

    showStatus("transferStatus", "success", "✅ NFT ticket transferred successfully!");

    userTickets = userTickets.filter((ticket) => String(ticket.id) !== String(ticketId));
    localStorage.setItem("veritix_tickets_" + userAddress, JSON.stringify(userTickets));

    if (selectedTicket && String(selectedTicket.id) === String(ticketId)) {
      closeTicketDetails();
      renderMyTickets();
    }

    document.getElementById("transferTicketId").value = "";
    document.getElementById("recipientAddress").value = "";
    document.getElementById("transferMessage").value = "";
  } catch (err) {
    showStatus("transferStatus", "error", "❌ " + normalizeErrorMessage(err, "Transfer failed"));
  } finally {
    button.disabled = false;
    button.innerHTML = "Transfer Ticket";
  }
}

function setupEventListeners() {
  document.getElementById("saveProfileBtn").addEventListener("click", saveProfile);
  document.getElementById("transferBtn").addEventListener("click", transferTicket);
  document.getElementById("downloadTicketBtn").addEventListener("click", downloadSelectedTicket);
  document.getElementById("closeTicketDetailsBtn").addEventListener("click", () => closeTicketDetails());
  document.getElementById("disconnectBtn").addEventListener("click", async () => {
    stopAttendeeShowsAutoSync();

    if (window.ethereum) {
      try {
        await window.ethereum.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }]
        });
      } catch (err) {}
    }

    window.location.href = "user.html";
  });
}

function showStatus(elementId, type, message) {
  const element = document.getElementById(elementId);
  if (!element) return;

  element.className = "status-message status-" + type;
  element.textContent = message;
  element.style.display = "block";

  setTimeout(() => {
    if (type !== "error") {
      element.style.display = "none";
    }
  }, 4000);
}

function setStatus(element, type, message) {
  element.className = "status-message status-" + type;
  element.textContent = message;
}
