const contractAddress = "0xdBde2A4d0f06eF088e6De4dfBcA05a23aEE4adb8";
const contractABI = [
  "function mintTicket(address to)",
  "function nextTicketId() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)"
];
const EXPECTED_CHAIN_ID = 11155111;
const EXPECTED_CHAIN_HEX = "0xaa36a7";
const API_BASE_URL = `${window.location.protocol}//${window.location.hostname}:4000/api`;
const EVENT_SYNC_INTERVAL_MS = 5000;
const ORGANIZER_AUTH_SESSION_KEY = "veritix_organizer_authenticated";
const ORGANIZER_CREDENTIALS = {
  username: "organizer",
  password: "veritix123"
};

let provider;
let signer;
let contract;
let organizerAddress = "";
let organizerProfile = {};
let organizerEvents = [];
let isOrganizerAuthenticated = false;
let organizerEventsFingerprint = "";
let organizerEventsPollTimer = null;
let organizerEventsPollInFlight = false;

window.addEventListener("DOMContentLoaded", async () => {
  setupTabNavigation();
  setupEventListeners();
  bootstrapOrganizerAuth();

  if (isOrganizerAuthenticated) {
    await initializeFromConnectedWallet();
  }
});

window.addEventListener("beforeunload", () => {
  stopOrganizerEventsAutoSync();
});

function bootstrapOrganizerAuth() {
  isOrganizerAuthenticated = sessionStorage.getItem(ORGANIZER_AUTH_SESSION_KEY) === "true";
  setAuthGateState(isOrganizerAuthenticated);
}

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

async function createPublicEvent(eventPayload) {
  return apiRequest("/events", {
    method: "POST",
    body: JSON.stringify(eventPayload)
  });
}

async function updatePublicEvent(eventId, patchPayload) {
  return apiRequest(`/events/${eventId}`, {
    method: "PATCH",
    body: JSON.stringify(patchPayload)
  });
}

function normalizeServerEvent(event) {
  return {
    ...event,
    tokenIds: Array.isArray(event.tokenIds) ? event.tokenIds : [],
    totalTickets: Number(event.totalTickets || 0),
    soldTickets: Number(event.soldTickets || 0)
  };
}

function getOrganizerEventsFingerprint(events) {
  return events
    .map((event) => {
      const tokenIds = Array.isArray(event.tokenIds) ? event.tokenIds.join(",") : "";
      return [
        event.id,
        event.name,
        event.date,
        event.venue,
        Number(event.price || 0),
        Number(event.totalTickets || 0),
        Number(event.soldTickets || 0),
        tokenIds
      ].join("|");
    })
    .join("||");
}

function startOrganizerEventsAutoSync() {
  stopOrganizerEventsAutoSync();

  organizerEventsPollTimer = setInterval(async () => {
    if (organizerEventsPollInFlight || !organizerAddress || !isOrganizerAuthenticated) {
      return;
    }

    organizerEventsPollInFlight = true;
    try {
      await loadEvents({ silent: true, skipIfUnchanged: true });
    } finally {
      organizerEventsPollInFlight = false;
    }
  }, EVENT_SYNC_INTERVAL_MS);
}

function stopOrganizerEventsAutoSync() {
  if (organizerEventsPollTimer) {
    clearInterval(organizerEventsPollTimer);
    organizerEventsPollTimer = null;
  }
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

function setAuthGateState(authenticated) {
  const authGate = document.getElementById("organizerAuthGate");
  const dashboard = document.getElementById("organizerDashboard");
  const connectBtn = document.getElementById("connectBtn");
  const logoutBtn = document.getElementById("organizerLogoutBtn");

  if (!authenticated) {
    organizerAddress = "";
    organizerEvents = [];
    organizerEventsFingerprint = "";
    stopOrganizerEventsAutoSync();
    contract = undefined;
  }

  if (authGate) authGate.style.display = authenticated ? "none" : "block";
  if (dashboard) dashboard.style.display = authenticated ? "flex" : "none";

  if (connectBtn) {
    connectBtn.disabled = !authenticated;
    connectBtn.textContent = authenticated
      ? (organizerAddress ? "Connected" : "Connect Wallet")
      : "Connect Wallet";
  }

  if (logoutBtn) {
    logoutBtn.style.display = authenticated ? "inline-flex" : "none";
  }

  if (!authenticated) {
    updateWalletDisplay();
  }
}

async function initializeFromConnectedWallet() {
  if (!window.ethereum || !isOrganizerAuthenticated) {
    return;
  }

  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    if (accounts.length > 0) {
      await hydrateOrganizer(accounts[0]);
    }
  } catch (err) {
    console.error("Wallet init failed:", err);
  }
}

function setupEventListeners() {
  const connectBtn = document.getElementById("connectBtn");
  const saveProfileBtn = document.getElementById("saveOrgProfileBtn");
  const createEventBtn = document.getElementById("createEventBtn");
  const addTicketsBtn = document.getElementById("updateInventoryBtn");
  const eventSelect = document.getElementById("ticketEventSelect");
  const loginBtn = document.getElementById("organizerLoginBtn");
  const logoutBtn = document.getElementById("organizerLogoutBtn");

  if (connectBtn) connectBtn.onclick = connectWallet;
  if (saveProfileBtn) saveProfileBtn.onclick = saveOrganizerProfile;
  if (createEventBtn) createEventBtn.onclick = createEvent;
  if (addTicketsBtn) addTicketsBtn.onclick = addTicketsToEvent;
  if (eventSelect) eventSelect.onchange = refreshSelectedEventAnalysis;
  if (loginBtn) loginBtn.onclick = loginOrganizer;
  if (logoutBtn) logoutBtn.onclick = logoutOrganizer;
}

function setupTabNavigation() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.getAttribute("data-tab");
      switchTab(tab);
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

  const tab = document.getElementById(`${tabName}-tab`);
  if (tab) {
    tab.style.display = "block";
  }

  const nav = document.querySelector(`[data-tab="${tabName}"]`);
  if (nav) {
    nav.classList.add("active");
  }

  if (tabName === "events") {
    renderEvents();
  }

  if (tabName === "tickets") {
    populateEventSelect();
    refreshSelectedEventAnalysis();
    renderTicketSummaryCards();
  }
}

function loginOrganizer() {
  const username = document.getElementById("organizerUsername").value.trim();
  const password = document.getElementById("organizerPassword").value;

  if (username !== ORGANIZER_CREDENTIALS.username || password !== ORGANIZER_CREDENTIALS.password) {
    showStatus("organizerLoginStatus", "error", "❌ Invalid organizer credentials");
    return;
  }

  sessionStorage.setItem(ORGANIZER_AUTH_SESSION_KEY, "true");
  isOrganizerAuthenticated = true;
  setAuthGateState(true);

  document.getElementById("organizerUsername").value = "";
  document.getElementById("organizerPassword").value = "";

  initializeFromConnectedWallet();
}

function logoutOrganizer() {
  sessionStorage.removeItem(ORGANIZER_AUTH_SESSION_KEY);
  isOrganizerAuthenticated = false;
  stopOrganizerEventsAutoSync();

  const connectBtn = document.getElementById("connectBtn");
  if (connectBtn) {
    connectBtn.textContent = "Connect Wallet";
    connectBtn.disabled = true;
  }

  setAuthGateState(false);
}

async function connectWallet() {
  if (!isOrganizerAuthenticated) {
    showStatus("organizerLoginStatus", "error", "❌ Login with credentials first");
    return;
  }

  if (!window.ethereum) {
    alert("Install MetaMask");
    return;
  }

  try {
    await ensureSepoliaNetwork();
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (accounts.length === 0) {
      return;
    }

    await hydrateOrganizer(accounts[0]);
  } catch (err) {
    alert(normalizeErrorMessage(err, "Unable to connect wallet"));
  }
}

async function hydrateOrganizer(account) {
  provider = new ethers.providers.Web3Provider(window.ethereum);
  await validateContractConnection(provider);
  signer = provider.getSigner();
  contract = new ethers.Contract(contractAddress, contractABI, signer);
  organizerAddress = account;

  const button = document.getElementById("connectBtn");
  if (button) {
    button.textContent = "Connected";
    button.disabled = true;
  }

  loadOrganizerProfile();
  await loadEvents();
  startOrganizerEventsAutoSync();
}

function updateWalletDisplay() {
  const shortAddress = organizerAddress
    ? `${organizerAddress.substring(0, 6)}...${organizerAddress.substring(organizerAddress.length - 4)}`
    : "";

  const walletDisplay = document.getElementById("walletDisplay");
  if (walletDisplay) {
    walletDisplay.textContent = organizerAddress;
  }

  const sidebarWallet = document.getElementById("orgSidebarWallet");
  if (sidebarWallet) {
    sidebarWallet.textContent = shortAddress;
  }

  const sidebarName = document.getElementById("orgSidebarName");
  if (sidebarName) {
    sidebarName.textContent = organizerProfile.name || "Organizer";
  }
}

function organizerProfileKey() {
  return `veritix_org_profile_${organizerAddress}`;
}

function loadOrganizerProfile() {
  if (!organizerAddress) {
    return;
  }

  const storedProfile = localStorage.getItem(organizerProfileKey());
  organizerProfile = storedProfile ? JSON.parse(storedProfile) : {};

  document.getElementById("orgName").value = organizerProfile.name || "";
  document.getElementById("orgEmail").value = organizerProfile.email || "";
  document.getElementById("orgPhone").value = organizerProfile.phone || "";
  document.getElementById("orgWebsite").value = organizerProfile.website || "";
  document.getElementById("orgCompany").value = organizerProfile.company || "";
  document.getElementById("orgRole").value = organizerProfile.role || "";

  const avatar = organizerProfile.avatar || "🏛️";
  document.getElementById("orgAvatar").textContent = avatar;
  document.getElementById("orgProfilePhoto").textContent = avatar;

  updateWalletDisplay();
}

function saveOrganizerProfile() {
  if (!organizerAddress) {
    alert("Connect wallet first");
    return;
  }

  organizerProfile = {
    name: document.getElementById("orgName").value.trim(),
    email: document.getElementById("orgEmail").value.trim(),
    phone: document.getElementById("orgPhone").value.trim(),
    website: document.getElementById("orgWebsite").value.trim(),
    company: document.getElementById("orgCompany").value.trim(),
    role: document.getElementById("orgRole").value.trim(),
    avatar: organizerProfile.avatar || "🏛️"
  };

  localStorage.setItem(organizerProfileKey(), JSON.stringify(organizerProfile));
  updateWalletDisplay();
  showStatus("orgProfileStatus", "success", "✅ Organizer profile saved");
}

async function loadEvents(options = {}) {
  const { silent = false, skipIfUnchanged = false } = options;

  if (!organizerAddress) {
    organizerEvents = [];
    organizerEventsFingerprint = "";
    renderEvents();
    renderTicketSummaryCards();
    return;
  }

  try {
    const allEvents = await fetchPublicEvents();
    const nextEvents = allEvents
      .filter((event) => (event.organizerAddress || "").toLowerCase() === organizerAddress.toLowerCase())
      .map((event) => normalizeServerEvent(event));

    const nextFingerprint = getOrganizerEventsFingerprint(nextEvents);
    if (skipIfUnchanged && nextFingerprint === organizerEventsFingerprint) {
      return;
    }

    organizerEvents = nextEvents;
    organizerEventsFingerprint = nextFingerprint;
  } catch (err) {
    if (!silent) {
      organizerEvents = [];
      organizerEventsFingerprint = "";
      showStatus("eventsStatus", "error", "❌ " + (err.message || "Unable to load events from server"));
    } else {
      console.warn("Organizer auto-sync failed:", err.message || err);
    }
    return;
  }

  renderEvents();
  populateEventSelect();
  renderTicketSummaryCards();
  refreshSelectedEventAnalysis();
}

async function createEvent() {
  if (!organizerAddress) {
    alert("Connect wallet first");
    return;
  }

  const name = document.getElementById("eventName").value.trim();
  const date = document.getElementById("eventDate").value;
  const venue = document.getElementById("eventVenue").value.trim();
  const price = document.getElementById("eventPrice").value;

  if (!name || !date || !venue || !price) {
    showStatus("eventsStatus", "error", "❌ Fill all event fields");
    return;
  }

  const newEvent = {
    id: Date.now(),
    organizerAddress,
    name,
    date,
    venue,
    price: Number(price),
    totalTickets: 0,
    soldTickets: 0,
    tokenIds: []
  };

  try {
    await createPublicEvent(newEvent);

    document.getElementById("eventName").value = "";
    document.getElementById("eventDate").value = "";
    document.getElementById("eventVenue").value = "";
    document.getElementById("eventPrice").value = "";

    await loadEvents();
    showStatus("eventsStatus", "success", "✅ Event created successfully");
  } catch (err) {
    showStatus("eventsStatus", "error", "❌ " + (err.message || "Failed to create event"));
  }
}

function renderEvents() {
  const list = document.getElementById("eventsList");
  if (!list) {
    return;
  }

  if (organizerEvents.length === 0) {
    list.innerHTML = `
      <div class="glass-card" style="grid-column: 1 / -1;">
        <p class="card-desc" style="margin-bottom:0;">No events created yet. Add your first event using the form.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = organizerEvents.map((event) => {
    const total = Array.isArray(event.tokenIds) ? event.tokenIds.length : Number(event.totalTickets || 0);
    const sold = Math.min(Number(event.soldTickets || 0), total);
    const left = Math.max(total - sold, 0);

    return `
      <div class="show-card">
        <div class="show-poster">🎫</div>
        <div class="show-content">
          <div class="show-title">${event.name}</div>
          <div class="show-date">📅 ${event.date}</div>
          <div class="show-location">📍 ${event.venue}</div>
          <div class="show-price">$${Number(event.price).toFixed(2)}</div>
          <div class="ticket-item-meta">NFT Tickets: ${total} • Sold: ${sold} • Left: ${left}</div>
        </div>
      </div>
    `;
  }).join("");
}

function populateEventSelect() {
  const select = document.getElementById("ticketEventSelect");
  if (!select) {
    return;
  }

  const currentValue = select.value;
  select.innerHTML = '<option value="">-- Select Event --</option>';

  organizerEvents.forEach((event) => {
    const option = document.createElement("option");
    option.value = String(event.id);
    option.textContent = `${event.name} (${event.date})`;
    select.appendChild(option);
  });

  if (currentValue && organizerEvents.some((event) => String(event.id) === currentValue)) {
    select.value = currentValue;
  }
}

async function addTicketsToEvent() {
  if (!organizerAddress || !contract) {
    alert("Connect wallet first");
    return;
  }

  const selectedEventId = document.getElementById("ticketEventSelect").value;
  const quantityRaw = document.getElementById("ticketBatchSize").value;
  const quantity = Number(quantityRaw);
  const statusElement = document.getElementById("inventoryStatus");
  const button = document.getElementById("updateInventoryBtn");

  if (!selectedEventId) {
    showStatus("inventoryStatus", "error", "❌ Select an event first");
    return;
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    showStatus("inventoryStatus", "error", "❌ Enter a valid ticket count");
    return;
  }

  let allEvents = [];
  try {
    allEvents = await fetchPublicEvents();
  } catch (err) {
    showStatus("inventoryStatus", "error", "❌ " + (err.message || "Unable to load events from server"));
    return;
  }

  const event = allEvents.find((item) => String(item.id) === selectedEventId);

  if (!event) {
    showStatus("inventoryStatus", "error", "❌ Event not found");
    return;
  }

  if ((event.organizerAddress || "").toLowerCase() !== organizerAddress.toLowerCase()) {
    showStatus("inventoryStatus", "error", "❌ You can manage only your own events");
    return;
  }

  event.tokenIds = Array.isArray(event.tokenIds) ? event.tokenIds : [];

  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span>Minting NFTs...';
  statusElement.className = "status-message status-pending";
  statusElement.textContent = "⏳ Preparing NFT mint transactions...";

  try {
    await validateContractConnection(provider);
    const startIdRaw = await contract.nextTicketId();
    const startTicketId = Number(startIdRaw.toString());

    for (let index = 0; index < quantity; index++) {
      const tx = await contract.mintTicket(organizerAddress);
      statusElement.textContent = `⏳ Minting ticket ${index + 1}/${quantity}...`;
      await tx.wait();
      event.tokenIds.push(startTicketId + index);
    }

    event.totalTickets = event.tokenIds.length;
    event.soldTickets = Math.min(Number(event.soldTickets || 0), event.totalTickets);
    await updatePublicEvent(event.id, {
      tokenIds: event.tokenIds,
      totalTickets: event.totalTickets,
      soldTickets: event.soldTickets
    });

    document.getElementById("ticketBatchSize").value = "";
    await loadEvents();
    document.getElementById("ticketEventSelect").value = selectedEventId;
    refreshSelectedEventAnalysis();

    const endTicketId = startTicketId + quantity - 1;
    showStatus("inventoryStatus", "success", `✅ Minted NFT tickets #${startTicketId} to #${endTicketId}`);
  } catch (err) {
    showStatus("inventoryStatus", "error", "❌ " + normalizeErrorMessage(err, "Mint failed"));
  } finally {
    button.disabled = false;
    button.innerHTML = "Add Tickets";
  }
}

function refreshSelectedEventAnalysis() {
  const selectedEventId = document.getElementById("ticketEventSelect").value;
  const selectedEvent = organizerEvents.find((event) => String(event.id) === selectedEventId);

  const total = selectedEvent
    ? (Array.isArray(selectedEvent.tokenIds) ? selectedEvent.tokenIds.length : Number(selectedEvent.totalTickets || 0))
    : 0;
  const sold = selectedEvent ? Math.min(Number(selectedEvent.soldTickets || 0), total) : 0;
  const left = Math.max(total - sold, 0);

  document.getElementById("totalTicketsValue").textContent = String(total);
  document.getElementById("soldTicketsValue").textContent = String(sold);
  document.getElementById("leftTicketsValue").textContent = String(left);
}

function renderTicketSummaryCards() {
  const list = document.getElementById("issuedTicketsList");
  const noTickets = document.getElementById("noIssuedTickets");

  if (!list || !noTickets) {
    return;
  }

  if (organizerEvents.length === 0) {
    list.innerHTML = "";
    noTickets.style.display = "block";
    return;
  }

  noTickets.style.display = "none";
  list.innerHTML = organizerEvents.map((event) => {
    const total = Array.isArray(event.tokenIds) ? event.tokenIds.length : Number(event.totalTickets || 0);
    const sold = Math.min(Number(event.soldTickets || 0), total);
    const left = Math.max(total - sold, 0);

    return `
      <div class="ticket-item">
        <div class="ticket-item-header">
          <div>
            <div class="ticket-item-title">${event.name}</div>
            <div class="ticket-item-meta">${event.date} • ${event.venue}</div>
          </div>
          <span class="ticket-status-badge badge-valid">NFT</span>
        </div>
        <div class="ticket-item-meta">Total Tickets: ${total}</div>
        <div class="ticket-item-meta">Sold Tickets: ${sold}</div>
        <div class="ticket-item-meta">Left Tickets: ${left}</div>
      </div>
    `;
  }).join("");
}

function showStatus(elementId, type, message) {
  const element = document.getElementById(elementId);
  if (!element) {
    return;
  }

  element.className = "status-message status-" + type;
  element.textContent = message;
}
