// WebSocket networking for multiplayer Jump Prince.
//
// Client-authoritative model: the local player is simulated by this client
// and its state is reported to the server at a fixed rate. Remote players
// arrive as snapshots and are rendered (with light interpolation) by the
// scene. The server is a dumb relay; see /server/src/main.cpp.

export interface Vec2 {
  x: number;
  y: number;
}

export interface RemotePlayerState {
  id: number;
  name: string;
  position: Vec2;
  velocity: Vec2;
  facing: boolean;
  onGround: boolean;
  animTime: number;
  sprite: number;
  screen: number;
}

export interface LocalPlayerState {
  position: Vec2;
  velocity: Vec2;
  facing: boolean;
  onGround: boolean;
  animTime: number;
  sprite: number;
  screen: number;
}

export interface NetworkCallbacks {
  onReady?: (id: number) => void;
  onPlayerJoin?: (player: RemotePlayerState) => void;
  onPlayerLeave?: (id: number) => void;
  onSnapshot?: (players: RemotePlayerState[]) => void;
}

const DEFAULT_PORT = 8080;

function defaultServerUrl(): string {
  const hasLoc = typeof location !== 'undefined';
  const loc = hasLoc ? location : null;
  const params = new URLSearchParams(loc ? loc.search : '');

  // 1) Explicit full server URL override, e.g. ?server=wss://foo.up.railway.app/ws
  const explicit = params.get('server');
  if (explicit) {
    try {
      const u = new URL(explicit);
      if (u.protocol === 'ws:' || u.protocol === 'wss:') return explicit;
    } catch {
      /* ignore invalid override */
    }
  }

  // 2) Production: served over HTTPS behind a reverse proxy on the same
  //    origin, so use a secure WebSocket on the /ws path (proxied to the
  //    C++ relay). Railway terminates TLS in front of the container.
  if (loc && loc.protocol === 'https:') {
    return `wss://${loc.host}/ws`;
  }

  // 3) Local dev: ws://<hostname>:8080 (port overridable via ?port=...).
  const host = loc ? loc.hostname : 'localhost';
  const port = params.get('port') ?? String(DEFAULT_PORT);
  return `ws://${host}:${port}`;
}

const MAX_NAME_LEN = 24;

function sanitizeName(raw: unknown): string {
  let s = String(raw ?? 'Prince');
  s = s.replace(/[\u0000-\u001f\u007f]/g, '');
  if (s.length > MAX_NAME_LEN) s = s.slice(0, MAX_NAME_LEN);
  s = s.trim();
  return s || 'Prince';
}

function finiteNumber(n: unknown, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function parsePlayer(raw: unknown): RemotePlayerState {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pos = (p.position && typeof p.position === 'object' ? p.position : {}) as Record<string, unknown>;
  const vel = (p.velocity && typeof p.velocity === 'object' ? p.velocity : {}) as Record<string, unknown>;
  return {
    id: finiteNumber(p.id, -1),
    name: sanitizeName(p.name),
    position: { x: finiteNumber(pos.x), y: finiteNumber(pos.y) },
    velocity: { x: finiteNumber(vel.x), y: finiteNumber(vel.y) },
    facing: Boolean(p.facing ?? true),
    onGround: Boolean(p.onGround ?? false),
    animTime: finiteNumber(p.animTime),
    sprite: finiteNumber(p.sprite) | 0,
    screen: finiteNumber(p.screen) | 0,
  };
}

export class Network {
  private ws: WebSocket | null = null;
  private url: string;
  private name: string;
  private callbacks: NetworkCallbacks;
  private sendAccumulator = 0;
  private sendInterval = 1 / 20; // 20Hz outgoing state
  private reconnectTimer: number | null = null;
  private manuallyClosed = false;

  public id: number | null = null;
  public isConnected = false;

  constructor(callbacks: NetworkCallbacks = {}, url?: string, name?: string) {
    this.callbacks = callbacks;
    this.url = url ?? defaultServerUrl();
    this.name = sanitizeName(name ?? this.pickName());
  }

  private pickName(): string {
    try {
      const stored = localStorage.getItem('jp_name');
      if (stored) return stored;
    } catch {
      /* ignore */
    }
    return `Prince${Math.floor(Math.random() * 1000)}`;
  }

  connect(name?: string): void {
    if (name) this.name = sanitizeName(name);
    this.manuallyClosed = false;
    this.openSocket();
  }

  private openSocket(): void {
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.warn('[net] WebSocket open failed', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.isConnected = true;
      console.log('[net] connected to', this.url);
      this.sendRaw({ type: 'hello', name: this.name });
    };

    this.ws.onmessage = (ev: MessageEvent) => this.handleMessage(ev.data);

    this.ws.onclose = () => {
      this.isConnected = false;
      this.id = null;
      console.log('[net] disconnected');
      if (!this.manuallyClosed) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will follow.
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, 1500);
  }

  private handleMessage(data: unknown): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : '');
    } catch {
      return;
    }
    const type = msg.type as string | undefined;
    if (!type) return;

    if (type === 'init') {
      this.id = Number(msg.id ?? -1);
      const players = Array.isArray(msg.players) ? (msg.players as unknown[]).map(parsePlayer) : [];
      this.callbacks.onReady?.(this.id);
      for (const p of players) this.callbacks.onPlayerJoin?.(p);
    } else if (type === 'join') {
      this.callbacks.onPlayerJoin?.(parsePlayer(msg.player));
    } else if (type === 'leave') {
      this.callbacks.onPlayerLeave?.(Number(msg.id ?? -1));
    } else if (type === 'snapshot') {
      const players = Array.isArray(msg.players)
        ? (msg.players as unknown[]).map(parsePlayer).filter((p) => p.id !== this.id)
        : [];
      this.callbacks.onSnapshot?.(players);
    }
  }

  private sendRaw(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  // Called every frame by the scene. Throttles outgoing state to sendInterval.
  sendState(state: LocalPlayerState, delta: number): void {
    if (!this.isConnected || this.id === null) return;
    this.sendAccumulator += delta;
    if (this.sendAccumulator < this.sendInterval) return;
    this.sendAccumulator = 0;
    this.sendRaw({
      type: 'state',
      position: state.position,
      velocity: state.velocity,
      facing: state.facing,
      onGround: state.onGround,
      animTime: state.animTime,
      sprite: state.sprite,
      screen: state.screen,
    });
  }

  close(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}
