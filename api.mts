import { getStore } from "@netlify/blobs";
import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const USERS_STORE = "hostel-users";
const ROOMS_STORE = "hostel-rooms";
const TOKEN_SECRET = Netlify.env.get("TOKEN_SECRET") || "hostel-room-secret-2026";
const WARDEN_PASSCODE = "Hostel@26";
const ROOM_CAPACITY = 4;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

const rooms = getStore(ROOMS_STORE);
const users = getStore(USERS_STORE);

function buildRoomList() {
  const blocks = ["A", "B"];
  const roomList = [];

  for (const block of blocks) {
    for (let floor = 1; floor <= 3; floor += 1) {
      for (let n = 1; n <= 10; n += 1) {
        const suffix = `${floor}0${n}`;
        const roomId = `${block}${suffix}`;
        roomList.push({
          roomId,
          block,
          floor,
          capacity: ROOM_CAPACITY,
          occupants: [],
        });
      }
    }
  }

  return roomList;
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifyToken(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;

  const expected = createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload?.exp || payload.exp < Date.now()) return null;
  return payload;
}

function hashPassword(password, salt) {
  return pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
}

function extractToken(req) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

async function getAllRooms() {
  const stored = await rooms.getJSON("all");
  if (stored) return stored;

  const initial = buildRoomList();
  await rooms.setJSON("all", initial);
  return initial;
}

async function saveAllRooms(allRooms) {
  await rooms.setJSON("all", allRooms);
}

function sanitizeRoomView(allRooms) {
  return allRooms.map((room) => ({
    roomId: room.roomId,
    block: room.block,
    floor: room.floor,
    capacity: room.capacity,
    occupied: room.occupants.length,
    availableBeds: room.capacity - room.occupants.length,
    occupants: room.occupants.map((o) => ({ id: o.id, name: o.name })),
  }));
}

async function requireAuth(req) {
  const token = extractToken(req);
  const payload = verifyToken(token);
  if (!payload) return null;
  return payload;
}

async function handleSignup(req) {
  const body = await req.json();
  const name = String(body?.name || "").trim();
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");

  if (!name || !email || !password) {
    return json({ error: "Name, email, and password are required." }, 400);
  }

  const existing = await users.getJSON(email);
  if (existing) return json({ error: "Email already exists." }, 409);

  const salt = randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, salt);
  const user = {
    id: randomBytes(8).toString("hex"),
    name,
    email,
    salt,
    passwordHash,
    role: "student",
    createdAt: new Date().toISOString(),
  };

  await users.setJSON(email, user);
  return json({ message: "Signup successful." }, 201);
}

async function handleSignin(req) {
  const body = await req.json();
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");

  const user = await users.getJSON(email);
  if (!user) return json({ error: "Invalid credentials." }, 401);

  const checkHash = hashPassword(password, user.salt);
  if (!timingSafeEqual(Buffer.from(checkHash), Buffer.from(user.passwordHash))) {
    return json({ error: "Invalid credentials." }, 401);
  }

  const token = signToken({
    id: user.id,
    name: user.name,
    email: user.email,
    role: "student",
    exp: Date.now() + 1000 * 60 * 60 * 24,
  });

  return json({ token, user: { name: user.name, email: user.email, role: "student" } });
}

async function handleWardenLogin(req) {
  const body = await req.json();
  const passcode = String(body?.passcode || "");

  if (passcode !== WARDEN_PASSCODE) {
    return json({ error: "Invalid passcode." }, 401);
  }

  const token = signToken({ role: "warden", name: "Warden", exp: Date.now() + 1000 * 60 * 60 * 12 });
  return json({ token, user: { name: "Warden", role: "warden" } });
}

async function handleGetRooms(req) {
  const auth = await requireAuth(req);
  if (!auth) return json({ error: "Unauthorized." }, 401);

  const allRooms = await getAllRooms();
  return json({ rooms: sanitizeRoomView(allRooms), me: auth });
}

async function handleBook(req) {
  const auth = await requireAuth(req);
  if (!auth || auth.role !== "student") return json({ error: "Unauthorized." }, 401);

  const body = await req.json();
  const roomId = String(body?.roomId || "").trim().toUpperCase();
  if (!roomId) return json({ error: "roomId is required." }, 400);

  const allRooms = await getAllRooms();
  const target = allRooms.find((r) => r.roomId === roomId);
  if (!target) return json({ error: "Room not found." }, 404);

  if (target.occupants.some((o) => o.id === auth.id)) {
    return json({ error: "You are already in this room." }, 409);
  }

  if (target.occupants.length >= target.capacity) {
    return json({ error: "Room is full." }, 409);
  }

  for (const room of allRooms) {
    room.occupants = room.occupants.filter((o) => o.id !== auth.id);
  }

  target.occupants.push({ id: auth.id, name: auth.name, email: auth.email, movedAt: new Date().toISOString() });
  await saveAllRooms(allRooms);

  return json({ message: `Booked ${roomId} successfully.` });
}

async function handleVacate(req) {
  const auth = await requireAuth(req);
  if (!auth || auth.role !== "student") return json({ error: "Unauthorized." }, 401);

  const allRooms = await getAllRooms();
  let changed = false;

  for (const room of allRooms) {
    const before = room.occupants.length;
    room.occupants = room.occupants.filter((o) => o.id !== auth.id);
    if (room.occupants.length !== before) changed = true;
  }

  if (!changed) return json({ message: "No active room allocation found." });
  await saveAllRooms(allRooms);
  return json({ message: "Vacated room successfully." });
}

async function handleWardenOverview(req) {
  const auth = await requireAuth(req);
  if (!auth || auth.role !== "warden") return json({ error: "Unauthorized." }, 401);

  const allRooms = await getAllRooms();
  const view = sanitizeRoomView(allRooms);
  const totals = {
    totalRooms: view.length,
    totalBeds: view.reduce((sum, room) => sum + room.capacity, 0),
    occupiedBeds: view.reduce((sum, room) => sum + room.occupied, 0),
  };

  return json({ rooms: view, totals });
}

export default async (req) => {
  const url = new URL(req.url);

  try {
    if (req.method === "POST" && url.pathname === "/api/auth/signup") return await handleSignup(req);
    if (req.method === "POST" && url.pathname === "/api/auth/signin") return await handleSignin(req);
    if (req.method === "POST" && url.pathname === "/api/auth/warden-login") return await handleWardenLogin(req);
    if (req.method === "GET" && url.pathname === "/api/rooms") return await handleGetRooms(req);
    if (req.method === "POST" && url.pathname === "/api/rooms/book") return await handleBook(req);
    if (req.method === "POST" && url.pathname === "/api/rooms/vacate") return await handleVacate(req);
    if (req.method === "GET" && url.pathname === "/api/warden/overview") return await handleWardenOverview(req);

    return json({ error: "Route not found." }, 404);
  } catch (err) {
    return json({ error: err?.message || "Unexpected error." }, 500);
  }
};

export const config = {
  path: "/api/*",
};