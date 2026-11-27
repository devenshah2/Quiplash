// PeerJS brokers the handshake. The host and phones exchange game data over
// ordered, encrypted WebRTC data channels, including chunked image payloads.
import "./vendor/peerjs-1.5.5.min.js";

const ROOM_PREFIX = "devenshah2-quip-room-v1-";
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIAL_TIMEOUT = 18000;
const ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }] };
const noop = () => {};

function newCode() {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), n => LETTERS[n % LETTERS.length]).join("");
}

function normalizeCode(code) {
  const value = String(code ?? "").trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(value)) throw new Error("Enter the four-letter room code from the host screen.");
  return value;
}

function key() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, "0")).join("");
}

function roomSecret(code) {
  const item = "quip-room-player-v1:" + code;
  try {
    let secret = sessionStorage.getItem(item);
    if (!/^[a-f0-9]{48}$/.test(secret || "")) {
      secret = key();
      sessionStorage.setItem(item, secret);
    }
    return secret;
  } catch {
    return key();
  }
}

async function publicId(code, secret) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code + ":" + secret));
  return "p-" + Array.from(new Uint8Array(digest).slice(0, 16), n => n.toString(16).padStart(2, "0")).join("");
}

function createPeer(id) {
  if (!globalThis.RTCPeerConnection || !crypto.subtle) {
    throw new Error("Open the secure game link in a browser that supports WebRTC, such as Safari, Chrome or Firefox.");
  }
  return new globalThis.Peer(id, { secure: true, config: ICE, debug: 0 });
}

function statusListener(callback) {
  let last = "";
  return status => {
    if (last === status) return;
    last = status;
    callback(status);
  };
}

function post(connection, message) {
  if (!connection?.open) return false;
  try {
    connection.send(message);
    return true;
  } catch {
    return false;
  }
}

// Page exit must preserve the UI’s saved session for a tab refresh.
function closeOnExit(close) {
  const onHide = event => { if (!event.persisted) close(true); };
  window.addEventListener("pagehide", onHide);
  return () => window.removeEventListener("pagehide", onHide);
}

// ICE occasionally stays "disconnected" when a phone changes networks.
// Give it a grace period for a brief Wi-Fi handoff, then establish a fresh link.
function watchIce(conn) {
  const pc = conn.peerConnection;
  if (!pc) return;
  let timer;
  const changed = () => {
    clearTimeout(timer);
    if (pc.iceConnectionState === "disconnected") timer = setTimeout(() => conn.close(), 9000);
  };
  pc.addEventListener("iceconnectionstatechange", changed);
  conn.on("close", () => {
    clearTimeout(timer);
    pc.removeEventListener("iceconnectionstatechange", changed);
  });
}

export async function hostRoom({ code: requested, onJoin = noop, onLeave = noop, onMessage = noop, onStatus = noop } = {}) {
  const status = statusListener(onStatus);
  status("connecting");
  const fixed = requested ? normalizeCode(requested) : null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = fixed || newCode();
    try {
      return await registerHost(code, { onJoin, onLeave, onMessage, status });
    } catch (error) {
      if (error.type === "unavailable-id" && !fixed) continue;
      status("closed");
      if (error.type === "unavailable-id") throw new Error("This room is already open. Check the original host tab or start a new room.");
      throw error;
    }
  }
  status("closed");
  throw new Error("Room codes are busy. Try creating a room again.");
}

function registerHost(code, { onJoin, onLeave, onMessage, status }) {
  return new Promise((resolve, reject) => {
    const peer = createPeer(ROOM_PREFIX + code);
    const connections = new Map();
    let opened = false, ended = false, retry;
    const initialTimeout = setTimeout(() => fail(new Error("The room service took too long to respond. Check your connection and try again.")), 14000);
    const unbind = closeOnExit(close);

    function close(silent = false) {
      if (ended) return;
      ended = true;
      clearTimeout(initialTimeout);
      clearTimeout(retry);
      unbind();
      peer.destroy();
      if (opened && !silent) status("closed");
    }

    function fail(error) {
      close();
      reject(error);
    }

    function retrySignaling() {
      if (ended || !opened || !peer.disconnected) return;
      status("reconnecting");
      clearTimeout(retry);
      retry = setTimeout(() => {
        if (ended || !peer.disconnected) return;
        try { peer.reconnect(); } catch { retrySignaling(); }
      }, 1600);
    }

    peer.on("open", () => {
      clearTimeout(initialTimeout);
      clearTimeout(retry);
      if (ended) return;
      opened = true;
      status("connected");
      resolve({
        code, close,
        peers: () => Array.from(connections.keys()),
        send: (id, data) => post(connections.get(id), { type: "data", data })
      });
    });
    peer.on("disconnected", retrySignaling);
    peer.on("close", () => { if (!ended) close(); });
    peer.on("error", error => {
      if (!opened) {
        if (error.type === "unavailable-id") fail(error);
        else fail(new Error("Could not open the room service. Check your internet connection and try again."));
      } else if (!ended && peer.disconnected) {
        retrySignaling();
      }
    });

    peer.on("connection", conn => {
      let id, closed = false, introduced = false;
      const handshakeTimeout = setTimeout(() => conn.close(), DIAL_TIMEOUT);
      conn.on("open", () => watchIce(conn));
      conn.on("error", () => conn.close());
      conn.on("close", () => {
        closed = true;
        clearTimeout(handshakeTimeout);
        if (id && connections.get(id) === conn) {
          connections.delete(id);
          if (!ended) onLeave(id);
        }
      });
      conn.on("data", async message => {
        if (ended || closed || !message || typeof message !== "object") return;
        if (id) {
          if (connections.get(id) === conn && message.type === "data") onMessage(id, message.data);
          return;
        }
        if (introduced || message.type !== "hello" || typeof message.secret !== "string" ||
            !/^[a-f0-9]{48}$/.test(message.secret) || typeof message.name !== "string") return;
        introduced = true;
        const name = message.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24);
        if (!name) { conn.close(); return; }
        const nextId = await publicId(code, message.secret);
        if (ended || closed || !conn.open) return;
        clearTimeout(handshakeTimeout);
        id = nextId;
        const previous = connections.get(id);
        connections.set(id, conn);
        if (previous && previous !== conn) {
          post(previous, { type: "replaced" });
          setTimeout(() => previous.close(), 200);
        }
        post(conn, { type: "welcome", id });
        onJoin(id, name);
      });
    });
  });
}

export async function joinRoom({ code: input, name, onMessage = noop, onStatus = noop }) {
  const code = normalizeCode(input);
  const playerName = String(name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24);
  if (!playerName) throw new Error("Enter a player name to join.");
  const secret = roomSecret(code);
  const id = await publicId(code, secret);
  const status = statusListener(onStatus);
  return new Promise((resolve, reject) => {
    let closed = false, everJoined = false, ready = false, backoff = 700;
    let peer, channel, retry, timeout;
    const unbind = closeOnExit(close);
    const handle = { id, code, close, send: data => ready && post(channel, { type: "data", data }) };
    window.addEventListener("online", online);

    function resetAttempt() {
      clearTimeout(timeout);
      clearTimeout(retry);
      const previous = peer;
      peer = null;
      channel = null;
      ready = false;
      previous?.destroy();
    }

    function close(silent = false) {
      if (closed) return;
      closed = true;
      resetAttempt();
      unbind();
      window.removeEventListener("online", online);
      if (!silent) status("closed");
      if (!everJoined) reject(new Error("The connection closed before you joined the room."));
    }

    function lost(current, message) {
      if (closed || current !== peer) return;
      resetAttempt();
      if (!everJoined) {
        reject(new Error(message));
        close();
        return;
      }
      status("reconnecting");
      retry = setTimeout(dial, backoff);
      backoff = Math.min(5000, backoff * 1.6);
    }

    function online() {
      if (!closed && everJoined && !peer) dial();
    }

    function dial() {
      if (closed) return;
      resetAttempt();
      const current = createPeer("quip-guest-" + key());
      peer = current;
      timeout = setTimeout(() => lost(current, "Could not reach the host. Keep the host tab open. Guest or office Wi-Fi can block this connection. Try another network."), DIAL_TIMEOUT);
      current.on("open", () => {
        if (closed || current !== peer || channel) return;
        const conn = current.connect(ROOM_PREFIX + code, { reliable: true, serialization: "binary" });
        channel = conn;
        conn.on("open", () => {
          watchIce(conn);
          post(conn, { type: "hello", name: playerName, secret });
        });
        conn.on("data", message => {
          if (closed || current !== peer || !message) return;
          if (message.type === "welcome" && message.id === id) {
            clearTimeout(timeout);
            ready = everJoined = true;
            backoff = 700;
            status("connected");
            resolve(handle);
          } else if (ready && message.type === "data") {
            onMessage(message.data);
          } else if (message.type === "replaced") {
            close();
          }
        });
        conn.on("error", () => lost(current, "The connection to the host was interrupted. Try joining again."));
        conn.on("close", () => lost(current, "The host closed the connection. Check the room code and try again."));
      });
      current.on("error", error => {
        if (ready && error.type === "network") return; // Existing data channels survive signaling outages.
        const message = error.type === "peer-unavailable"
          ? "Room not found. Check the code and make sure the host screen is open."
          : "Could not connect to the room service. Check your internet connection and try again.";
        lost(current, message);
      });
      current.on("close", () => lost(current, "The room service disconnected. Try joining again."));
    }

    status("connecting");
    dial();
  });
}
