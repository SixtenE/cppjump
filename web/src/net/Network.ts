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
  if (explicit) return explicit;

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

function parsePlayer(raw: unknown): RemotePlayerState {
  const p = raw as Record<string, unknown>;
  const pos = (p.position ?? { x: 0, y: 0 }) as Vec2;
  const vel = (p.velocity ?? { x: 0, y: 0 }) as Vec2;
  return {
    id: Number(p.id ?? -1),
    name: String(p.name ?? 'Prince'),
    position: { x: Number(pos.x ?? 0), y: Number(pos.y ?? 0) },
    velocity: { x: Number(vel.x ?? 0), y: Number(vel.y ?? 0) },
    facing: Boolean(p.facing ?? true),
    onGround: Boolean(p.onGround ?? false),
    animTime: Number(p.animTime ?? 0),
    sprite: Number(p.sprite ?? 0) | 0,
    screen: Number(p.screen ?? 0) | 0,
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
    this.name = name ?? this.pickName();
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
    if (name) this.name = name;
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
