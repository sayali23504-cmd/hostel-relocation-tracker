const state = {
  token: localStorage.getItem("hostel_token") || "",
  role: localStorage.getItem("hostel_role") || "",
  name: localStorage.getItem("hostel_name") || "",
};

const authSection = document.getElementById("authSection");
const dashboardSection = document.getElementById("dashboardSection");
const welcomeText = document.getElementById("welcomeText");
const roomGrid = document.getElementById("roomGrid");
const message = document.getElementById("message");
const stats = document.getElementById("stats");
const vacateBtn = document.getElementById("vacateBtn");

function setMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#ffb4b4" : "#b8ffd5";
}

async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function saveSession(token, user) {
  state.token = token;
  state.role = user.role;
  state.name = user.name;

  localStorage.setItem("hostel_token", token);
  localStorage.setItem("hostel_role", user.role);
  localStorage.setItem("hostel_name", user.name);
}

function clearSession() {
  state.token = "";
  state.role = "";
  state.name = "";
  localStorage.removeItem("hostel_token");
  localStorage.removeItem("hostel_role");
  localStorage.removeItem("hostel_name");
}

function renderRooms(rooms) {
  roomGrid.innerHTML = "";
  for (const room of rooms) {
    const card = document.createElement("article");
    card.className = "room-card";
    const occupants = room.occupants.length
      ? room.occupants.map((o) => `<li>${o.name}</li>`).join("")
      : "<li>Empty</li>";

    card.innerHTML = `
      <h3>${room.roomId}</h3>
      <p>Block ${room.block}, Floor ${room.floor}</p>
      <p><strong>${room.occupied}/${room.capacity}</strong> occupied</p>
      <ul>${occupants}</ul>
      ${state.role === "student" ? `<button data-room="${room.roomId}">Book Here</button>` : ""}
    `;

    roomGrid.appendChild(card);
  }

  if (state.role === "student") {
    roomGrid.querySelectorAll("button[data-room]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const roomId = btn.getAttribute("data-room");
          await api("/api/rooms/book", "POST", { roomId });
          setMessage(`Booked ${roomId} successfully.`);
          await loadDashboard();
        } catch (err) {
          setMessage(err.message, true);
        }
      });
    });
  }
}

function renderStats(data) {
  if (state.role === "warden") {
    const t = data.totals;
    stats.innerHTML = `
      <div class="stat">Rooms: ${t.totalRooms}</div>
      <div class="stat">Beds: ${t.totalBeds}</div>
      <div class="stat">Occupied: ${t.occupiedBeds}</div>
      <div class="stat">Available: ${t.totalBeds - t.occupiedBeds}</div>
    `;
    return;
  }

  const occupied = data.rooms.reduce((s, r) => s + r.occupied, 0);
  const totalBeds = data.rooms.reduce((s, r) => s + r.capacity, 0);
  stats.innerHTML = `
    <div class="stat">My Access: Student</div>
    <div class="stat">Occupied Beds: ${occupied}</div>
    <div class="stat">Available Beds: ${totalBeds - occupied}</div>
  `;
}

async function loadDashboard() {
  if (!state.token) return;

  try {
    const data =
      state.role === "warden" ? await api("/api/warden/overview") : await api("/api/rooms");

    authSection.classList.add("hidden");
    dashboardSection.classList.remove("hidden");
    welcomeText.textContent = `Welcome, ${state.name}`;
    vacateBtn.classList.toggle("hidden", state.role !== "student");

    renderStats(data);
    renderRooms(data.rooms);
  } catch (err) {
    clearSession();
    authSection.classList.remove("hidden");
    dashboardSection.classList.add("hidden");
    setMessage(err.message, true);
  }
}

document.getElementById("signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);

  try {
    await api("/api/auth/signup", "POST", {
      name: fd.get("name"),
      email: fd.get("email"),
      password: fd.get("password"),
    });
    setMessage("Signup successful. Please sign in.");
    e.currentTarget.reset();
  } catch (err) {
    setMessage(err.message, true);
  }
});

document.getElementById("signinForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);

  try {
    const data = await api("/api/auth/signin", "POST", {
      email: fd.get("email"),
      password: fd.get("password"),
    });
    saveSession(data.token, data.user);
    setMessage("Signed in successfully.");
    e.currentTarget.reset();
    await loadDashboard();
  } catch (err) {
    setMessage(err.message, true);
  }
});

document.getElementById("wardenForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);

  try {
    const data = await api("/api/auth/warden-login", "POST", {
      passcode: fd.get("passcode"),
    });
    saveSession(data.token, data.user);
    setMessage("Warden login successful.");
    e.currentTarget.reset();
    await loadDashboard();
  } catch (err) {
    setMessage(err.message, true);
  }
});

document.getElementById("refreshBtn").addEventListener("click", loadDashboard);

document.getElementById("logoutBtn").addEventListener("click", () => {
  clearSession();
  authSection.classList.remove("hidden");
  dashboardSection.classList.add("hidden");
  setMessage("Logged out.");
});

vacateBtn.addEventListener("click", async () => {
  try {
    const data = await api("/api/rooms/vacate", "POST");
    setMessage(data.message || "Vacated.");
    await loadDashboard();
  } catch (err) {
    setMessage(err.message, true);
  }
});

if (state.token) {
  loadDashboard();
}